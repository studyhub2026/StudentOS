import 'server-only';
import crypto from 'node:crypto';
import { GroupRole, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@/server/lib/errors';
import type {
  CreateChannelInput,
  CreateGroupInput,
  UpdateGroupInput,
} from '@/server/validators/group.validator';

/**
 * Study groups, channels and message history.
 *
 * Live delivery is handled by the socket layer; this service owns persistence,
 * membership and authorisation. Every read is scoped by membership, so a group
 * id alone never grants access.
 */

const memberSelect = {
  id: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, name: true, username: true, avatarUrl: true } },
} satisfies Prisma.GroupMemberSelect;

/** Ordered by authority so comparisons read naturally. */
const ROLE_RANK: Record<GroupRole, number> = {
  OWNER: 3,
  MODERATOR: 2,
  MEMBER: 1,
};

function generateInviteCode(): string {
  // 8 URL-safe characters — short enough to share verbally, wide enough
  // (~47 bits) that codes cannot be enumerated.
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

export async function requireMembership(
  userId: string,
  groupId: string,
  minimumRole: GroupRole = GroupRole.MEMBER,
): Promise<GroupRole> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { role: true },
  });

  if (!membership) throw new NotFoundError('Group');
  if (ROLE_RANK[membership.role] < ROLE_RANK[minimumRole]) {
    throw new ForbiddenError('You do not have permission to do that in this group');
  }

  return membership.role;
}

export async function listGroups(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'desc' },
    select: {
      role: true,
      joinedAt: true,
      group: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          avatarUrl: true,
          isPublic: true,
          maxMembers: true,
          createdAt: true,
          owner: { select: { id: true, name: true, username: true } },
          _count: { select: { members: true, channels: true } },
        },
      },
    },
  });

  return memberships.map(({ group, role, joinedAt }) => ({
    ...group,
    memberCount: group._count.members,
    channelCount: group._count.channels,
    myRole: role,
    joinedAt,
    _count: undefined,
  }));
}

export async function getGroup(userId: string, groupId: string) {
  await requireMembership(userId, groupId);

  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      avatarUrl: true,
      isPublic: true,
      inviteCode: true,
      maxMembers: true,
      createdAt: true,
      ownerId: true,
      owner: { select: { id: true, name: true, username: true, avatarUrl: true } },
      members: { select: memberSelect, orderBy: { joinedAt: 'asc' } },
      channels: {
        select: { id: true, name: true, type: true, topic: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!group) throw new NotFoundError('Group');
  return group;
}

/** Slugifies a name, appending a random suffix when it is already taken. */
async function deriveUniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'group';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const taken = await prisma.studyGroup.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

export async function createGroup(userId: string, input: CreateGroupInput) {
  const slug = await deriveUniqueSlug(input.name);

  // The creator is enrolled as OWNER and a default channel is created in the
  // same transaction, so a group is never left unusable if one step fails.
  return prisma.studyGroup.create({
    data: {
      ownerId: userId,
      name: input.name,
      slug,
      description: input.description ?? null,
      isPublic: input.isPublic ?? false,
      maxMembers: input.maxMembers ?? 50,
      inviteCode: generateInviteCode(),
      members: { create: { userId, role: GroupRole.OWNER } },
      channels: { create: { name: 'general', type: 'TEXT' } },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      isPublic: true,
      inviteCode: true,
      createdAt: true,
      channels: { select: { id: true, name: true, type: true } },
    },
  });
}

export async function updateGroup(userId: string, groupId: string, input: UpdateGroupInput) {
  await requireMembership(userId, groupId, GroupRole.MODERATOR);

  const data: Prisma.StudyGroupUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.isPublic !== undefined) data.isPublic = input.isPublic;
  if (input.maxMembers !== undefined) data.maxMembers = input.maxMembers;

  return prisma.studyGroup.update({ where: { id: groupId }, data });
}

export async function deleteGroup(userId: string, groupId: string): Promise<void> {
  // Only the owner may delete; moderators can manage but not destroy.
  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) throw new NotFoundError('Group');
  if (group.ownerId !== userId) {
    throw new ForbiddenError('Only the group owner can delete it');
  }

  await prisma.studyGroup.delete({ where: { id: groupId } });
}

export async function regenerateInvite(userId: string, groupId: string): Promise<string> {
  await requireMembership(userId, groupId, GroupRole.MODERATOR);

  const code = generateInviteCode();
  await prisma.studyGroup.update({ where: { id: groupId }, data: { inviteCode: code } });
  return code;
}

export async function joinByInvite(userId: string, inviteCode: string) {
  const group = await prisma.studyGroup.findUnique({
    where: { inviteCode },
    select: {
      id: true,
      name: true,
      maxMembers: true,
      _count: { select: { members: true } },
    },
  });

  if (!group) throw new NotFoundError('Invite');

  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('You are already a member of that group');

  if (group._count.members >= group.maxMembers) {
    throw new BadRequestError('That group is full');
  }

  await prisma.groupMember.create({
    data: { groupId: group.id, userId, role: GroupRole.MEMBER },
  });

  return { groupId: group.id, name: group.name };
}

export async function leaveGroup(userId: string, groupId: string): Promise<void> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { role: true },
  });
  if (!membership) throw new NotFoundError('Group');

  // An owner leaving would orphan the group; require transfer or deletion.
  if (membership.role === GroupRole.OWNER) {
    throw new BadRequestError(
      'Transfer ownership or delete the group before leaving it',
    );
  }

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId } },
  });
}

export async function removeMember(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  const actorRole = await requireMembership(userId, groupId, GroupRole.MODERATOR);

  const target = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    select: { role: true },
  });
  if (!target) throw new NotFoundError('Member');

  // A moderator cannot remove a peer or the owner — only lower ranks.
  if (ROLE_RANK[target.role] >= ROLE_RANK[actorRole]) {
    throw new ForbiddenError('You cannot remove a member at or above your own role');
  }

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId: targetUserId } },
  });
}

export async function changeMemberRole(
  userId: string,
  groupId: string,
  targetUserId: string,
  role: GroupRole,
): Promise<void> {
  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) throw new NotFoundError('Group');

  // Role changes are owner-only: allowing moderators to promote would let any
  // moderator manufacture a peer and escalate indirectly.
  if (group.ownerId !== userId) {
    throw new ForbiddenError('Only the group owner can change roles');
  }
  if (targetUserId === userId) {
    throw new BadRequestError('You cannot change your own role');
  }
  if (role === GroupRole.OWNER) {
    throw new BadRequestError('Use the ownership transfer action instead');
  }

  const result = await prisma.groupMember.updateMany({
    where: { groupId, userId: targetUserId },
    data: { role },
  });
  if (result.count === 0) throw new NotFoundError('Member');
}

export async function transferOwnership(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) throw new NotFoundError('Group');
  if (group.ownerId !== userId) {
    throw new ForbiddenError('Only the group owner can transfer ownership');
  }

  const target = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    select: { id: true },
  });
  if (!target) throw new BadRequestError('That user is not a member of this group');

  // Both role rows and the denormalised ownerId must move together.
  await prisma.$transaction([
    prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { role: GroupRole.OWNER },
    }),
    prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { role: GroupRole.MODERATOR },
    }),
    prisma.studyGroup.update({ where: { id: groupId }, data: { ownerId: targetUserId } }),
  ]);
}

// --- Channels ---------------------------------------------------------------

export async function createChannel(
  userId: string,
  groupId: string,
  input: CreateChannelInput,
) {
  await requireMembership(userId, groupId, GroupRole.MODERATOR);

  return prisma.channel.create({
    data: {
      groupId,
      name: input.name,
      type: input.type,
      topic: input.topic ?? null,
    },
  });
}

export async function deleteChannel(
  userId: string,
  groupId: string,
  channelId: string,
): Promise<void> {
  await requireMembership(userId, groupId, GroupRole.MODERATOR);

  const remaining = await prisma.channel.count({ where: { groupId } });
  if (remaining <= 1) {
    throw new BadRequestError('A group must keep at least one channel');
  }

  const result = await prisma.channel.deleteMany({ where: { id: channelId, groupId } });
  if (result.count === 0) throw new NotFoundError('Channel');
}

// --- Messages ---------------------------------------------------------------

/**
 * Cursor-paginated message history, newest first.
 *
 * Cursor rather than offset: a chat log grows while it is being read, and
 * offset pagination would skip or repeat messages as it does.
 */
export async function listMessages(
  userId: string,
  groupId: string,
  channelId: string,
  options: { limit: number; before?: string | undefined },
) {
  await requireMembership(userId, groupId);

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, groupId },
    select: { id: true },
  });
  if (!channel) throw new NotFoundError('Channel');

  const messages = await prisma.message.findMany({
    where: { channelId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: options.limit + 1,
    ...(options.before ? { cursor: { id: options.before }, skip: 1 } : {}),
    select: {
      id: true,
      content: true,
      createdAt: true,
      editedAt: true,
      replyToId: true,
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      attachments: {
        select: { id: true, filename: true, mimeType: true, sizeBytes: true, url: true },
      },
    },
  });

  const hasMore = messages.length > options.limit;
  const page = hasMore ? messages.slice(0, options.limit) : messages;

  return {
    // Reversed so the client renders oldest-to-newest without re-sorting.
    messages: page.reverse(),
    hasMore,
    nextCursor: hasMore ? (page[0]?.id ?? null) : null,
  };
}

/**
 * Persists a chat message after re-checking membership. Returns the message in
 * the same shape as history, ready to broadcast over Realtime.
 */
export async function createMessage(
  userId: string,
  groupId: string,
  channelId: string,
  content: string,
  replyToId?: string,
) {
  await requireMembership(userId, groupId);

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, groupId },
    select: { id: true },
  });
  if (!channel) throw new NotFoundError('Channel');

  const trimmed = content.trim();
  if (!trimmed) throw new BadRequestError('Message cannot be empty');

  const message = await prisma.message.create({
    data: { channelId, authorId: userId, content: trimmed, replyToId: replyToId ?? null },
    select: {
      id: true,
      content: true,
      createdAt: true,
      editedAt: true,
      replyToId: true,
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
    },
  });

  return { ...message, channelId, attachments: [] as never[] };
}

export async function deleteMessage(
  userId: string,
  groupId: string,
  messageId: string,
): Promise<{ channelId: string }> {
  const role = await requireMembership(userId, groupId);

  const message = await prisma.message.findFirst({
    where: { id: messageId, channel: { groupId }, deletedAt: null },
    select: { id: true, authorId: true, channelId: true },
  });
  if (!message) throw new NotFoundError('Message');

  // Authors may remove their own messages; moderators may remove anyone's.
  const isAuthor = message.authorId === userId;
  const canModerate = ROLE_RANK[role] >= ROLE_RANK[GroupRole.MODERATOR];

  if (!isAuthor && !canModerate) {
    throw new ForbiddenError('You can only delete your own messages');
  }

  // Soft delete keeps thread replies coherent rather than orphaning them.
  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), content: '[deleted]' },
  });

  return { channelId: message.channelId };
}

export async function editMessage(
  userId: string,
  groupId: string,
  messageId: string,
  content: string,
) {
  await requireMembership(userId, groupId);

  const message = await prisma.message.findFirst({
    where: { id: messageId, channel: { groupId }, deletedAt: null },
    select: { authorId: true },
  });
  if (!message) throw new NotFoundError('Message');

  // Editing is author-only regardless of role — a moderator rewriting someone
  // else's words under their name would be worse than deletion.
  if (message.authorId !== userId) {
    throw new ForbiddenError('You can only edit your own messages');
  }

  return prisma.message.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
    select: { id: true, content: true, editedAt: true },
  });
}

/** Public groups, for the discovery page. */
export async function discoverGroups(userId: string, search?: string) {
  const groups = await prisma.studyGroup.findMany({
    where: {
      isPublic: true,
      members: { none: { userId } },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    take: 30,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      avatarUrl: true,
      maxMembers: true,
      _count: { select: { members: true } },
    },
  });

  return groups.map(({ _count, ...group }) => ({ ...group, memberCount: _count.members }));
}

export const groupService = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  regenerateInvite,
  joinByInvite,
  leaveGroup,
  removeMember,
  changeMemberRole,
  transferOwnership,
  createChannel,
  deleteChannel,
  listMessages,
  createMessage,
  deleteMessage,
  editMessage,
  discoverGroups,
  requireMembership,
} as const;
