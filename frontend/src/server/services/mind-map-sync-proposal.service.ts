import 'server-only';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { resolveProvider } from '@/server/ai/router';
import * as mindMap from '@/server/services/mind-map.service';
import { newMindId } from '@/lib/mind-map-ids';

/**
 * Mind-map ↔ LMS sync bridge.
 *
 * When the sync engine finishes importing new material from a Moodle/Canvas
 * course, we look for mind maps attached to the same local subject and ask
 * the AI what nodes/edges the student might want to add. Every suggestion is
 * written as a MindMapSyncProposal row — nothing touches the map itself
 * until the student clicks Apply.
 *
 * Rules:
 * - Never overwrite existing nodes. Proposals only *add* new nodes/edges.
 * - Bounded input: at most 8 recent LMS assignments + 8 files + 5 announcements
 *   per course, and only material from the last 7 days by default.
 * - Runs in the background off the sync completion event, so it never
 *   blocks the sync itself or the user-facing sync-complete notification.
 */

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    rationale: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          parentTitle: { type: 'string' },
        },
        required: ['id', 'type', 'title'],
      },
    },
  },
  required: ['summary', 'nodes'],
} as const;

const proposalSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  rationale: z.string().trim().max(600).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        type: z.string().min(1).max(40),
        title: z.string().min(1).max(200),
        content: z.string().max(600).optional(),
        parentTitle: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(15),
});

interface ProposalPayload {
  summary: string;
  rationale: string | null;
  nodes: {
    clientId: string; // new node id we'll assign if applied
    type: string;
    title: string;
    content: string | null;
    parentNodeId: string | null; // resolved to an existing node in the map
  }[];
  edges: { source: string; target: string }[];
}

/**
 * Build a proposal for one map from recent LMS material on the linked
 * subject. Returns null when there's nothing new worth proposing.
 */
export async function buildProposalForMap(
  userId: string,
  mapId: string,
  connectionId?: string,
): Promise<ProposalPayload | null> {
  const map = await prisma.mindMap.findFirst({
    where: { id: mapId, userId, deletedAt: null },
    select: {
      id: true,
      title: true,
      subjectId: true,
      nodes: { select: { id: true, title: true, type: true } },
    },
  });
  if (!map || !map.subjectId) return null;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [assignments, files, announcements] = await Promise.all([
    prisma.lmsAssignment.findMany({
      where: {
        connection: { userId },
        course: { localSubjectId: map.subjectId },
        OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { title: true, description: true, dueAt: true },
    }),
    prisma.lmsFile.findMany({
      where: {
        connection: { userId },
        course: { localSubjectId: map.subjectId },
        OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { filename: true },
    }),
    prisma.lmsAnnouncement.findMany({
      where: {
        connection: { userId },
        course: { localSubjectId: map.subjectId },
        OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }],
      },
      orderBy: { postedAt: 'desc' },
      take: 5,
      select: { title: true, body: true },
    }),
  ]);

  const hasNewMaterial = assignments.length + files.length + announcements.length > 0;
  if (!hasNewMaterial) return null;

  const existingTitles = new Set(map.nodes.map((n) => n.title.toLowerCase()));
  const contextParts: string[] = [`Mind map: "${map.title}".`];
  contextParts.push(
    'Existing nodes (do NOT propose duplicates):\n' +
      map.nodes.map((n) => `- ${n.title} (${n.type})`).join('\n'),
  );
  if (assignments.length > 0) {
    contextParts.push(
      'New/updated assignments in the last 7 days:\n' +
        assignments
          .map((a) => `- ${a.title}${a.description ? `: ${a.description.slice(0, 160)}` : ''}`)
          .join('\n'),
    );
  }
  if (files.length > 0) {
    contextParts.push(
      'New/updated course files:\n' + files.map((f) => `- ${f.filename}`).join('\n'),
    );
  }
  if (announcements.length > 0) {
    contextParts.push(
      'New announcements:\n' +
        announcements
          .map((a) => `- ${a.title}${a.body ? `: ${a.body.slice(0, 160)}` : ''}`)
          .join('\n'),
    );
  }

  const provider = resolveProvider({ task: 'mindmap-generate' });
  try {
    const result = await provider.generateJson<z.infer<typeof proposalSchema>>({
      systemInstruction:
        'You extend a student\'s existing mind map with concepts drawn from newly-arrived LMS ' +
        'material. Propose 1–8 NEW nodes only — never duplicate an existing title. Each node ' +
        'should be a distinct concept, topic or task, tied to a parent title from the existing ' +
        'nodes if a natural home exists (parentTitle). Titles ≤ 6 words. Return JSON matching ' +
        'the given schema.',
      messages: [{ role: 'user', content: contextParts.join('\n\n') }],
      responseSchema: PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
      parse: (v) => proposalSchema.parse(v),
    });

    // Filter duplicates and resolve parent references.
    const proposedNodes = result.data.nodes.filter(
      (n) => !existingTitles.has(n.title.toLowerCase()),
    );
    if (proposedNodes.length === 0) return null;

    const titleToNodeId = new Map(
      map.nodes.map((n) => [n.title.toLowerCase(), n.id]),
    );

    const nodes = proposedNodes.map((n) => ({
      clientId: newMindId('n'),
      type: n.type,
      title: n.title,
      content: n.content ?? null,
      parentNodeId: n.parentTitle
        ? titleToNodeId.get(n.parentTitle.toLowerCase()) ?? null
        : null,
    }));

    // Build parent → child edges for every proposed node with a resolved parent.
    const edges = nodes
      .filter((n) => n.parentNodeId)
      .map((n) => ({ source: n.parentNodeId!, target: n.clientId }));

    return {
      summary: result.data.summary,
      rationale: result.data.rationale ?? null,
      nodes,
      edges,
    };
  } catch (err) {
    logger.warn({ err, mapId, connectionId }, 'mind-map sync proposal generation failed');
    return null;
  }
}

/**
 * Persist a proposal row. Called from the event handler after
 * buildProposalForMap succeeds.
 */
export async function persistProposal(
  userId: string,
  mapId: string,
  connectionId: string | null,
  payload: ProposalPayload,
): Promise<string> {
  const created = await prisma.mindMapSyncProposal.create({
    data: {
      mindMapId: mapId,
      userId,
      connectionId,
      summary: payload.summary,
      changes: payload as unknown as object,
    },
    select: { id: true },
  });
  return created.id;
}

export async function listProposals(userId: string, mapId: string) {
  await mindMap.requireOwner(userId, mapId);
  return prisma.mindMapSyncProposal.findMany({
    where: { mindMapId: mapId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      summary: true,
      changes: true,
      connectionId: true,
      createdAt: true,
    },
  });
}

export async function applyProposal(userId: string, mapId: string, proposalId: string) {
  const proposal = await prisma.mindMapSyncProposal.findFirst({
    where: { id: proposalId, mindMapId: mapId, userId, status: 'PENDING' },
  });
  if (!proposal) throw new NotFoundError('Proposal');
  await mindMap.requireOwner(userId, mapId);

  const changes = proposal.changes as unknown as ProposalPayload;
  if (!changes.nodes || changes.nodes.length === 0) {
    throw new BadRequestError('Proposal has no nodes');
  }

  // Materialise into the map through the ownership-safe bulk-save path so
  // node/edge count limits + referential integrity + updatedAt bump all
  // fire as they would for any manual edit.
  await mindMap.persistBulk(userId, mapId, {
    nodes: changes.nodes.map((n) => ({
      id: n.clientId,
      type: n.type,
      title: n.title,
      content: n.content,
      parentId: n.parentNodeId,
      // Position: fan below the parent when we know it, else near origin.
      // The client can re-run auto-layout after review.
      x: 0,
      y: 0,
      metadata: {
        source: {
          type: 'lms_course' as const,
          id: proposal.connectionId ?? undefined,
          title: changes.summary,
          generatedAt: proposal.createdAt.toISOString(),
        },
      },
    })),
    edges: changes.edges.map((e) => ({
      id: newMindId('e'),
      sourceId: e.source,
      targetId: e.target,
    })),
  });

  await prisma.mindMapSyncProposal.update({
    where: { id: proposalId },
    data: { status: 'APPLIED', respondedAt: new Date() },
  });
}

export async function dismissProposal(userId: string, mapId: string, proposalId: string) {
  const proposal = await prisma.mindMapSyncProposal.findFirst({
    where: { id: proposalId, mindMapId: mapId, userId },
    select: { id: true },
  });
  if (!proposal) throw new NotFoundError('Proposal');
  await prisma.mindMapSyncProposal.updateMany({
    where: { id: proposalId, userId, status: 'PENDING' },
    data: { status: 'DISMISSED', respondedAt: new Date() },
  });
}

/**
 * Handler for the lms.sync.completed event. Called fire-and-forget from
 * the event bus. Enumerates maps attached to any subject touched by this
 * connection and enqueues one proposal per map.
 *
 * Own concurrency guard so a burst of sync completions doesn't kick off
 * duplicate AI calls for the same map.
 */
const inFlight = new Set<string>();

export async function handleSyncCompleted(userId: string, connectionId: string): Promise<void> {
  try {
    // Get the connection's linked subjects (via its LmsCourses).
    const courses = await prisma.lmsCourse.findMany({
      where: { connectionId, connection: { userId } },
      select: { localSubjectId: true },
    });
    const subjectIds = [
      ...new Set(courses.map((c) => c.localSubjectId).filter((id): id is string => !!id)),
    ];
    if (subjectIds.length === 0) return;

    const maps = await prisma.mindMap.findMany({
      where: {
        userId,
        deletedAt: null,
        subjectId: { in: subjectIds },
      },
      select: { id: true },
      take: 20, // safety
    });

    for (const m of maps) {
      const key = `${userId}:${m.id}`;
      if (inFlight.has(key)) continue;
      inFlight.add(key);
      try {
        const payload = await buildProposalForMap(userId, m.id, connectionId);
        if (payload) {
          await persistProposal(userId, m.id, connectionId, payload);
          logger.info(
            { userId, mapId: m.id, nodeCount: payload.nodes.length },
            'mind-map sync proposal created',
          );
        }
      } catch (err) {
        logger.warn({ err, userId, mapId: m.id }, 'mind-map sync proposal handler failed');
      } finally {
        inFlight.delete(key);
      }
    }
  } catch (err) {
    logger.warn({ err, userId, connectionId }, 'mind-map sync proposal outer failure');
  }
}

// Ownership utility kept internal — routes should re-check via
// mindMap.requireOwner anyway.
export function _forceOwnerFail() {
  throw new ForbiddenError('unreachable');
}
