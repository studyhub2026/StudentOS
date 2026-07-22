import type { GroupRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { groupService } from '../services/group.service.js';
import { broadcastMessageDeleted, notifyUser } from '../sockets/index.js';
import { UnauthorizedError } from '../utils/errors.js';
import type {
  CreateChannelInput,
  CreateGroupInput,
  UpdateGroupInput,
} from '../validators/group.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export async function list(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await groupService.listGroups(userId(req)) });
}

export async function discover(req: Request, res: Response): Promise<void> {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  res.json({ success: true, data: await groupService.discoverGroups(userId(req), search) });
}

export async function getById(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await groupService.getGroup(userId(req), req.params.id as string),
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const group = await groupService.createGroup(userId(req), req.body as CreateGroupInput);
  res.status(201).json({ success: true, data: group });
}

export async function update(req: Request, res: Response): Promise<void> {
  const group = await groupService.updateGroup(
    userId(req),
    req.params.id as string,
    req.body as UpdateGroupInput,
  );
  res.json({ success: true, data: group });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await groupService.deleteGroup(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Group deleted' } });
}

export async function regenerateInvite(req: Request, res: Response): Promise<void> {
  const code = await groupService.regenerateInvite(userId(req), req.params.id as string);
  res.json({ success: true, data: { inviteCode: code } });
}

export async function join(req: Request, res: Response): Promise<void> {
  const { inviteCode } = req.body as { inviteCode: string };
  const result = await groupService.joinByInvite(userId(req), inviteCode);
  res.status(201).json({ success: true, data: result });
}

export async function leave(req: Request, res: Response): Promise<void> {
  await groupService.leaveGroup(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'You left the group' } });
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const groupId = req.params.id as string;
  const target = req.params.userId as string;

  await groupService.removeMember(userId(req), groupId, target);

  // Tell the removed member on whatever devices they have open.
  notifyUser(target, {
    type: 'GROUP_REMOVED',
    title: 'Removed from a study group',
    link: '/groups',
  });

  res.json({ success: true, data: { message: 'Member removed' } });
}

export async function changeRole(req: Request, res: Response): Promise<void> {
  const { role } = req.body as { role: GroupRole };
  await groupService.changeMemberRole(
    userId(req),
    req.params.id as string,
    req.params.userId as string,
    role,
  );
  res.json({ success: true, data: { message: 'Role updated' } });
}

export async function transferOwnership(req: Request, res: Response): Promise<void> {
  await groupService.transferOwnership(
    userId(req),
    req.params.id as string,
    req.params.userId as string,
  );
  res.json({ success: true, data: { message: 'Ownership transferred' } });
}

// --- Channels ---------------------------------------------------------------

export async function createChannel(req: Request, res: Response): Promise<void> {
  const channel = await groupService.createChannel(
    userId(req),
    req.params.id as string,
    req.body as CreateChannelInput,
  );
  res.status(201).json({ success: true, data: channel });
}

export async function removeChannel(req: Request, res: Response): Promise<void> {
  await groupService.deleteChannel(
    userId(req),
    req.params.id as string,
    req.params.channelId as string,
  );
  res.json({ success: true, data: { message: 'Channel deleted' } });
}

// --- Messages ---------------------------------------------------------------

export async function listMessages(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { limit: number; before?: string };

  const result = await groupService.listMessages(
    userId(req),
    req.params.id as string,
    req.params.channelId as string,
    { limit: query.limit, before: query.before },
  );

  res.json({ success: true, data: result });
}

export async function editMessage(req: Request, res: Response): Promise<void> {
  const { content } = req.body as { content: string };
  const message = await groupService.editMessage(
    userId(req),
    req.params.id as string,
    req.params.messageId as string,
    content,
  );
  res.json({ success: true, data: message });
}

export async function deleteMessage(req: Request, res: Response): Promise<void> {
  const groupId = req.params.id as string;
  const messageId = req.params.messageId as string;

  const { channelId } = await groupService.deleteMessage(userId(req), groupId, messageId);

  // Open clients drop it immediately rather than waiting for a refetch.
  broadcastMessageDeleted(groupId, channelId, messageId);

  res.json({ success: true, data: { message: 'Message deleted' } });
}
