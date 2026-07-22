import type { Request, Response } from 'express';
import { analyticsService } from '../services/analytics.service.js';
import { focusService } from '../services/focus.service.js';
import { plannerService } from '../services/planner.service.js';
import { scheduleService } from '../services/schedule.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import type {
  ApplyPlanInput,
  CreateBlockInput,
  EndSessionInput,
  GeneratePlanInput,
  ListBlocksQuery,
  StartSessionInput,
  UpdateBlockInput,
} from '../validators/schedule.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

// --- Timetable --------------------------------------------------------------

export async function listBlocks(req: Request, res: Response): Promise<void> {
  const blocks = await scheduleService.listBlocks(
    userId(req),
    req.query as unknown as ListBlocksQuery,
  );
  res.json({ success: true, data: blocks });
}

/** Defaults to the current week, starting Monday. */
export async function getWeek(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { weekStart?: Date };

  let weekStart = query.weekStart ? new Date(query.weekStart) : new Date();
  weekStart.setHours(0, 0, 0, 0);
  if (!query.weekStart) {
    const weekday = weekStart.getDay();
    const daysSinceMonday = (weekday + 6) % 7;
    weekStart = new Date(weekStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  }

  res.json({ success: true, data: await scheduleService.getWeek(userId(req), weekStart) });
}

export async function createBlock(req: Request, res: Response): Promise<void> {
  const block = await scheduleService.createBlock(userId(req), req.body as CreateBlockInput);
  res.status(201).json({ success: true, data: block });
}

export async function updateBlock(req: Request, res: Response): Promise<void> {
  const block = await scheduleService.updateBlock(
    userId(req),
    req.params.id as string,
    req.body as UpdateBlockInput,
  );
  res.json({ success: true, data: block });
}

export async function removeBlock(req: Request, res: Response): Promise<void> {
  const scope = (req.query.scope as 'one' | 'following' | 'all' | undefined) ?? 'one';
  const deleted = await scheduleService.deleteBlock(userId(req), req.params.id as string, scope);
  res.json({ success: true, data: { deleted } });
}

// --- Planner ----------------------------------------------------------------

export async function generatePlan(req: Request, res: Response): Promise<void> {
  const plan = await plannerService.generatePlan(userId(req), req.body as GeneratePlanInput);
  res.json({ success: true, data: plan });
}

export async function applyPlan(req: Request, res: Response): Promise<void> {
  const input = req.body as ApplyPlanInput;
  const owner = userId(req);

  if (input.replaceExisting && input.from && input.to) {
    await plannerService.clearGeneratedBlocks(owner, input.from, input.to);
  }

  const created = await plannerService.applyPlan(owner, input.sessions);
  res.status(201).json({ success: true, data: { created } });
}

// --- Focus ------------------------------------------------------------------

export async function startSession(req: Request, res: Response): Promise<void> {
  const session = await focusService.startSession(userId(req), req.body as StartSessionInput);
  res.status(201).json({ success: true, data: session });
}

export async function activeSession(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await focusService.getActiveSession(userId(req)) });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const session = await focusService.endSession(
    userId(req),
    req.params.id as string,
    req.body as EndSessionInput,
  );
  res.json({ success: true, data: session });
}

export async function cancelSession(req: Request, res: Response): Promise<void> {
  await focusService.cancelSession(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Session cancelled' } });
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    from?: Date;
    to?: Date;
  };

  const result = await focusService.listSessions(userId(req), query);
  res.json({ success: true, data: result.items, pagination: result.pagination });
}

// --- Analytics --------------------------------------------------------------

export async function analytics(req: Request, res: Response): Promise<void> {
  const { days } = req.query as unknown as { days: number };
  res.json({ success: true, data: await analyticsService.getOverview(userId(req), days) });
}
