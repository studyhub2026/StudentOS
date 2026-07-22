import type { Request, Response } from 'express';
import { assignmentService } from '../services/assignment.service.js';
import { dashboardService } from '../services/dashboard.service.js';
import { subjectService } from '../services/subject.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import type {
  BulkUpdateInput,
  CreateAssignmentInput,
  CreateSubjectInput,
  ListAssignmentsQuery,
  UpdateAssignmentInput,
  UpdateSubjectInput,
} from '../validators/assignment.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

// --- Assignments ------------------------------------------------------------

export async function list(req: Request, res: Response): Promise<void> {
  const result = await assignmentService.listAssignments(
    userId(req),
    req.query as unknown as ListAssignmentsQuery,
  );
  res.json({ success: true, data: result.items, pagination: result.pagination });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const assignment = await assignmentService.getAssignment(userId(req), req.params.id as string);
  res.json({ success: true, data: assignment });
}

export async function create(req: Request, res: Response): Promise<void> {
  const assignment = await assignmentService.createAssignment(
    userId(req),
    req.body as CreateAssignmentInput,
  );
  res.status(201).json({ success: true, data: assignment });
}

export async function update(req: Request, res: Response): Promise<void> {
  const assignment = await assignmentService.updateAssignment(
    userId(req),
    req.params.id as string,
    req.body as UpdateAssignmentInput,
  );
  res.json({ success: true, data: assignment });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await assignmentService.deleteAssignment(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Assignment deleted' } });
}

export async function restore(req: Request, res: Response): Promise<void> {
  const assignment = await assignmentService.restoreAssignment(
    userId(req),
    req.params.id as string,
  );
  res.json({ success: true, data: assignment });
}

export async function bulkUpdate(req: Request, res: Response): Promise<void> {
  const updated = await assignmentService.bulkUpdate(userId(req), req.body as BulkUpdateInput);
  res.json({ success: true, data: { updated } });
}

export async function stats(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await assignmentService.getStats(userId(req)) });
}

export async function labels(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await assignmentService.listLabels(userId(req)) });
}

// --- Subjects ---------------------------------------------------------------

export async function listSubjects(req: Request, res: Response): Promise<void> {
  const includeArchived = req.query.includeArchived === 'true';
  res.json({ success: true, data: await subjectService.listSubjects(userId(req), includeArchived) });
}

export async function createSubject(req: Request, res: Response): Promise<void> {
  const subject = await subjectService.createSubject(userId(req), req.body as CreateSubjectInput);
  res.status(201).json({ success: true, data: subject });
}

export async function updateSubject(req: Request, res: Response): Promise<void> {
  const subject = await subjectService.updateSubject(
    userId(req),
    req.params.id as string,
    req.body as UpdateSubjectInput,
  );
  res.json({ success: true, data: subject });
}

export async function removeSubject(req: Request, res: Response): Promise<void> {
  await subjectService.deleteSubject(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Subject deleted' } });
}

// --- Dashboard --------------------------------------------------------------

export async function overview(req: Request, res: Response): Promise<void> {
  const days = Number(req.query.trendDays ?? 14);
  const trendDays = Number.isFinite(days) ? Math.min(Math.max(days, 7), 90) : 14;
  res.json({ success: true, data: await dashboardService.getOverview(userId(req), trendDays) });
}
