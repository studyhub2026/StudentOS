import 'server-only';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { generateJson } from '@/server/services/gemini.service';
import * as mindMap from '@/server/services/mind-map.service';
import { aiGeneratedGraphSchema, type AiGeneratedGraph } from '@/server/validators/mind-map.validator';
import { newMindId } from '@/lib/mind-map-ids';

/**
 * AI generation for mind maps. Uses the same `generateJson` path as every
 * other AI feature so schema validation is consistent — Gemini's output goes
 * through Zod before we ever persist it, and we cap sizes so a runaway model
 * can't blow past the map limits enforced downstream in the service.
 */

const AI_GRAPH_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['root', 'topic', 'subtopic', 'concept', 'definition', 'example', 'question', 'task', 'resource'] },
          title: { type: 'string' },
          content: { type: 'string' },
          parentId: { type: 'string' },
        },
        required: ['id', 'type', 'title'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['source', 'target'],
      },
    },
  },
  required: ['title', 'nodes'],
} as const;

const SYSTEM_GENERATE = [
  'You produce structured mind maps for a student. Return one and only one root',
  'node. Group ideas hierarchically: 3–7 topics under the root, 2–5 subtopics per',
  'topic when the material justifies it. Do NOT explain the map in prose —',
  'return the JSON only. Node ids are short kebab-case slugs. Every non-root',
  'node needs a parentId that references another node. Keep titles concise',
  '(≤ 8 words) and content optional (≤ 200 chars).',
].join(' ');

/**
 * Generates a full mind map from a free-text prompt (optionally biased by an
 * existing subject and/or a set of notes the student picked).
 */
export async function generateMindMapFromPrompt(
  userId: string,
  input: { prompt: string; subjectId?: string; noteIds?: string[]; depth?: 'shallow' | 'normal' | 'deep' },
): Promise<{ mapId: string; graph: AiGeneratedGraph }> {
  // Optional context — bounded so we never ship an entire subject's notes.
  let context = '';
  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, userId },
      select: { id: true, name: true, code: true },
    });
    if (!subject) throw new BadRequestError('Subject not found or not yours');
    context += `Related course: ${subject.name}${subject.code ? ` (${subject.code})` : ''}.\n`;
  }
  if (input.noteIds && input.noteIds.length > 0) {
    const notes = await prisma.note.findMany({
      where: { id: { in: input.noteIds }, userId, deletedAt: null },
      select: { title: true, excerpt: true, content: true },
      take: 5,
    });
    if (notes.length === 0) throw new BadRequestError('No matching notes');
    context += 'Excerpts from the student\'s notes:\n';
    for (const n of notes) {
      const body = (n.excerpt ?? n.content ?? '').slice(0, 400);
      context += `- ${n.title}: ${body}\n`;
    }
  }

  const targetCounts = input.depth === 'deep' ? '8–12 topics, 3–5 subtopics each'
    : input.depth === 'shallow' ? '3–5 topics, 1–2 subtopics each'
    : '5–8 topics, 2–4 subtopics each';

  const prompt = [
    context,
    `Create a mind map for: ${input.prompt}`,
    `Target size: ${targetCounts}.`,
    'Use node types root/topic/subtopic/concept/definition/example.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const graph = await callGraphModel({
    system: SYSTEM_GENERATE,
    userPrompt: prompt,
  });

  // Materialise into a new mind map. The nodes/edges are stored with client
  // ids so the editor can refer to them without renaming after generation.
  const newMap = await mindMap.createMindMap(userId, {
    title: graph.title,
    description: graph.description,
    subjectId: input.subjectId,
    aiGenerated: true,
  });

  const { nodes, edges } = laidOutFromAi(graph);
  await mindMap.replaceGraph(userId, newMap.id, { nodes, edges });
  return { mapId: newMap.id, graph };
}

/**
 * Expands a single node into 3–10 children. Called with a preview flow: the
 * client renders the returned children optimistically before persisting via
 * the normal bulk-save path.
 */
export async function expandNode(
  userId: string,
  mapId: string,
  nodeId: string,
  count = 5,
): Promise<{ nodes: { id: string; type: string; title: string; content?: string }[] }> {
  await mindMap.requireOwner(userId, mapId);
  const source = await prisma.mindMapNode.findFirst({
    where: { id: nodeId, mindMapId: mapId },
    select: { title: true, content: true, type: true },
  });
  if (!source) throw new NotFoundError('Node');

  // Grab siblings/parent so the model knows the neighbourhood — this stops
  // it from just repeating whatever the root already covers.
  const siblings = await prisma.mindMapNode.findMany({
    where: { mindMapId: mapId, id: { not: nodeId } },
    select: { title: true },
    take: 30,
  });

  const prompt = [
    `Expand this mind-map node into ${count} distinct child concepts.`,
    `Node title: ${source.title}`,
    source.content ? `Node notes: ${source.content}` : '',
    siblings.length > 0
      ? `Existing sibling/parent titles (do NOT duplicate these):\n${siblings.map((s) => `- ${s.title}`).join('\n')}`
      : '',
    'Return { title (short), description (optional), nodes: [...], edges: [] } — the nodes should all have the source node as parentId "root", using ids you invent. Types should be subtopic or concept.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const graph = await callGraphModel({
    system:
      'You expand mind-map nodes with concrete child concepts. Return ' +
      `${count} distinct nodes. Titles ≤ 6 words. No duplicates of the parent or its siblings.`,
    userPrompt: prompt,
    minNodes: 1,
    maxNodes: count + 1, // +1 for the placeholder root the AI is asked to emit
  });

  // The AI emits a synthetic root; strip it and rename ids so they're safe
  // for the editor.
  const children = graph.nodes.filter((n) => n.type !== 'root').slice(0, count);
  return {
    nodes: children.map((n) => ({
      id: newMindId('n'),
      type: n.type,
      title: n.title,
      ...(n.content ? { content: n.content } : {}),
    })),
  };
}

/**
 * Runs a small, focused AI action on a single node (explain, quiz, flashcards,
 * examples, related). Returns plain-text output — we deliberately don't try
 * to jam the response back into the map, because the user should be able to
 * read it in situ first.
 */
export async function runNodeAction(
  userId: string,
  mapId: string,
  nodeId: string,
  action: 'explain-simple' | 'explain-detail' | 'examples' | 'quiz' | 'flashcards' | 'related',
): Promise<{ text: string }> {
  await mindMap.requireOwner(userId, mapId);
  const node = await prisma.mindMapNode.findFirst({
    where: { id: nodeId, mindMapId: mapId },
    select: { title: true, content: true, type: true },
  });
  if (!node) throw new NotFoundError('Node');

  const instructions: Record<typeof action, string> = {
    'explain-simple': `Explain "${node.title}" simply, for a first-year student, in ≤ 120 words.`,
    'explain-detail': `Explain "${node.title}" in depth, including the mechanism and edge cases, in ≤ 300 words.`,
    examples: `Give 3 concrete real-world examples of "${node.title}", each 1–2 sentences.`,
    quiz: `Write 3 quiz questions about "${node.title}" with their answers. Number each Q. Include difficulty (easy/medium/hard).`,
    flashcards: `Produce 5 study flashcards for "${node.title}". Format each as "Front: … / Back: …". Keep answers concise.`,
    related: `List 5 concepts related to "${node.title}" that a student should study alongside it, each with a one-line reason.`,
  };

  const promptText = [
    instructions[action],
    node.content ? `Extra context on this concept:\n${node.content}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const outSchema = z.object({ text: z.string().min(1).max(5000) });
  const result = await generateJson<z.infer<typeof outSchema>>({
    systemInstruction:
      'You are a study assistant. Produce the requested content in plain text (no JSON keys, no markdown wrappers). Be accurate and concise.',
    messages: [{ role: 'user', content: promptText }],
    responseSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    } as unknown as Record<string, unknown>,
    parse: (v) => outSchema.parse(v),
  });
  return { text: result.data.text };
}

// ---------------------------------------------------------------------------

async function callGraphModel({
  system,
  userPrompt,
  minNodes = 1,
  maxNodes = 150,
}: {
  system: string;
  userPrompt: string;
  minNodes?: number;
  maxNodes?: number;
}): Promise<AiGeneratedGraph> {
  const result = await generateJson<AiGeneratedGraph>({
    systemInstruction: system,
    messages: [{ role: 'user', content: userPrompt }],
    responseSchema: AI_GRAPH_SCHEMA as unknown as Record<string, unknown>,
    parse: (v) => {
      const parsed = aiGeneratedGraphSchema.parse(v);
      if (parsed.nodes.length < minNodes) throw new Error('AI returned too few nodes');
      if (parsed.nodes.length > maxNodes) throw new Error('AI returned too many nodes');
      return parsed;
    },
  });
  return result.data;
}

/**
 * Turns the AI graph (which uses opaque ids and lacks positions) into the
 * server-ready node/edge shape. We rewrite ids to safe client ids, build
 * parent-based edges when the AI omitted them, and drop the actual XY
 * layout in a simple radial fan (the client can re-run auto-layout after).
 */
function laidOutFromAi(graph: AiGeneratedGraph) {
  // AI id → client id.
  const idMap = new Map<string, string>();
  for (const n of graph.nodes) idMap.set(n.id, newMindId('n'));

  const rootIds = graph.nodes.filter((n) => n.type === 'root').map((n) => idMap.get(n.id)!);
  const chosenRoot = rootIds[0] ?? idMap.get(graph.nodes[0]!.id)!;

  // Level assignment via parent chain, defaulting orphans to depth 1.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  function depthOf(id: string, seen = new Set<string>()): number {
    if (seen.has(id)) return 1;
    seen.add(id);
    const node = byId.get(id);
    if (!node || !node.parentId || !byId.has(node.parentId)) return node?.type === 'root' ? 0 : 1;
    return depthOf(node.parentId, seen) + 1;
  }
  const levels = new Map<string, number>();
  for (const n of graph.nodes) levels.set(n.id, depthOf(n.id));

  const grouped = new Map<number, string[]>();
  for (const [id, d] of levels) {
    if (!grouped.has(d)) grouped.set(d, []);
    grouped.get(d)!.push(id);
  }

  const nodes = graph.nodes.map((n) => {
    const depth = levels.get(n.id) ?? 1;
    const peers = grouped.get(depth) ?? [];
    const idx = peers.indexOf(n.id);
    const angle = peers.length > 1 ? (idx / peers.length) * Math.PI * 2 : 0;
    const radius = depth * 220;
    return {
      id: idMap.get(n.id)!,
      parentId: n.parentId ? idMap.get(n.parentId) ?? null : null,
      type: n.type,
      title: n.title,
      content: n.content ?? null,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      tags: [],
      metadata: { aiGenerated: true },
    };
  });

  // Ensure a single root sits at (0, 0).
  const rootNode = nodes.find((n) => n.id === chosenRoot);
  if (rootNode) {
    rootNode.x = 0;
    rootNode.y = 0;
  }

  // Prefer AI-supplied edges; fall back to parent-child edges when missing.
  const edges = graph.edges && graph.edges.length > 0
    ? graph.edges
        .map((e) => ({
          id: newMindId('e'),
          sourceId: idMap.get(e.source),
          targetId: idMap.get(e.target),
          label: e.label ?? null,
        }))
        .filter((e): e is { id: string; sourceId: string; targetId: string; label: string | null } =>
          !!e.sourceId && !!e.targetId,
        )
    : graph.nodes
        .filter((n) => n.parentId && byId.has(n.parentId))
        .map((n) => ({
          id: newMindId('e'),
          sourceId: idMap.get(n.parentId!)!,
          targetId: idMap.get(n.id)!,
          label: null,
        }));

  return { nodes, edges };
}
