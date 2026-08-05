import 'server-only';
import { prisma } from '@/server/db';

/**
 * A subject-centric graph of the student's own materials. Rather than run a
 * heavy semantic-embedding pass, we build the graph from real ownership
 * relations already in the schema — Subject → Assignment / Note /
 * FlashcardDeck / KnowledgeDocument-tag. Cheap and predictable.
 */

export type GraphNodeKind =
  | 'subject'
  | 'note'
  | 'assignment'
  | 'deck'
  | 'document'
  | 'goal';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  color: string | null;
  url: string | null;
  subjectId?: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'contains' | 'related';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const KIND_URL: Record<GraphNodeKind, string> = {
  subject: '/assignments',
  note: '/notes',
  assignment: '/assignments',
  deck: '/flashcards',
  document: '/knowledge',
  goal: '/analytics',
};

export async function getKnowledgeGraph(userId: string): Promise<GraphData> {
  const [subjects, assignments, notes, decks, documents, goals] = await Promise.all([
    prisma.subject.findMany({
      where: { userId, archived: false },
      select: { id: true, name: true, color: true },
    }),
    prisma.assignment.findMany({
      where: { userId, deletedAt: null },
      take: 60,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, subjectId: true },
    }),
    prisma.note.findMany({
      where: { userId, deletedAt: null },
      take: 60,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, subjectId: true, subject: { select: { color: true } } },
    }),
    prisma.flashcardDeck.findMany({
      where: { userId },
      take: 40,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, color: true, subjectId: true },
    }),
    prisma.knowledgeDocument.findMany({
      where: { userId },
      take: 40,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, filename: true, tags: true },
    }),
    prisma.goal.findMany({
      where: { userId },
      take: 20,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, subjectId: true },
    }),
  ]);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const s of subjects) {
    nodes.push({
      id: `subject:${s.id}`,
      kind: 'subject',
      label: s.name,
      color: s.color,
      url: KIND_URL.subject,
    });
  }

  const pushChild = (
    id: string,
    kind: GraphNodeKind,
    label: string,
    color: string | null,
    subjectId: string | null | undefined,
  ) => {
    const nodeId = `${kind}:${id}`;
    nodes.push({
      id: nodeId,
      kind,
      label,
      color,
      url: KIND_URL[kind],
      subjectId: subjectId ?? null,
    });
    if (subjectId) edges.push({ from: `subject:${subjectId}`, to: nodeId, kind: 'contains' });
  };

  for (const a of assignments) pushChild(a.id, 'assignment', a.title, null, a.subjectId);
  for (const n of notes) pushChild(n.id, 'note', n.title, n.subject?.color ?? null, n.subjectId);
  for (const d of decks) pushChild(d.id, 'deck', d.name, d.color, d.subjectId);
  for (const g of goals) pushChild(g.id, 'goal', g.title, null, g.subjectId);

  // Documents don't have a subjectId column; wire them to any subject whose
  // name appears (case-insensitive) in the document's tags. Fall back to
  // "orphan" — rendered off the ring so the graph still shows they exist.
  const subjectByName = new Map(
    subjects.map((s) => [s.name.toLowerCase(), s.id] as const),
  );
  for (const doc of documents) {
    const linked = doc.tags
      .map((t) => subjectByName.get(t.toLowerCase()))
      .filter((v): v is string => Boolean(v));
    const nodeId = `document:${doc.id}`;
    nodes.push({
      id: nodeId,
      kind: 'document',
      label: doc.filename,
      color: null,
      url: KIND_URL.document,
    });
    for (const subjectId of linked) {
      edges.push({ from: `subject:${subjectId}`, to: nodeId, kind: 'related' });
    }
  }

  return { nodes, edges };
}
