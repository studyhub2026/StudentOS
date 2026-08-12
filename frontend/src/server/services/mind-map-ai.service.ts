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
 * Standard source-descriptor that gets stamped onto every AI-generated node's
 * `metadata.source` field for traceability. Rendered as a chip in the node
 * inspector so the student can jump back to the original material.
 */
export type NodeSource =
  | { type: 'ai'; model?: string; generatedAt: string }
  | { type: 'note'; id: string; title: string; generatedAt: string; model?: string }
  | { type: 'document'; id: string; title: string; generatedAt: string; model?: string }
  | { type: 'course'; id: string; title: string; generatedAt: string; model?: string }
  | { type: 'lms_course'; id: string; title: string; generatedAt: string; model?: string }
  | { type: 'assignment'; id: string; title: string; generatedAt: string; model?: string };

/**
 * Extends the existing generation path with three extra source kinds — a
 * whole Subject (aggregates its assignments + LMS files/announcements), a
 * synced LMS course (same aggregation but scoped by LmsCourse), and a
 * Knowledge Base document (uses the ingested text of a KnowledgeDocument).
 *
 * Everything is bounded so we never ship the whole DB to the model:
 *   - subject: up to 8 assignment titles + 8 LMS file titles + 5 announcements
 *   - lms_course: up to 8 assignments + 8 files + 5 announcements from THAT course
 *   - knowledge_document: first ~2000 chars of the extracted content
 *   - notes: up to 5 note excerpts of ~400 chars each (unchanged)
 */
export async function generateMindMapFromPrompt(
  userId: string,
  input: {
    prompt: string;
    subjectId?: string;
    noteIds?: string[];
    depth?: 'shallow' | 'normal' | 'deep';
    /** Extended source hints; each is optional and additive. */
    documentIds?: string[];
    lmsCourseId?: string;
    /** When true and subjectId is set, aggregate assignments/files/announcements too. */
    includeCourseContext?: boolean;
  },
): Promise<{ mapId: string; graph: AiGeneratedGraph }> {
  // Context accumulator + a matching list of node sources we'll stamp on the
  // resulting nodes so the UI can render "from note X" / "from course Y" chips.
  const contextParts: string[] = [];
  const sources: NodeSource[] = [];
  const generatedAt = new Date().toISOString();

  let resolvedSubjectId = input.subjectId;

  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, userId },
      select: { id: true, name: true, code: true },
    });
    if (!subject) throw new BadRequestError('Subject not found or not yours');
    contextParts.push(`Related course: ${subject.name}${subject.code ? ` (${subject.code})` : ''}.`);
    sources.push({ type: 'course', id: subject.id, title: subject.name, generatedAt });

    if (input.includeCourseContext) {
      const [assignments, lmsFiles, announcements] = await Promise.all([
        prisma.assignment.findMany({
          where: { userId, subjectId: subject.id, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: { title: true, description: true },
        }),
        prisma.lmsFile.findMany({
          where: {
            connection: { userId },
            course: { localSubjectId: subject.id },
          },
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: { filename: true },
        }),
        prisma.lmsAnnouncement.findMany({
          where: {
            connection: { userId },
            course: { localSubjectId: subject.id },
          },
          orderBy: { postedAt: 'desc' },
          take: 5,
          select: { title: true, body: true },
        }),
      ]);

      if (assignments.length > 0) {
        contextParts.push(
          'Recent assignments:\n' +
            assignments.map((a) => `- ${a.title}${a.description ? `: ${a.description.slice(0, 120)}` : ''}`).join('\n'),
        );
      }
      if (lmsFiles.length > 0) {
        contextParts.push('Course materials:\n' + lmsFiles.map((f) => `- ${f.filename}`).join('\n'));
      }
      if (announcements.length > 0) {
        contextParts.push(
          'Recent announcements:\n' +
            announcements.map((n) => `- ${n.title}${n.body ? `: ${n.body.slice(0, 120)}` : ''}`).join('\n'),
        );
      }
    }
  }

  if (input.lmsCourseId) {
    const lms = await prisma.lmsCourse.findFirst({
      where: { id: input.lmsCourseId, connection: { userId } },
      select: {
        id: true,
        name: true,
        code: true,
        localSubjectId: true,
      },
    });
    if (!lms) throw new BadRequestError('LMS course not found or not yours');
    if (!resolvedSubjectId && lms.localSubjectId) resolvedSubjectId = lms.localSubjectId;

    const [asg, files, anns] = await Promise.all([
      prisma.lmsAssignment.findMany({
        where: { courseId: lms.id },
        orderBy: { remoteUpdatedAt: 'desc' },
        take: 8,
        select: { title: true, description: true },
      }),
      prisma.lmsFile.findMany({
        where: { courseId: lms.id },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { filename: true },
      }),
      prisma.lmsAnnouncement.findMany({
        where: { courseId: lms.id },
        orderBy: { postedAt: 'desc' },
        take: 5,
        select: { title: true, body: true },
      }),
    ]);

    contextParts.push(`Course (from LMS): ${lms.name}${lms.code ? ` (${lms.code})` : ''}.`);
    if (asg.length > 0) {
      contextParts.push('LMS assignments:\n' + asg.map((a) => `- ${a.title}${a.description ? `: ${a.description.slice(0, 120)}` : ''}`).join('\n'));
    }
    if (files.length > 0) contextParts.push('LMS files:\n' + files.map((f) => `- ${f.filename}`).join('\n'));
    if (anns.length > 0) {
      contextParts.push('LMS announcements:\n' + anns.map((n) => `- ${n.title}${n.body ? `: ${n.body.slice(0, 120)}` : ''}`).join('\n'));
    }
    sources.push({ type: 'lms_course', id: lms.id, title: lms.name, generatedAt });
  }

  if (input.noteIds && input.noteIds.length > 0) {
    const notes = await prisma.note.findMany({
      where: { id: { in: input.noteIds }, userId, deletedAt: null },
      select: { id: true, title: true, excerpt: true, content: true },
      take: 5,
    });
    if (notes.length === 0) throw new BadRequestError('No matching notes');
    contextParts.push("Excerpts from the student's notes:");
    for (const n of notes) {
      const body = (n.excerpt ?? n.content ?? '').slice(0, 400);
      contextParts.push(`- ${n.title}: ${body}`);
      sources.push({ type: 'note', id: n.id, title: n.title, generatedAt });
    }
  }

  if (input.documentIds && input.documentIds.length > 0) {
    const docs = await prisma.knowledgeDocument.findMany({
      where: { id: { in: input.documentIds }, userId },
      select: { id: true, filename: true, extractedText: true },
      take: 3,
    });
    if (docs.length === 0) throw new BadRequestError('No matching knowledge documents');
    contextParts.push('Excerpts from the student\'s Knowledge Base:');
    for (const d of docs) {
      const body = (d.extractedText ?? '').slice(0, 2000);
      contextParts.push(`### ${d.filename}\n${body}`);
      sources.push({ type: 'document', id: d.id, title: d.filename, generatedAt });
    }
  }

  const targetCounts =
    input.depth === 'deep'
      ? '8–12 topics, 3–5 subtopics each'
      : input.depth === 'shallow'
        ? '3–5 topics, 1–2 subtopics each'
        : '5–8 topics, 2–4 subtopics each';

  const prompt = [
    contextParts.join('\n\n'),
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

  const newMap = await mindMap.createMindMap(userId, {
    title: graph.title,
    description: graph.description,
    subjectId: resolvedSubjectId,
    aiGenerated: true,
  });

  const { nodes, edges } = laidOutFromAi(graph);
  // Stamp the first source (most specific) on every generated node so the UI
  // can render a traceability chip. Falls back to a plain 'ai' source when
  // the user just typed a prompt.
  const primarySource: NodeSource = sources[0] ?? { type: 'ai', generatedAt };
  for (const n of nodes) {
    n.metadata = { ...(n.metadata as Record<string, unknown> | null | undefined), source: primarySource };
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Whole-map / branch / chat actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialises a subtree rooted at `rootNodeId` into a bounded outline suitable
 * for feeding to Gemini. Uses the `parentId` field to reconstruct the tree
 * client-side rather than trusting edges (edges may model cross-links; we
 * only want the containment tree here).
 */
async function loadBranchOutline(mapId: string, rootNodeId: string, maxNodes = 80) {
  const allNodes = await prisma.mindMapNode.findMany({
    where: { mindMapId: mapId },
    select: { id: true, parentId: true, title: true, content: true, type: true },
  });
  const childrenBy = new Map<string, typeof allNodes>();
  for (const n of allNodes) {
    const key = n.parentId ?? '__root__';
    if (!childrenBy.has(key)) childrenBy.set(key, []);
    childrenBy.get(key)!.push(n);
  }
  const lines: string[] = [];
  let count = 0;
  function walk(id: string, depth: number) {
    if (count >= maxNodes) return;
    const node = allNodes.find((n) => n.id === id);
    if (!node) return;
    const indent = '  '.repeat(depth);
    const body = node.content ? ` — ${node.content.slice(0, 140)}` : '';
    lines.push(`${indent}- (${node.type}) ${node.title}${body}`);
    count++;
    for (const child of childrenBy.get(id) ?? []) walk(child.id, depth + 1);
  }
  walk(rootNodeId, 0);
  return lines.join('\n');
}

/** Same as loadBranchOutline but starts from every top-level (parent-less) node. */
async function loadMapOutline(mapId: string, maxNodes = 150) {
  const allNodes = await prisma.mindMapNode.findMany({
    where: { mindMapId: mapId },
    select: { id: true, parentId: true, title: true, content: true, type: true },
  });
  const childrenBy = new Map<string, typeof allNodes>();
  for (const n of allNodes) {
    const key = n.parentId ?? '__root__';
    if (!childrenBy.has(key)) childrenBy.set(key, []);
    childrenBy.get(key)!.push(n);
  }
  const roots = allNodes.filter((n) => !n.parentId || !allNodes.some((x) => x.id === n.parentId));
  const lines: string[] = [];
  let count = 0;
  function walk(id: string, depth: number) {
    if (count >= maxNodes) return;
    const node = allNodes.find((n) => n.id === id);
    if (!node) return;
    const body = node.content ? ` — ${node.content.slice(0, 100)}` : '';
    lines.push(`${'  '.repeat(depth)}- (${node.type}) ${node.title}${body}`);
    count++;
    for (const child of childrenBy.get(id) ?? []) walk(child.id, depth + 1);
  }
  for (const r of roots) walk(r.id, 0);
  return { outline: lines.join('\n'), nodeCount: allNodes.length };
}

async function runTextAction({
  system,
  userPrompt,
  maxLength = 5000,
}: {
  system: string;
  userPrompt: string;
  maxLength?: number;
}): Promise<{ text: string; model?: string }> {
  const outSchema = z.object({ text: z.string().min(1).max(maxLength) });
  const result = await generateJson<z.infer<typeof outSchema>>({
    systemInstruction: system,
    messages: [{ role: 'user', content: userPrompt }],
    responseSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    } as unknown as Record<string, unknown>,
    parse: (v) => outSchema.parse(v),
  });
  return { text: result.data.text, model: result.model };
}

export async function summariseBranch(userId: string, mapId: string, nodeId: string): Promise<{ text: string }> {
  await mindMap.requireOwner(userId, mapId);
  const root = await prisma.mindMapNode.findFirst({
    where: { id: nodeId, mindMapId: mapId },
    select: { title: true },
  });
  if (!root) throw new NotFoundError('Node');
  const outline = await loadBranchOutline(mapId, nodeId);
  return runTextAction({
    system:
      'You produce concise study summaries of mind-map branches. Extract the key concepts, ' +
      'important facts, and relationships between them. Plain text, no JSON, ≤ 400 words.',
    userPrompt: `Summarise this branch of a study mind map. Root: "${root.title}".\n\nBranch outline:\n${outline}`,
  });
}

export async function summariseMap(userId: string, mapId: string): Promise<{ text: string }> {
  await mindMap.requireOwner(userId, mapId);
  const { outline, nodeCount } = await loadMapOutline(mapId);
  if (nodeCount === 0) throw new BadRequestError('Map is empty');
  return runTextAction({
    system:
      'You summarise study mind maps into concise overviews for a student. Highlight the ' +
      'primary areas, the biggest sub-branches, and how they relate. Plain text, ≤ 500 words.',
    userPrompt: `Summarise this mind map (${nodeCount} nodes).\n\nOutline:\n${outline}`,
  });
}

export async function generateStudyGuide(userId: string, mapId: string): Promise<{ text: string }> {
  await mindMap.requireOwner(userId, mapId);
  const { outline, nodeCount } = await loadMapOutline(mapId);
  if (nodeCount === 0) throw new BadRequestError('Map is empty');
  return runTextAction({
    system:
      'You produce a structured study guide from a mind map. Sections in this order, plain text: ' +
      '1) Key concepts, 2) Concepts to memorise, 3) Concepts requiring deeper understanding, ' +
      '4) Important relationships, 5) Recommended study order, 6) 5-10 practice questions with answers, ' +
      '7) Flashcard candidates (front / back). Under 900 words total.',
    userPrompt: `Generate a study guide from this mind map (${nodeCount} nodes).\n\nOutline:\n${outline}`,
    maxLength: 9000,
  });
}

export async function analyseMap(userId: string, mapId: string): Promise<{ text: string }> {
  await mindMap.requireOwner(userId, mapId);
  const { outline, nodeCount } = await loadMapOutline(mapId);
  if (nodeCount === 0) throw new BadRequestError('Map is empty');
  return runTextAction({
    system:
      'You review study mind maps for quality. Return findings in these sections, plain text, ' +
      'no JSON: 1) Duplicate or near-duplicate concepts, 2) Concepts that look disconnected, ' +
      '3) Missing prerequisites or subtopics, 4) Overly broad or overly narrow nodes, ' +
      '5) Suggested edits (each as a short imperative). Do NOT propose specific node edits — ' +
      'the student will review and apply them manually. Under 600 words.',
    userPrompt: `Analyse this mind map (${nodeCount} nodes) for quality issues.\n\nOutline:\n${outline}`,
  });
}

export async function askMap(
  userId: string,
  mapId: string,
  input: { question: string; selectedNodeId?: string },
): Promise<{ text: string }> {
  await mindMap.requireOwner(userId, mapId);
  if (!input.question.trim()) throw new BadRequestError('Question required');

  const scope: string[] = [];
  if (input.selectedNodeId) {
    const branch = await loadBranchOutline(mapId, input.selectedNodeId, 40);
    if (branch) scope.push(`Selected branch:\n${branch}`);
  }
  const { outline, nodeCount } = await loadMapOutline(mapId, 120);
  scope.push(`Full map outline (${nodeCount} nodes):\n${outline}`);

  return runTextAction({
    system:
      'You are the student\'s study coach. Answer questions grounded in the mind-map data ' +
      'the user has shared with you. Do not invent nodes that are not present. If the map ' +
      'lacks the information to answer, say so and suggest what the student could add. Plain ' +
      'text answer, ≤ 400 words.',
    userPrompt: `${scope.join('\n\n')}\n\nQuestion: ${input.question.trim()}`,
  });
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

  const nodes: Array<{
    id: string;
    parentId: string | null;
    type: string;
    title: string;
    content: string | null;
    x: number;
    y: number;
    tags: string[];
    metadata: Record<string, unknown>;
  }> = graph.nodes.map((n) => {
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
      tags: [] as string[],
      metadata: { aiGenerated: true } as Record<string, unknown>,
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
