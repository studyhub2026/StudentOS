import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/lib/errors';

/**
 * Mind map persistence.
 *
 * Every read/write is scoped by ownership at this layer — never trust ids
 * from the request. All mutations go through here so the router doesn't have
 * to remember the ownership check.
 *
 * Bulk save (`persistBulk`) is the primary write path from the editor —
 * one round trip per debounced save, applied transactionally so a partial
 * batch can never leave dangling edges.
 */

const MAX_NODES_PER_MAP = 2000;
const MAX_EDGES_PER_MAP = 4000;

export type MindMapSummary = {
  id: string;
  title: string;
  description: string | null;
  favorite: boolean;
  aiGenerated: boolean;
  subjectId: string | null;
  subject: { id: string; name: string; color: string } | null;
  nodeCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function listMindMaps(userId: string, options: { favoriteOnly?: boolean; search?: string } = {}): Promise<MindMapSummary[]> {
  const where: Prisma.MindMapWhereInput = {
    userId,
    deletedAt: null,
    ...(options.favoriteOnly ? { favorite: true } : {}),
    ...(options.search
      ? {
          OR: [
            { title: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const rows = await prisma.mindMap.findMany({
    where,
    orderBy: [{ favorite: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      description: true,
      favorite: true,
      aiGenerated: true,
      subjectId: true,
      createdAt: true,
      updatedAt: true,
      subject: { select: { id: true, name: true, color: true } },
      _count: { select: { nodes: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    favorite: r.favorite,
    aiGenerated: r.aiGenerated,
    subjectId: r.subjectId,
    subject: r.subject,
    nodeCount: r._count.nodes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createMindMap(
  userId: string,
  input: { title: string; description?: string; subjectId?: string; aiGenerated?: boolean; settings?: unknown },
) {
  if (input.subjectId) {
    // Prevent binding to a subject the user doesn't own — otherwise IDs from
    // the request could leak subject existence.
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new BadRequestError('Subject not found or not yours');
  }

  return prisma.mindMap.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      subjectId: input.subjectId ?? null,
      aiGenerated: input.aiGenerated ?? false,
      settings: (input.settings ?? null) as Prisma.InputJsonValue,
    },
    select: { id: true, title: true, createdAt: true },
  });
}

/**
 * Loads a mind map for the editor. Returns nodes and edges alongside so a
 * single request seeds the whole canvas.
 */
export async function getMindMap(userId: string, mapId: string) {
  const map = await prisma.mindMap.findFirst({
    where: { id: mapId, userId, deletedAt: null },
    include: {
      subject: { select: { id: true, name: true, color: true } },
      nodes: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          parentId: true,
          type: true,
          title: true,
          content: true,
          x: true,
          y: true,
          color: true,
          icon: true,
          tags: true,
          refType: true,
          refId: true,
          style: true,
          metadata: true,
        },
      },
      edges: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          sourceId: true,
          targetId: true,
          label: true,
          type: true,
          style: true,
          metadata: true,
        },
      },
    },
  });
  if (!map) throw new NotFoundError('Mind map');
  return map;
}

export async function updateMindMapMeta(
  userId: string,
  mapId: string,
  patch: { title?: string; description?: string | null; favorite?: boolean; subjectId?: string | null; settings?: unknown },
) {
  await requireOwner(userId, mapId);

  if (patch.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: patch.subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new BadRequestError('Subject not found or not yours');
  }

  return prisma.mindMap.update({
    where: { id: mapId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
      ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
      ...(patch.settings !== undefined ? { settings: patch.settings as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, updatedAt: true },
  });
}

export async function deleteMindMap(userId: string, mapId: string) {
  await requireOwner(userId, mapId);
  // Soft delete: keep the row + cascaded rows so undo is possible up until
  // the row is purged. Cascade fires only on hard delete.
  await prisma.mindMap.update({
    where: { id: mapId },
    data: { deletedAt: new Date() },
  });
}

export async function duplicateMindMap(userId: string, mapId: string) {
  const source = await getMindMap(userId, mapId);

  const copy = await prisma.mindMap.create({
    data: {
      userId,
      title: `${source.title} (copy)`,
      description: source.description,
      subjectId: source.subjectId,
      aiGenerated: source.aiGenerated,
      settings: (source.settings ?? undefined) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  if (source.nodes.length > 0) {
    // Remap ids so parent/edge references in the copy point at the new nodes,
    // not the originals.
    const idMap = new Map(source.nodes.map((n) => [n.id, `${copy.id}-${n.id}`.slice(0, 30) + Math.random().toString(36).slice(2, 8)]));

    await prisma.mindMapNode.createMany({
      data: source.nodes.map((n) => ({
        id: idMap.get(n.id)!,
        mindMapId: copy.id,
        parentId: n.parentId ? idMap.get(n.parentId) ?? null : null,
        type: n.type,
        title: n.title,
        content: n.content,
        x: n.x,
        y: n.y,
        color: n.color,
        icon: n.icon,
        tags: n.tags,
        refType: n.refType,
        refId: n.refId,
        style: (n.style ?? undefined) as Prisma.InputJsonValue,
        metadata: (n.metadata ?? undefined) as Prisma.InputJsonValue,
      })),
    });

    if (source.edges.length > 0) {
      await prisma.mindMapEdge.createMany({
        data: source.edges
          .filter((e) => idMap.has(e.sourceId) && idMap.has(e.targetId))
          .map((e) => ({
            mindMapId: copy.id,
            sourceId: idMap.get(e.sourceId)!,
            targetId: idMap.get(e.targetId)!,
            label: e.label,
            type: e.type,
            style: (e.style ?? undefined) as Prisma.InputJsonValue,
            metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue,
          })),
      });
    }
  }

  return { id: copy.id };
}

/**
 * The primary editor write path: applies a diff of nodes + edges + map
 * settings in one transaction. Each side is optional so the client can send
 * only what actually changed.
 *
 * `nodes` and `edges` use *upsert* semantics keyed by id — a node id the
 * client sends that doesn't exist yet is created (client generates the id
 * so React Flow can keep referring to it during the debounce). Ids in
 * `deletedNodeIds`/`deletedEdgeIds` are removed.
 */
export interface NodeUpsert {
  id: string;
  parentId?: string | null;
  type?: string;
  title?: string;
  content?: string | null;
  x?: number;
  y?: number;
  color?: string | null;
  icon?: string | null;
  tags?: string[];
  refType?: string | null;
  refId?: string | null;
  style?: unknown;
  metadata?: unknown;
}

export interface EdgeUpsert {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string | null;
  type?: string;
  style?: unknown;
  metadata?: unknown;
}

export interface BulkSaveInput {
  meta?: { title?: string; description?: string | null; favorite?: boolean; subjectId?: string | null; settings?: unknown };
  nodes?: NodeUpsert[];
  edges?: EdgeUpsert[];
  deletedNodeIds?: string[];
  deletedEdgeIds?: string[];
}

export async function persistBulk(userId: string, mapId: string, input: BulkSaveInput) {
  await requireOwner(userId, mapId);

  // --- Size guards. Cheap to enforce and a good backstop against a runaway
  // client that keeps generating nodes on every render.
  const [existingNodeCount, existingEdgeCount] = await Promise.all([
    prisma.mindMapNode.count({ where: { mindMapId: mapId } }),
    prisma.mindMapEdge.count({ where: { mindMapId: mapId } }),
  ]);
  const newNodes = input.nodes?.length ?? 0;
  const newEdges = input.edges?.length ?? 0;
  if (existingNodeCount + newNodes > MAX_NODES_PER_MAP) {
    throw new BadRequestError(`Mind map exceeds the ${MAX_NODES_PER_MAP} node limit`);
  }
  if (existingEdgeCount + newEdges > MAX_EDGES_PER_MAP) {
    throw new BadRequestError(`Mind map exceeds the ${MAX_EDGES_PER_MAP} edge limit`);
  }

  // --- Referential integrity for edges. Every edge must reference a node
  // that either already exists in the map or is being created in this same
  // batch. Otherwise a bug in the client could persist an unrenderable edge.
  if (input.edges && input.edges.length > 0) {
    const existingIds = await prisma.mindMapNode.findMany({
      where: { mindMapId: mapId },
      select: { id: true },
    });
    const knownIds = new Set(existingIds.map((n) => n.id));
    for (const n of input.nodes ?? []) knownIds.add(n.id);
    for (const e of input.edges) {
      if (!knownIds.has(e.sourceId) || !knownIds.has(e.targetId)) {
        throw new BadRequestError(`Edge ${e.id} references an unknown node`);
      }
    }
  }

  // Subject reassignment via meta needs an ownership check too.
  if (input.meta?.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.meta.subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new BadRequestError('Subject not found or not yours');
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];

  if (input.deletedNodeIds && input.deletedNodeIds.length > 0) {
    ops.push(
      prisma.mindMapNode.deleteMany({
        where: { mindMapId: mapId, id: { in: input.deletedNodeIds } },
      }),
    );
    // Also drop any edges that referenced deleted nodes — the client should
    // send them explicitly, but this is a safety net for orphaned edges.
    ops.push(
      prisma.mindMapEdge.deleteMany({
        where: {
          mindMapId: mapId,
          OR: [
            { sourceId: { in: input.deletedNodeIds } },
            { targetId: { in: input.deletedNodeIds } },
          ],
        },
      }),
    );
  }
  if (input.deletedEdgeIds && input.deletedEdgeIds.length > 0) {
    ops.push(
      prisma.mindMapEdge.deleteMany({
        where: { mindMapId: mapId, id: { in: input.deletedEdgeIds } },
      }),
    );
  }

  for (const n of input.nodes ?? []) {
    ops.push(
      prisma.mindMapNode.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          mindMapId: mapId,
          parentId: n.parentId ?? null,
          type: n.type ?? 'topic',
          title: n.title ?? 'Node',
          content: n.content ?? null,
          x: n.x ?? 0,
          y: n.y ?? 0,
          color: n.color ?? null,
          icon: n.icon ?? null,
          tags: n.tags ?? [],
          refType: n.refType ?? null,
          refId: n.refId ?? null,
          style: (n.style ?? undefined) as Prisma.InputJsonValue,
          metadata: (n.metadata ?? undefined) as Prisma.InputJsonValue,
        },
        update: {
          ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
          ...(n.type !== undefined ? { type: n.type } : {}),
          ...(n.title !== undefined ? { title: n.title } : {}),
          ...(n.content !== undefined ? { content: n.content } : {}),
          ...(n.x !== undefined ? { x: n.x } : {}),
          ...(n.y !== undefined ? { y: n.y } : {}),
          ...(n.color !== undefined ? { color: n.color } : {}),
          ...(n.icon !== undefined ? { icon: n.icon } : {}),
          ...(n.tags !== undefined ? { tags: n.tags } : {}),
          ...(n.refType !== undefined ? { refType: n.refType } : {}),
          ...(n.refId !== undefined ? { refId: n.refId } : {}),
          ...(n.style !== undefined ? { style: n.style as Prisma.InputJsonValue } : {}),
          ...(n.metadata !== undefined ? { metadata: n.metadata as Prisma.InputJsonValue } : {}),
        },
      }),
    );
  }

  for (const e of input.edges ?? []) {
    ops.push(
      prisma.mindMapEdge.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          mindMapId: mapId,
          sourceId: e.sourceId,
          targetId: e.targetId,
          label: e.label ?? null,
          type: e.type ?? 'default',
          style: (e.style ?? undefined) as Prisma.InputJsonValue,
          metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue,
        },
        update: {
          ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
          ...(e.targetId !== undefined ? { targetId: e.targetId } : {}),
          ...(e.label !== undefined ? { label: e.label } : {}),
          ...(e.type !== undefined ? { type: e.type } : {}),
          ...(e.style !== undefined ? { style: e.style as Prisma.InputJsonValue } : {}),
          ...(e.metadata !== undefined ? { metadata: e.metadata as Prisma.InputJsonValue } : {}),
        },
      }),
    );
  }

  if (input.meta) {
    ops.push(
      prisma.mindMap.update({
        where: { id: mapId },
        data: {
          ...(input.meta.title !== undefined ? { title: input.meta.title } : {}),
          ...(input.meta.description !== undefined ? { description: input.meta.description } : {}),
          ...(input.meta.favorite !== undefined ? { favorite: input.meta.favorite } : {}),
          ...(input.meta.subjectId !== undefined ? { subjectId: input.meta.subjectId } : {}),
          ...(input.meta.settings !== undefined ? { settings: input.meta.settings as Prisma.InputJsonValue } : {}),
        },
      }),
    );
  }

  await prisma.$transaction(ops);
  // Bump updatedAt so list ordering follows edits even when only child rows
  // changed. This is cheap and lets `updatedAt` act as a reliable dirty clock.
  const updated = await prisma.mindMap.update({
    where: { id: mapId },
    data: { updatedAt: new Date() },
    select: { updatedAt: true },
  });
  return { updatedAt: updated.updatedAt };
}

/**
 * Overwrites the whole graph with a supplied set of nodes+edges. Used by
 * AI generate and import. Existing nodes/edges are removed first.
 */
export async function replaceGraph(
  userId: string,
  mapId: string,
  input: { nodes: NodeUpsert[]; edges: EdgeUpsert[]; meta?: BulkSaveInput['meta'] },
) {
  await requireOwner(userId, mapId);
  if (input.nodes.length > MAX_NODES_PER_MAP) throw new BadRequestError('Too many nodes');
  if (input.edges.length > MAX_EDGES_PER_MAP) throw new BadRequestError('Too many edges');

  const nodeIds = new Set(input.nodes.map((n) => n.id));
  for (const e of input.edges) {
    if (!nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)) {
      throw new BadRequestError(`Edge ${e.id} references an unknown node`);
    }
  }

  await prisma.$transaction([
    prisma.mindMapEdge.deleteMany({ where: { mindMapId: mapId } }),
    prisma.mindMapNode.deleteMany({ where: { mindMapId: mapId } }),
    prisma.mindMapNode.createMany({
      data: input.nodes.map((n) => ({
        id: n.id,
        mindMapId: mapId,
        parentId: n.parentId ?? null,
        type: n.type ?? 'topic',
        title: n.title ?? 'Node',
        content: n.content ?? null,
        x: n.x ?? 0,
        y: n.y ?? 0,
        color: n.color ?? null,
        icon: n.icon ?? null,
        tags: n.tags ?? [],
        refType: n.refType ?? null,
        refId: n.refId ?? null,
        style: (n.style ?? undefined) as Prisma.InputJsonValue,
        metadata: (n.metadata ?? undefined) as Prisma.InputJsonValue,
      })),
    }),
    prisma.mindMapEdge.createMany({
      data: input.edges.map((e) => ({
        id: e.id,
        mindMapId: mapId,
        sourceId: e.sourceId,
        targetId: e.targetId,
        label: e.label ?? null,
        type: e.type ?? 'default',
        style: (e.style ?? undefined) as Prisma.InputJsonValue,
        metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue,
      })),
    }),
    prisma.mindMap.update({
      where: { id: mapId },
      data: {
        ...(input.meta?.title !== undefined ? { title: input.meta.title } : {}),
        ...(input.meta?.description !== undefined ? { description: input.meta.description } : {}),
        updatedAt: new Date(),
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------

export async function requireOwner(userId: string, mapId: string): Promise<void> {
  const map = await prisma.mindMap.findUnique({
    where: { id: mapId },
    select: { userId: true, deletedAt: true },
  });
  if (!map || map.deletedAt) throw new NotFoundError('Mind map');
  if (map.userId !== userId) throw new ForbiddenError('Not your mind map');
}
