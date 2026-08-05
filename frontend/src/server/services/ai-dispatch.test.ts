import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock module boundaries so the dispatcher can be tested without a Gemini key,
// a Postgres database or the wider service graph. Each mock records its calls
// so we can assert what the dispatcher would create for a given plan.

const generateJson = vi.fn();
const createAssignment = vi.fn(async () => ({ id: 'a1', title: 'A' }));
const createBlock = vi.fn(async () => ({
  id: 'b1',
  title: 'B',
  startAt: new Date('2026-08-10T18:00:00Z'),
}));
const findFirstSubject = vi.fn(async () => null);
const createNotification = vi.fn(async () => ({ id: 'n1', title: 'N' }));

vi.mock('./gemini.service', () => ({
  generateJson: (opts: { parse: (v: unknown) => unknown }) => generateJson(opts),
}));
vi.mock('./assignment.service', () => ({ createAssignment }));
vi.mock('./schedule.service', () => ({ createBlock }));
vi.mock('@/server/db', () => ({
  prisma: {
    subject: { findFirst: findFirstSubject },
    notification: { create: createNotification },
  },
}));

// Import AFTER the mocks so the module picks them up.
const { runDispatch } = await import('./ai-dispatch.service');

beforeEach(() => {
  generateJson.mockReset();
  createAssignment.mockReset().mockResolvedValue({ id: 'a1', title: 'A' });
  createBlock
    .mockReset()
    .mockResolvedValue({ id: 'b1', title: 'B', startAt: new Date('2026-08-10T18:00:00Z') });
  createNotification.mockReset().mockResolvedValue({ id: 'n1', title: 'N' });
  findFirstSubject.mockReset().mockResolvedValue(null);
});

describe('runDispatch', () => {
  it('creates each planned assignment, block and notification and returns them grouped', async () => {
    generateJson.mockImplementationOnce(async ({ parse }: { parse: (v: unknown) => unknown }) => ({
      data: parse({
        summary: 'Booked calculus.',
        assignments: [{ title: 'Cold War essay', priority: 'HIGH' }],
        blocks: [
          {
            title: 'Study calculus',
            type: 'STUDY',
            startAt: '2026-08-10T18:00:00Z',
            endAt: '2026-08-10T19:30:00Z',
          },
        ],
        notifications: [{ title: 'Hand in physics lab' }],
      }),
    }));

    const result = await runDispatch('u1', 'Study calculus tomorrow from 7pm for 90 minutes.');

    expect(result.summary).toBe('Booked calculus.');
    expect(result.createdAssignments).toHaveLength(1);
    expect(result.createdBlocks).toHaveLength(1);
    expect(result.createdNotifications).toHaveLength(1);
    expect(createAssignment).toHaveBeenCalledOnce();
    expect(createBlock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        title: 'Study calculus',
        type: 'STUDY',
        allowOverlap: true,
      }),
    );
  });

  it('collects per-item errors as warnings instead of aborting the batch', async () => {
    createAssignment.mockRejectedValueOnce(new Error('subject not owned'));
    generateJson.mockImplementationOnce(async ({ parse }: { parse: (v: unknown) => unknown }) => ({
      data: parse({
        summary: 'Best effort.',
        assignments: [{ title: 'One' }, { title: 'Two' }],
      }),
    }));

    const result = await runDispatch('u1', 'add two assignments');

    expect(result.createdAssignments).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/One/);
  });

  it('leaves subjectId unset when no subject matches the hint', async () => {
    findFirstSubject.mockResolvedValueOnce(null);
    generateJson.mockImplementationOnce(async ({ parse }: { parse: (v: unknown) => unknown }) => ({
      data: parse({
        summary: 'ok',
        assignments: [{ title: 'x', subjectHint: 'Nonexistent Subject' }],
      }),
    }));

    await runDispatch('u1', 'x');

    expect(createAssignment).toHaveBeenCalledWith(
      'u1',
      expect.not.objectContaining({ subjectId: expect.any(String) }),
    );
  });
});
