import { z } from 'zod';

/**
 * Zod schemas for the mind-map API surface. Kept alongside the service so the
 * router and the tests can share the same shape.
 */

const nodeType = z.string().min(1).max(40);
const cuid = z.string().min(6).max(40);

export const createMindMapSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  subjectId: z.string().optional(),
  settings: z.unknown().optional(),
});

export const updateMindMapSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  favorite: z.boolean().optional(),
  subjectId: z.string().nullable().optional(),
  settings: z.unknown().optional(),
});

export const listMindMapsSchema = z.object({
  favorite: z.coerce.boolean().optional(),
  search: z.string().max(120).optional(),
});

export const nodeUpsertSchema = z.object({
  id: cuid,
  parentId: cuid.nullable().optional(),
  type: nodeType.optional(),
  title: z.string().min(1).max(300).optional(),
  content: z.string().max(20000).nullable().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  color: z.string().max(30).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  refType: z.string().max(30).nullable().optional(),
  refId: z.string().max(60).nullable().optional(),
  style: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

export const edgeUpsertSchema = z.object({
  id: cuid,
  sourceId: cuid,
  targetId: cuid,
  label: z.string().max(120).nullable().optional(),
  type: z.string().max(30).optional(),
  style: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

export const bulkSaveSchema = z.object({
  meta: updateMindMapSchema.optional(),
  nodes: z.array(nodeUpsertSchema).max(500).optional(),
  edges: z.array(edgeUpsertSchema).max(500).optional(),
  deletedNodeIds: z.array(cuid).max(500).optional(),
  deletedEdgeIds: z.array(cuid).max(500).optional(),
});

/**
 * Shape returned by every AI generator. Titles are trimmed and lengths capped
 * so a runaway model reply can't fill the DB with megabytes of text.
 */
export const aiGeneratedGraphSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        type: nodeType.default('topic'),
        title: z.string().min(1).max(200),
        content: z.string().max(2000).optional(),
        color: z.string().max(30).optional(),
        icon: z.string().max(60).optional(),
        tags: z.array(z.string().max(60)).max(10).optional(),
        parentId: z.string().max(60).nullable().optional(),
      }),
    )
    .min(1)
    .max(150),
  edges: z
    .array(
      z.object({
        source: z.string().min(1).max(60),
        target: z.string().min(1).max(60),
        label: z.string().max(120).optional(),
      }),
    )
    .max(300)
    .optional()
    .default([]),
});
export type AiGeneratedGraph = z.infer<typeof aiGeneratedGraphSchema>;

export const generateMindMapSchema = z.object({
  prompt: z.string().min(2).max(2000),
  subjectId: z.string().optional(),
  noteIds: z.array(z.string()).max(20).optional(),
  documentIds: z.array(z.string()).max(10).optional(),
  lmsCourseId: z.string().optional(),
  includeCourseContext: z.boolean().optional(),
  depth: z.enum(['shallow', 'normal', 'deep']).default('normal'),
});

export const mapActionSchema = z.object({
  action: z.enum(['summarise-map', 'study-guide', 'analyse']),
});

export const branchActionSchema = z.object({
  action: z.enum(['summarise-branch']),
  nodeId: z.string().min(1).max(60),
});

export const chatMapSchema = z.object({
  question: z.string().min(1).max(1000),
  selectedNodeId: z.string().max(60).optional(),
});

export const expandNodeSchema = z.object({
  count: z.number().int().min(1).max(10).default(5),
});

export const nodeActionSchema = z.object({
  action: z.enum(['explain-simple', 'explain-detail', 'examples', 'quiz', 'flashcards', 'related']),
});
