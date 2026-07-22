import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { verifyAccessToken } from '../utils/jwt.js';

/**
 * Real-time layer for study groups.
 *
 * Every connection is authenticated during the handshake — an unauthenticated
 * socket is rejected before it can join any room. Room membership is checked
 * against the database on every join, so a socket cannot listen to a group the
 * user does not belong to simply by guessing its id.
 */

export interface SocketUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface SocketData {
  user: SocketUser;
  sessionId: string;
}

type AppSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;

/** Events the client may emit. */
interface ClientEvents {
  'group:join': (groupId: string, ack?: (result: { ok: boolean; error?: string }) => void) => void;
  'group:leave': (groupId: string) => void;
  'message:send': (
    payload: { groupId: string; channelId: string; content: string; replyToId?: string },
    ack?: (result: { ok: boolean; messageId?: string; error?: string }) => void,
  ) => void;
  'typing:start': (payload: { groupId: string; channelId: string }) => void;
  'typing:stop': (payload: { groupId: string; channelId: string }) => void;
  'presence:ping': () => void;
}

/** Events the server emits. */
interface ServerEvents {
  'message:new': (message: BroadcastMessage) => void;
  'message:deleted': (payload: { messageId: string; channelId: string }) => void;
  'typing:update': (payload: { channelId: string; users: SocketUser[] }) => void;
  'presence:update': (payload: { groupId: string; online: SocketUser[] }) => void;
  'member:joined': (payload: { groupId: string; user: SocketUser }) => void;
  'member:left': (payload: { groupId: string; userId: string }) => void;
  notification: (payload: { type: string; title: string; body?: string; link?: string }) => void;
}

export interface BroadcastMessage {
  id: string;
  channelId: string;
  content: string;
  createdAt: string;
  replyToId: string | null;
  author: SocketUser;
}

const MAX_MESSAGE_LENGTH = 4000;
/** Typing indicators self-expire so a dropped connection cannot pin them on. */
const TYPING_TTL_MS = 5000;
/**
 * Ceiling on the handshake session lookup. Without it a database outage leaves
 * handshakes hanging until Prisma's own connection timeout expires — clients
 * see no error, retry, and pile up open connections. Failing fast turns an
 * outage into a clean rejection the client can back off from.
 */
const AUTH_LOOKUP_TIMEOUT_MS = 3000;

async function withTimeout<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData> | null = null;

/** groupId → set of userIds currently connected. */
const presence = new Map<string, Set<string>>();
/** channelId → userId → expiry timestamp. */
const typing = new Map<string, Map<string, number>>();

function roomFor(groupId: string): string {
  return `group:${groupId}`;
}

/** Personal room, used to push notifications to every device a user has open. */
function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function initSockets(server: HttpServer): Server {
  io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(server, {
    cors: {
      origin: env.isProduction ? [env.APP_URL] : true,
      credentials: true,
    },
    // Keeps a half-open connection from lingering as a phantom "online" user.
    pingTimeout: 20_000,
    pingInterval: 25_000,
  });

  io.use((socket, next) => {
    void (async () => {
      try {
        const token =
          (socket.handshake.auth as { token?: string } | undefined)?.token ??
          socket.handshake.headers.authorization?.replace(/^Bearer /, '');

        if (!token) {
          next(new Error('Authentication required'));
          return;
        }

        const payload = verifyAccessToken(token);

        // The session is re-checked here rather than trusting the token alone,
        // so a signed-out session cannot hold a live socket open. Bounded so a
        // database outage rejects promptly instead of hanging the handshake.
        const session = await withTimeout(
          prisma.session.findUnique({
            where: { id: payload.sid },
            select: {
              revokedAt: true,
              expiresAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  avatarUrl: true,
                  deletedAt: true,
                },
              },
            },
          }),
          AUTH_LOOKUP_TIMEOUT_MS,
          'session lookup',
        );

        if (
          !session ||
          session.revokedAt ||
          session.expiresAt < new Date() ||
          session.user.deletedAt
        ) {
          next(new Error('Session expired or revoked'));
          return;
        }

        socket.data.user = {
          id: session.user.id,
          name: session.user.name,
          username: session.user.username,
          avatarUrl: session.user.avatarUrl,
        };
        socket.data.sessionId = payload.sid;

        next();
      } catch (error) {
        // Distinguish an infrastructure failure from a bad credential: the
        // client should back off and retry on the former, not re-authenticate.
        const unavailable = error instanceof Error && error.message.includes('timed out');
        if (unavailable) {
          logger.error({ err: error }, 'socket auth unavailable — rejecting handshake');
        }
        next(new Error(unavailable ? 'Authentication service unavailable' : 'Invalid token'));
      }
    })();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    void socket.join(userRoom(user.id));

    logger.debug({ userId: user.id, socketId: socket.id }, 'socket connected');

    registerHandlers(socket);

    socket.on('disconnect', () => {
      for (const [groupId, members] of presence.entries()) {
        if (!members.delete(user.id)) continue;

        // Other tabs may still be connected; only broadcast a real departure.
        if (!isUserInGroup(user.id, groupId)) {
          socket.to(roomFor(groupId)).emit('member:left', { groupId, userId: user.id });
        }
        broadcastPresence(groupId);
      }

      clearTypingFor(user.id);
      logger.debug({ userId: user.id }, 'socket disconnected');
    });
  });

  // Expire stale typing indicators.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [channelId, users] of typing.entries()) {
      let changed = false;
      for (const [userId, expiresAt] of users.entries()) {
        if (expiresAt <= now) {
          users.delete(userId);
          changed = true;
        }
      }
      if (changed) broadcastTyping(channelId);
      if (users.size === 0) typing.delete(channelId);
    }
  }, 2000);
  sweeper.unref();

  logger.info('socket.io initialised');
  return io;
}

function isUserInGroup(userId: string, groupId: string): boolean {
  const sockets = io?.sockets.adapter.rooms.get(roomFor(groupId));
  if (!sockets) return false;

  for (const socketId of sockets) {
    const socket = io?.sockets.sockets.get(socketId);
    if (socket?.data.user?.id === userId) return true;
  }
  return false;
}

function registerHandlers(socket: AppSocket): void {
  const user = socket.data.user;

  socket.on('group:join', (groupId, ack) => {
    void (async () => {
      try {
        const membership = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: user.id } },
          select: { id: true },
        });

        if (!membership) {
          ack?.({ ok: false, error: 'You are not a member of that group' });
          return;
        }

        await socket.join(roomFor(groupId));

        const members = presence.get(groupId) ?? new Set<string>();
        const wasOffline = !members.has(user.id);
        members.add(user.id);
        presence.set(groupId, members);

        if (wasOffline) {
          socket.to(roomFor(groupId)).emit('member:joined', { groupId, user });
        }
        broadcastPresence(groupId);

        ack?.({ ok: true });
      } catch (error) {
        logger.error({ err: error, groupId }, 'group:join failed');
        ack?.({ ok: false, error: 'Could not join that group' });
      }
    })();
  });

  socket.on('group:leave', (groupId) => {
    void socket.leave(roomFor(groupId));
    presence.get(groupId)?.delete(user.id);
    broadcastPresence(groupId);
  });

  socket.on('message:send', (payload, ack) => {
    void (async () => {
      try {
        const content = payload.content?.trim() ?? '';
        if (!content) {
          ack?.({ ok: false, error: 'Message cannot be empty' });
          return;
        }
        if (content.length > MAX_MESSAGE_LENGTH) {
          ack?.({ ok: false, error: 'Message is too long' });
          return;
        }

        // Membership is re-verified per message; a socket that joined before
        // being removed from the group must not keep posting.
        const channel = await prisma.channel.findFirst({
          where: {
            id: payload.channelId,
            group: {
              id: payload.groupId,
              members: { some: { userId: user.id } },
            },
          },
          select: { id: true, groupId: true },
        });

        if (!channel) {
          ack?.({ ok: false, error: 'Channel not found or access denied' });
          return;
        }

        const message = await prisma.message.create({
          data: {
            channelId: channel.id,
            authorId: user.id,
            content,
            replyToId: payload.replyToId ?? null,
          },
          select: { id: true, content: true, createdAt: true, replyToId: true },
        });

        const broadcast: BroadcastMessage = {
          id: message.id,
          channelId: channel.id,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          replyToId: message.replyToId,
          author: user,
        };

        io?.to(roomFor(payload.groupId)).emit('message:new', broadcast);

        // Sending implies the author stopped typing.
        typing.get(payload.channelId)?.delete(user.id);
        broadcastTyping(payload.channelId);

        ack?.({ ok: true, messageId: message.id });
      } catch (error) {
        logger.error({ err: error }, 'message:send failed');
        ack?.({ ok: false, error: 'Could not send that message' });
      }
    })();
  });

  socket.on('typing:start', ({ channelId }) => {
    const users = typing.get(channelId) ?? new Map<string, number>();
    users.set(user.id, Date.now() + TYPING_TTL_MS);
    typing.set(channelId, users);
    broadcastTyping(channelId);
  });

  socket.on('typing:stop', ({ channelId }) => {
    typing.get(channelId)?.delete(user.id);
    broadcastTyping(channelId);
  });

  socket.on('presence:ping', () => {
    for (const groupId of presence.keys()) {
      if (presence.get(groupId)?.has(user.id)) broadcastPresence(groupId);
    }
  });
}

function usersFromIds(ids: Iterable<string>): SocketUser[] {
  const found = new Map<string, SocketUser>();

  for (const socket of io?.sockets.sockets.values() ?? []) {
    const candidate = socket.data.user;
    if (candidate) found.set(candidate.id, candidate);
  }

  const result: SocketUser[] = [];
  for (const id of ids) {
    const user = found.get(id);
    if (user) result.push(user);
  }
  return result;
}

function broadcastPresence(groupId: string): void {
  const members = presence.get(groupId);
  io?.to(roomFor(groupId)).emit('presence:update', {
    groupId,
    online: members ? usersFromIds(members) : [],
  });
}

function broadcastTyping(channelId: string): void {
  const users = typing.get(channelId);
  const active = users ? [...users.keys()] : [];
  io?.emit('typing:update', { channelId, users: usersFromIds(active) });
}

function clearTypingFor(userId: string): void {
  for (const [channelId, users] of typing.entries()) {
    if (users.delete(userId)) broadcastTyping(channelId);
  }
}

/** Pushes a notification to every device a user has connected. */
export function notifyUser(
  userId: string,
  payload: { type: string; title: string; body?: string; link?: string },
): void {
  io?.to(userRoom(userId)).emit('notification', payload);
}

/** Broadcasts a deletion so open clients drop the message immediately. */
export function broadcastMessageDeleted(
  groupId: string,
  channelId: string,
  messageId: string,
): void {
  io?.to(roomFor(groupId)).emit('message:deleted', { messageId, channelId });
}

export function getIo(): Server | null {
  return io;
}

export async function closeSockets(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
  presence.clear();
  typing.clear();
}
