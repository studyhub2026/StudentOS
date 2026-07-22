'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api-client';
import type { ChatMessage } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface SocketUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface ServerEvents {
  'message:new': (message: ChatMessage & { channelId: string }) => void;
  'message:deleted': (payload: { messageId: string; channelId: string }) => void;
  'typing:update': (payload: { channelId: string; users: SocketUser[] }) => void;
  'presence:update': (payload: { groupId: string; online: SocketUser[] }) => void;
  'member:joined': (payload: { groupId: string; user: SocketUser }) => void;
  'member:left': (payload: { groupId: string; userId: string }) => void;
  notification: (payload: { type: string; title: string; body?: string; link?: string }) => void;
}

interface ClientEvents {
  'group:join': (groupId: string, ack: (result: { ok: boolean; error?: string }) => void) => void;
  'group:leave': (groupId: string) => void;
  'message:send': (
    payload: { groupId: string; channelId: string; content: string; replyToId?: string },
    ack: (result: { ok: boolean; messageId?: string; error?: string }) => void,
  ) => void;
  'typing:start': (payload: { groupId: string; channelId: string }) => void;
  'typing:stop': (payload: { groupId: string; channelId: string }) => void;
  'presence:ping': () => void;
}

export type AppSocket = Socket<ServerEvents, ClientEvents>;

let socket: AppSocket | null = null;

/**
 * One shared socket for the whole app.
 *
 * The access token is read at connect time rather than captured, so a
 * reconnection after a token refresh authenticates with the current token
 * instead of a stale one.
 */
export function getSocket(): AppSocket | null {
  if (typeof window === 'undefined') return null;

  const token = getAccessToken();
  if (!token) return null;

  if (socket?.connected) return socket;

  if (!socket) {
    socket = io(API_URL, {
      auth: (callback) => callback({ token: getAccessToken() ?? '' }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      reconnectionAttempts: 10,
      autoConnect: true,
    });
  } else if (socket.disconnected) {
    socket.connect();
  }

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
