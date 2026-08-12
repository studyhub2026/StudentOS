'use client';

import { create } from 'zustand';
import type { Edge, Node, XYPosition } from '@xyflow/react';
import type {
  BulkSavePayload,
  MindMapEdgeDto,
  MindMapFull,
  MindMapNodeDto,
} from '@/hooks/use-mind-maps';

/**
 * Shape carried in each React Flow node's `data` field. The editor UI reads
 * these fields when rendering the custom node component.
 */
export interface MindNodeData extends Record<string, unknown> {
  title: string;
  content: string | null;
  type: string;
  color: string | null;
  icon: string | null;
  tags: string[];
  refType: string | null;
  refId: string | null;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
}

export type MindNode = Node<MindNodeData>;
export type MindEdge = Edge<{ label?: string | null }>;

/** Small helper — server sends flat DTOs, React Flow wants `{position, data}`. */
export function dtoToNode(n: MindMapNodeDto): MindNode {
  return {
    id: n.id,
    type: 'mind',
    position: { x: n.x, y: n.y },
    // Seed `measured` with reasonable defaults so React Flow renders the node
    // immediately with visibility:visible rather than waiting for its own
    // ResizeObserver — otherwise edges never route and the whole graph stays
    // invisible on first paint. React Flow will overwrite these with real
    // measurements as soon as the DOM settles.
    measured: { width: 220, height: 90 },
    data: {
      title: n.title,
      content: n.content,
      type: n.type,
      color: n.color,
      icon: n.icon,
      tags: n.tags,
      refType: n.refType,
      refId: n.refId,
      parentId: n.parentId,
      metadata: n.metadata,
    },
  };
}

export function dtoToEdge(e: MindMapEdgeDto): MindEdge {
  // React Flow v12 requires `type` to name a registered edge type. Passing
  // `undefined` results in the edge being dropped from the render layer
  // (the SVG wrapper never even mounts), so always keep the string default.
  return {
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    ...(e.label ? { label: e.label } : {}),
    type: e.type === 'animated' ? 'default' : e.type || 'default',
    animated: e.type === 'animated',
    data: { label: e.label },
  };
}

interface HistorySnapshot {
  nodes: MindNode[];
  edges: MindEdge[];
}

interface DirtyState {
  changedNodeIds: Set<string>;
  changedEdgeIds: Set<string>;
  deletedNodeIds: Set<string>;
  deletedEdgeIds: Set<string>;
  metaDirty: boolean;
}

interface MindMapEditorState {
  mapId: string | null;
  nodes: MindNode[];
  edges: MindEdge[];
  meta: {
    title: string;
    description: string | null;
    favorite: boolean;
    subjectId: string | null;
  };
  selectedNodeId: string | null;
  dirty: DirtyState;
  saveStatus: 'idle' | 'saving' | 'saved' | 'unsaved' | 'error';
  saveError: string | null;
  lastSavedAt: Date | null;
  history: HistorySnapshot[];
  future: HistorySnapshot[];

  // --- lifecycle ---
  hydrate(map: MindMapFull): void;
  reset(): void;

  // --- node/edge ops ---
  setNodes(next: MindNode[] | ((prev: MindNode[]) => MindNode[])): void;
  setEdges(next: MindEdge[] | ((prev: MindEdge[]) => MindEdge[])): void;

  updateNode(id: string, patch: Partial<MindNodeData> & { position?: XYPosition }): void;
  addNode(node: MindNode): void;
  addEdge(edge: MindEdge): void;
  removeNodes(ids: string[]): void;
  removeEdges(ids: string[]): void;

  setSelectedNode(id: string | null): void;

  updateMeta(patch: Partial<MindMapEditorState['meta']>): void;

  // --- history ---
  pushHistory(): void;
  undo(): void;
  redo(): void;

  // --- save orchestration ---
  markSaving(): void;
  markSaved(at: Date): void;
  markUnsaved(): void;
  markError(msg: string): void;
  buildPayload(): { payload: BulkSavePayload; hadChanges: boolean };
  clearDirty(): void;
}

function emptyDirty(): DirtyState {
  return {
    changedNodeIds: new Set(),
    changedEdgeIds: new Set(),
    deletedNodeIds: new Set(),
    deletedEdgeIds: new Set(),
    metaDirty: false,
  };
}

const HISTORY_LIMIT = 50;

export const useMindMapEditor = create<MindMapEditorState>((set, get) => ({
  mapId: null,
  nodes: [],
  edges: [],
  meta: { title: '', description: null, favorite: false, subjectId: null },
  selectedNodeId: null,
  dirty: emptyDirty(),
  saveStatus: 'idle',
  saveError: null,
  lastSavedAt: null,
  history: [],
  future: [],

  hydrate(map) {
    set({
      mapId: map.id,
      nodes: map.nodes.map(dtoToNode),
      edges: map.edges.map(dtoToEdge),
      meta: {
        title: map.title,
        description: map.description,
        favorite: map.favorite,
        subjectId: map.subjectId,
      },
      selectedNodeId: null,
      dirty: emptyDirty(),
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: null,
      history: [],
      future: [],
    });
  },
  reset() {
    set({
      mapId: null,
      nodes: [],
      edges: [],
      meta: { title: '', description: null, favorite: false, subjectId: null },
      selectedNodeId: null,
      dirty: emptyDirty(),
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: null,
      history: [],
      future: [],
    });
  },

  setNodes(next) {
    const prev = get().nodes;
    const value = typeof next === 'function' ? next(prev) : next;
    // Detect which ids actually changed compared to the previous state so we
    // don't mark every node dirty on every position update.
    const prevById = new Map(prev.map((n) => [n.id, n]));
    const dirty = new Set(get().dirty.changedNodeIds);
    for (const n of value) {
      const p = prevById.get(n.id);
      if (!p) {
        dirty.add(n.id);
        continue;
      }
      if (
        p.position.x !== n.position.x ||
        p.position.y !== n.position.y ||
        p.data !== n.data
      ) {
        dirty.add(n.id);
      }
    }
    set((s) => ({
      nodes: value,
      dirty: { ...s.dirty, changedNodeIds: dirty },
      saveStatus: dirty.size > 0 ? 'unsaved' : s.saveStatus,
    }));
  },

  setEdges(next) {
    const prev = get().edges;
    const value = typeof next === 'function' ? next(prev) : next;
    const prevById = new Map(prev.map((e) => [e.id, e]));
    const dirty = new Set(get().dirty.changedEdgeIds);
    for (const e of value) {
      const p = prevById.get(e.id);
      if (!p || p.source !== e.source || p.target !== e.target || p.label !== e.label) {
        dirty.add(e.id);
      }
    }
    set((s) => ({
      edges: value,
      dirty: { ...s.dirty, changedEdgeIds: dirty },
      saveStatus: dirty.size > 0 ? 'unsaved' : s.saveStatus,
    }));
  },

  updateNode(id, patch) {
    set((s) => {
      const nodes = s.nodes.map((n) => {
        if (n.id !== id) return n;
        const nextData = { ...n.data, ...('title' in patch || 'content' in patch || 'type' in patch || 'color' in patch || 'icon' in patch || 'tags' in patch || 'refType' in patch || 'refId' in patch || 'metadata' in patch ? patch : {}) } as MindNodeData;
        return { ...n, data: nextData, position: patch.position ?? n.position };
      });
      const dirty = new Set(s.dirty.changedNodeIds);
      dirty.add(id);
      return {
        nodes,
        dirty: { ...s.dirty, changedNodeIds: dirty },
        saveStatus: 'unsaved',
      };
    });
  },

  addNode(node) {
    set((s) => {
      const dirty = new Set(s.dirty.changedNodeIds);
      dirty.add(node.id);
      return {
        nodes: [...s.nodes, node],
        dirty: { ...s.dirty, changedNodeIds: dirty },
        saveStatus: 'unsaved',
      };
    });
  },

  addEdge(edge) {
    set((s) => {
      const dirty = new Set(s.dirty.changedEdgeIds);
      dirty.add(edge.id);
      return {
        edges: [...s.edges, edge],
        dirty: { ...s.dirty, changedEdgeIds: dirty },
        saveStatus: 'unsaved',
      };
    });
  },

  removeNodes(ids) {
    if (ids.length === 0) return;
    set((s) => {
      const idSet = new Set(ids);
      const deletedNodeIds = new Set(s.dirty.deletedNodeIds);
      const changedNodeIds = new Set(s.dirty.changedNodeIds);
      for (const id of ids) {
        deletedNodeIds.add(id);
        changedNodeIds.delete(id);
      }
      // Also drop any local edges attached to a removed node.
      const remainingEdges = s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
      const removedEdgeIds = s.edges.filter((e) => idSet.has(e.source) || idSet.has(e.target)).map((e) => e.id);
      const deletedEdgeIds = new Set(s.dirty.deletedEdgeIds);
      for (const id of removedEdgeIds) deletedEdgeIds.add(id);
      return {
        nodes: s.nodes.filter((n) => !idSet.has(n.id)),
        edges: remainingEdges,
        dirty: { ...s.dirty, changedNodeIds, deletedNodeIds, deletedEdgeIds },
        selectedNodeId: s.selectedNodeId && idSet.has(s.selectedNodeId) ? null : s.selectedNodeId,
        saveStatus: 'unsaved',
      };
    });
  },

  removeEdges(ids) {
    if (ids.length === 0) return;
    set((s) => {
      const idSet = new Set(ids);
      const deletedEdgeIds = new Set(s.dirty.deletedEdgeIds);
      const changedEdgeIds = new Set(s.dirty.changedEdgeIds);
      for (const id of ids) {
        deletedEdgeIds.add(id);
        changedEdgeIds.delete(id);
      }
      return {
        edges: s.edges.filter((e) => !idSet.has(e.id)),
        dirty: { ...s.dirty, changedEdgeIds, deletedEdgeIds },
        saveStatus: 'unsaved',
      };
    });
  },

  setSelectedNode(id) {
    set({ selectedNodeId: id });
  },

  updateMeta(patch) {
    set((s) => ({
      meta: { ...s.meta, ...patch },
      dirty: { ...s.dirty, metaDirty: true },
      saveStatus: 'unsaved',
    }));
  },

  // --- history --------------------------------------------------------------

  pushHistory() {
    set((s) => ({
      history: [...s.history.slice(-HISTORY_LIMIT + 1), { nodes: s.nodes, edges: s.edges }],
      future: [],
    }));
  },

  undo() {
    const { history, nodes, edges } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    set((s) => ({
      history: history.slice(0, -1),
      future: [{ nodes, edges }, ...s.future],
      nodes: prev.nodes,
      edges: prev.edges,
      dirty: markAllDirty(s.dirty, prev.nodes, prev.edges, s.nodes, s.edges),
      saveStatus: 'unsaved',
    }));
  },

  redo() {
    const { future, nodes, edges } = get();
    if (future.length === 0) return;
    const next = future[0]!;
    set((s) => ({
      future: future.slice(1),
      history: [...s.history, { nodes, edges }],
      nodes: next.nodes,
      edges: next.edges,
      dirty: markAllDirty(s.dirty, next.nodes, next.edges, s.nodes, s.edges),
      saveStatus: 'unsaved',
    }));
  },

  // --- save orchestration ---------------------------------------------------

  markSaving() {
    set({ saveStatus: 'saving', saveError: null });
  },
  markSaved(at) {
    set({ saveStatus: 'saved', lastSavedAt: at, saveError: null, dirty: emptyDirty() });
  },
  markUnsaved() {
    set({ saveStatus: 'unsaved' });
  },
  markError(msg) {
    set({ saveStatus: 'error', saveError: msg });
  },

  buildPayload() {
    const s = get();
    const {
      changedNodeIds,
      changedEdgeIds,
      deletedNodeIds,
      deletedEdgeIds,
      metaDirty,
    } = s.dirty;
    const nodeById = new Map(s.nodes.map((n) => [n.id, n]));
    const edgeById = new Map(s.edges.map((e) => [e.id, e]));

    const nodes = [...changedNodeIds]
      .map((id) => nodeById.get(id))
      .filter((n): n is MindNode => !!n)
      .map((n) => ({
        id: n.id,
        parentId: n.data.parentId,
        type: n.data.type,
        title: n.data.title,
        content: n.data.content,
        x: n.position.x,
        y: n.position.y,
        color: n.data.color,
        icon: n.data.icon,
        tags: n.data.tags,
        refType: n.data.refType,
        refId: n.data.refId,
        metadata: n.data.metadata,
      }));

    const edges = [...changedEdgeIds]
      .map((id) => edgeById.get(id))
      .filter((e): e is MindEdge => !!e)
      .map((e) => ({
        id: e.id,
        sourceId: e.source,
        targetId: e.target,
        label: (e.data?.label ?? (typeof e.label === 'string' ? e.label : null)) ?? null,
        type: e.type ?? 'default',
      }));

    const payload: BulkSavePayload = {};
    if (nodes.length > 0) payload.nodes = nodes as BulkSavePayload['nodes'];
    if (edges.length > 0) payload.edges = edges as BulkSavePayload['edges'];
    if (deletedNodeIds.size > 0) payload.deletedNodeIds = [...deletedNodeIds];
    if (deletedEdgeIds.size > 0) payload.deletedEdgeIds = [...deletedEdgeIds];
    if (metaDirty) {
      payload.meta = {
        title: s.meta.title,
        description: s.meta.description,
        favorite: s.meta.favorite,
        subjectId: s.meta.subjectId,
      };
    }

    const hadChanges =
      nodes.length > 0 ||
      edges.length > 0 ||
      deletedNodeIds.size > 0 ||
      deletedEdgeIds.size > 0 ||
      metaDirty;

    return { payload, hadChanges };
  },

  clearDirty() {
    set((s) => ({ dirty: emptyDirty(), saveStatus: s.saveStatus === 'saving' ? 'saving' : s.saveStatus }));
  },
}));

/**
 * When we restore a history snapshot, mark every changed id as dirty so the
 * next save writes the reverted state to the server rather than diffing from
 * an out-of-sync baseline.
 */
function markAllDirty(
  base: DirtyState,
  nextNodes: MindNode[],
  nextEdges: MindEdge[],
  prevNodes: MindNode[],
  prevEdges: MindEdge[],
): DirtyState {
  const changedNodeIds = new Set(base.changedNodeIds);
  const changedEdgeIds = new Set(base.changedEdgeIds);
  const deletedNodeIds = new Set(base.deletedNodeIds);
  const deletedEdgeIds = new Set(base.deletedEdgeIds);
  const nextNodeIds = new Set(nextNodes.map((n) => n.id));
  const nextEdgeIds = new Set(nextEdges.map((e) => e.id));
  for (const n of nextNodes) changedNodeIds.add(n.id);
  for (const e of nextEdges) changedEdgeIds.add(e.id);
  for (const n of prevNodes) {
    if (!nextNodeIds.has(n.id)) deletedNodeIds.add(n.id);
  }
  for (const e of prevEdges) {
    if (!nextEdgeIds.has(e.id)) deletedEdgeIds.add(e.id);
  }
  return { changedNodeIds, changedEdgeIds, deletedNodeIds, deletedEdgeIds, metaDirty: base.metaDirty };
}
