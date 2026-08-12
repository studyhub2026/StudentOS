import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mocks — we don't want a real database round-trip for ownership tests.
const findFirst = vi.fn();
const findUnique = vi.fn();
const findMany = vi.fn();
const count = vi.fn();
const update = vi.fn();
const create = vi.fn();
const upsert = vi.fn();
const deleteMany = vi.fn();
const $transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));

vi.mock('@/server/db', () => ({
  prisma: {
    mindMap: {
      findFirst: (a: unknown) => findFirst(a),
      findUnique: (a: unknown) => findUnique(a),
      findMany: (a: unknown) => findMany(a),
      create: (a: unknown) => create(a),
      update: (a: unknown) => update(a),
    },
    mindMapNode: {
      count: (a: unknown) => count(a),
      findMany: (a: unknown) => findMany(a),
      upsert: (a: unknown) => upsert(a),
      deleteMany: (a: unknown) => deleteMany(a),
      createMany: (a: unknown) => create(a),
    },
    mindMapEdge: {
      count: (a: unknown) => count(a),
      upsert: (a: unknown) => upsert(a),
      deleteMany: (a: unknown) => deleteMany(a),
      createMany: (a: unknown) => create(a),
    },
    subject: {
      findFirst: (a: unknown) => findFirst(a),
    },
    $transaction: (ops: unknown[]) => $transaction(ops),
  },
}));

const { persistBulk, requireOwner, createMindMap } = await import('./mind-map.service');
const { ForbiddenError, NotFoundError, BadRequestError } = await import('@/server/lib/errors');

beforeEach(() => {
  findFirst.mockReset();
  findUnique.mockReset();
  findMany.mockReset();
  count.mockReset();
  update.mockReset();
  create.mockReset();
  upsert.mockReset();
  deleteMany.mockReset();
  $transaction.mockReset();
  $transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
});

describe('mind-map service — ownership', () => {
  it('requireOwner throws NotFound when the map does not exist', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(requireOwner('u1', 'm1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requireOwner throws Forbidden when the map belongs to another user', async () => {
    // Simulates USER A trying to open USER B's mind map by URL manipulation.
    findUnique.mockResolvedValueOnce({ userId: 'user-B', deletedAt: null });
    await expect(requireOwner('user-A', 'm1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requireOwner treats a soft-deleted map as gone', async () => {
    findUnique.mockResolvedValueOnce({ userId: 'u1', deletedAt: new Date() });
    await expect(requireOwner('u1', 'm1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requireOwner accepts the real owner', async () => {
    findUnique.mockResolvedValueOnce({ userId: 'u1', deletedAt: null });
    await expect(requireOwner('u1', 'm1')).resolves.toBeUndefined();
  });
});

describe('mind-map service — createMindMap', () => {
  it('rejects a subjectId that does not belong to the user', async () => {
    findFirst.mockResolvedValueOnce(null); // subject not found for this user
    await expect(
      createMindMap('u1', { title: 'T', subjectId: 'other-subject' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('creates a mind map with a valid subject', async () => {
    findFirst.mockResolvedValueOnce({ id: 's1' });
    create.mockResolvedValueOnce({ id: 'm1', title: 'T', createdAt: new Date() });
    const map = await createMindMap('u1', { title: 'T', subjectId: 's1' });
    expect(map.id).toBe('m1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectId: 's1', userId: 'u1' }),
      }),
    );
  });
});

describe('mind-map service — persistBulk referential integrity', () => {
  beforeEach(() => {
    // A well-owned map with no existing nodes/edges.
    findUnique.mockResolvedValueOnce({ userId: 'u1', deletedAt: null });
    count.mockResolvedValue(0);
    findMany.mockResolvedValueOnce([]); // no existing node ids
  });

  it('rejects an edge referencing a node that does not exist and is not being created', async () => {
    await expect(
      persistBulk('u1', 'm1', {
        nodes: [{ id: 'n1', title: 'A' }],
        edges: [{ id: 'e1', sourceId: 'n1', targetId: 'nonexistent' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('accepts an edge whose endpoints are being created in the same batch', async () => {
    upsert.mockResolvedValue({});
    update.mockResolvedValue({ updatedAt: new Date() });
    await expect(
      persistBulk('u1', 'm1', {
        nodes: [
          { id: 'n1', title: 'A' },
          { id: 'n2', title: 'B' },
        ],
        edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n2' }],
      }),
    ).resolves.toHaveProperty('updatedAt');
  });
});

describe('mind-map service — persistBulk ownership', () => {
  it('refuses bulk writes to a map owned by another user (IDOR guard)', async () => {
    findUnique.mockResolvedValueOnce({ userId: 'user-B', deletedAt: null });
    await expect(
      persistBulk('user-A', 'm1', {
        nodes: [{ id: 'n1', title: 'Hostile' }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
