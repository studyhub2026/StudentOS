'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  Download,
  Loader2,
  Plus,
  Redo2,
  Save,
  Search,
  Sparkles,
  TriangleAlert,
  Undo2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useMindMap } from '@/hooks/use-mind-maps';
import { useMindMapAutoSave, saveMindMapNow } from '@/hooks/use-mind-map-autosave';
import {
  useMindMapEditor,
  type MindEdge,
  type MindNode,
} from '@/stores/mind-map-editor-store';
import { MindNodeView } from './mind-node';
import { NodeInspector } from './node-inspector';
import { newMindId } from './ids';
import { radialLayout } from './layout';
import { LibraryPicker } from './library-picker';
import { downloadFile, exportSvg, fromJson, fromMarkdown, toJson, toMarkdown } from './import-export';

const NODE_TYPES = { mind: MindNodeView } as const;

export function MindMapEditor({ mapId }: { mapId: string }) {
  return (
    <ReactFlowProvider>
      <MindMapEditorInner mapId={mapId} />
    </ReactFlowProvider>
  );
}

function MindMapEditorInner({ mapId }: { mapId: string }) {
  const { data: mapData, isLoading, isError, error } = useMindMap(mapId);
  const hydrate = useMindMapEditor((s) => s.hydrate);
  const reset = useMindMapEditor((s) => s.reset);

  useMindMapAutoSave(mapId);

  useEffect(() => {
    if (mapData) hydrate(mapData);
    return () => reset();
    // Only re-run when the loaded map id changes; individual field changes go
    // through the store's mutations, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData?.id]);

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !mapData) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <TriangleAlert className="mx-auto h-8 w-8 text-warning" />
          <p className="mt-3 font-medium">Could not load mind map</p>
          <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
          <Link href="/mind-map" className="mt-4 inline-block text-sm text-brand-bright hover:underline">
            Back to mind maps
          </Link>
        </div>
      </div>
    );
  }

  return <EditorCanvas mapId={mapId} />;
}

function EditorCanvas({ mapId }: { mapId: string }) {
  const nodes = useMindMapEditor((s) => s.nodes);
  const edges = useMindMapEditor((s) => s.edges);
  const meta = useMindMapEditor((s) => s.meta);
  const saveStatus = useMindMapEditor((s) => s.saveStatus);
  const lastSavedAt = useMindMapEditor((s) => s.lastSavedAt);
  const setNodes = useMindMapEditor((s) => s.setNodes);
  const setEdges = useMindMapEditor((s) => s.setEdges);
  const addNode = useMindMapEditor((s) => s.addNode);
  const addEdgeStore = useMindMapEditor((s) => s.addEdge);
  const removeNodes = useMindMapEditor((s) => s.removeNodes);
  const removeEdges = useMindMapEditor((s) => s.removeEdges);
  const setSelectedNode = useMindMapEditor((s) => s.setSelectedNode);
  const pushHistory = useMindMapEditor((s) => s.pushHistory);
  const undo = useMindMapEditor((s) => s.undo);
  const redo = useMindMapEditor((s) => s.redo);

  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // React Flow v12 renders EdgeWrappers before handle bounds land in its
  // internal store — each wrapper resolves to null and the edge SVG never
  // mounts. Once nodesInitialized flips true, force the store to reprocess
  // handles by cloning the node array. This "kick" makes edges appear.
  const nodesInitialized = useNodesInitialized();
  const kickedRef = useRef(false);
  useEffect(() => {
    if (nodesInitialized && !kickedRef.current && nodes.length > 0) {
      kickedRef.current = true;
      rf.setNodes((ns) => ns.map((n) => ({ ...n })));
      rf.fitView({ padding: 0.2 });
    }
  }, [nodesInitialized, nodes.length, rf]);

  // --- Node/edge event handlers ---------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      // Save selection separately so the inspector highlights the right node
      // even during a drag.
      const selected = changes.find((c) => c.type === 'select' && c.selected);
      if (selected && 'id' in selected) setSelectedNode(selected.id);
    },
    [setNodes, setSelectedNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removedIds.length > 0) removeEdges(removedIds);
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [setEdges, removeEdges],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      pushHistory();
      const edge: MindEdge = {
        id: newMindId('e'),
        source: connection.source,
        target: connection.target,
        type: undefined,
      };
      addEdgeStore(edge);
      setEdges((current) => addEdge({ ...connection, id: edge.id }, current) as MindEdge[]);
    },
    [addEdgeStore, setEdges, pushHistory],
  );

  const onNodesDelete = useCallback(
    (deleted: { id: string }[]) => {
      pushHistory();
      removeNodes(deleted.map((d) => d.id));
    },
    [removeNodes, pushHistory],
  );

  // --- Toolbar actions ------------------------------------------------------

  const handleAddNode = useCallback(() => {
    pushHistory();
    const viewport = rf.getViewport();
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
    const id = newMindId('n');
    addNode({
      id,
      type: 'mind',
      position: { x: cx, y: cy },
      measured: { width: 220, height: 90 },
      data: {
        title: 'New topic',
        content: null,
        type: 'topic',
        color: null,
        icon: null,
        tags: [],
        refType: null,
        refId: null,
        parentId: null,
        metadata: null,
      },
    });
    setSelectedNode(id);
  }, [addNode, rf, setSelectedNode, pushHistory]);

  const handleAutoLayout = useCallback(async () => {
    pushHistory();
    const laidOut = radialLayout(nodes, edges);
    setNodes(laidOut);
    setTimeout(() => rf.fitView({ padding: 0.2 }), 100);
  }, [nodes, edges, setNodes, rf, pushHistory]);

  const handleAiExpand = useCallback(async () => {
    const selectedNodes = nodes.filter((n) => n.selected);
    const nodeToExpand = selectedNodes[0];
    if (!nodeToExpand) {
      toast.error('Select a node to expand');
      return;
    }
    toast.info('Asking AI to expand this node…');
    try {
      const { data } = await apiClient.post<{
        data: { nodes: { id: string; title: string; type: string; content?: string }[] };
      }>(`/mind-maps/${mapId}/nodes/${nodeToExpand.id}/expand`, { count: 5 });
      const generated = data.data.nodes;
      pushHistory();
      // Place new children in a fan below the source node.
      const angleStep = Math.PI / (generated.length + 1);
      for (let i = 0; i < generated.length; i++) {
        const g = generated[i]!;
        const angle = Math.PI / 2 - Math.PI / 2 + angleStep * (i + 1);
        const dist = 220;
        const newNode: MindNode = {
          id: g.id,
          type: 'mind',
          position: {
            x: nodeToExpand.position.x + Math.cos(angle) * dist,
            y: nodeToExpand.position.y + Math.sin(angle) * dist,
          },
          data: {
            title: g.title,
            content: g.content ?? null,
            type: g.type,
            color: null,
            icon: null,
            tags: [],
            refType: null,
            refId: null,
            parentId: nodeToExpand.id,
            metadata: { aiGenerated: true },
          },
        };
        addNode(newNode);
        addEdgeStore({
          id: newMindId('e'),
          source: nodeToExpand.id,
          target: g.id,
        });
      }
      toast.success(`Added ${generated.length} node${generated.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }, [nodes, mapId, pushHistory, addNode, addEdgeStore]);

  // --- Keyboard shortcuts ---------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Ignore events fired inside inputs/textareas so typing doesn't collide
      // with shortcuts.
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target && target.isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveMindMapNow(mapId);
        toast.success('Saved');
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = useMindMapEditor.getState().nodes.filter((n) => n.selected);
        if (selected.length > 0) {
          e.preventDefault();
          pushHistory();
          removeNodes(selected.map((n) => n.id));
        }
        return;
      }
      if (e.key === 'Tab') {
        // Create a child of the currently selected node.
        const selected = useMindMapEditor.getState().nodes.find((n) => n.selected);
        if (selected) {
          e.preventDefault();
          pushHistory();
          const id = newMindId('n');
          const newNode: MindNode = {
            id,
            type: 'mind',
            position: {
              x: selected.position.x + 220,
              y: selected.position.y + 40,
            },
            data: {
              title: 'New child',
              content: null,
              type: 'subtopic',
              color: null,
              icon: null,
              tags: [],
              refType: null,
              refId: null,
              parentId: selected.id,
              metadata: null,
            },
          };
          addNode(newNode);
          addEdgeStore({ id: newMindId('e'), source: selected.id, target: id });
          setSelectedNode(id);
        }
      }
      if (e.key === 'Enter') {
        // Create a sibling of the currently selected node.
        const selected = useMindMapEditor.getState().nodes.find((n) => n.selected);
        if (selected) {
          e.preventDefault();
          pushHistory();
          const id = newMindId('n');
          const newNode: MindNode = {
            id,
            type: 'mind',
            position: {
              x: selected.position.x + 40,
              y: selected.position.y + 120,
            },
            data: {
              title: 'New topic',
              content: null,
              type: selected.data.type,
              color: null,
              icon: null,
              tags: [],
              refType: null,
              refId: null,
              parentId: selected.data.parentId,
              metadata: null,
            },
          };
          addNode(newNode);
          if (selected.data.parentId) {
            addEdgeStore({ id: newMindId('e'), source: selected.data.parentId, target: id });
          }
          setSelectedNode(id);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapId, undo, redo, pushHistory, removeNodes, addNode, addEdgeStore, setSelectedNode]);

  const searchMatches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [] as string[];
    return nodes
      .filter(
        (n) =>
          n.data.title.toLowerCase().includes(q) ||
          (n.data.content ?? '').toLowerCase().includes(q) ||
          n.data.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .map((n) => n.id);
  }, [nodes, searchTerm]);

  function focusMatch(nodeId: string) {
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    rf.setCenter(n.position.x + 120, n.position.y + 50, { zoom: 1.25, duration: 400 });
    setSelectedNode(nodeId);
  }

  function handleExport(kind: 'json' | 'markdown' | 'svg' | 'png') {
    const map = {
      id: mapId,
      title: meta.title || 'mind-map',
      description: meta.description,
      favorite: meta.favorite,
      aiGenerated: false,
      subjectId: meta.subjectId,
      subject: null,
      settings: null,
      createdAt: '',
      updatedAt: '',
      nodes: nodes.map((n) => ({
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
        style: null,
        metadata: n.data.metadata,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceId: e.source,
        targetId: e.target,
        label: (e.data?.label ?? (typeof e.label === 'string' ? e.label : null)) ?? null,
        type: e.type ?? 'default',
        style: null,
        metadata: null,
      })),
    };
    const safeTitle = (meta.title || 'mind-map').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (kind === 'json') {
      downloadFile(`${safeTitle}.json`, toJson(map), 'application/json');
    } else if (kind === 'markdown') {
      downloadFile(`${safeTitle}.md`, toMarkdown(map), 'text/markdown');
    } else if (kind === 'svg' && wrapperRef.current) {
      const svg = exportSvg(wrapperRef.current);
      downloadFile(`${safeTitle}.svg`, svg, 'image/svg+xml');
    } else if (kind === 'png' && wrapperRef.current) {
      // Render the SVG into a canvas, then dataURL it. Handles the raster
      // export without dragging in html-to-image.
      const svg = exportSvg(wrapperRef.current);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${safeTitle}.png`;
          a.click();
          URL.revokeObjectURL(url);
        }, 'image/png');
      };
      img.onerror = () => toast.error('PNG export failed — try SVG');
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    }
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      let parsed;
      if (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt')) {
        parsed = fromMarkdown(text);
      } else {
        parsed = fromJson(text);
      }
      if (parsed.nodes.length === 0) {
        toast.error('No nodes found in the file');
        return;
      }
      pushHistory();
      // Replace current graph client-side; server persistence happens on next
      // auto-save.
      const newNodes: MindNode[] = parsed.nodes.map((n, i) => ({
        id: n.id!,
        type: 'mind',
        position: {
          x: typeof n.x === 'number' ? n.x : Math.cos((i / parsed.nodes.length) * Math.PI * 2) * 220,
          y: typeof n.y === 'number' ? n.y : Math.sin((i / parsed.nodes.length) * Math.PI * 2) * 220,
        },
        data: {
          title: n.title ?? 'Node',
          content: n.content ?? null,
          type: n.type ?? 'topic',
          color: n.color ?? null,
          icon: n.icon ?? null,
          tags: n.tags ?? [],
          refType: n.refType ?? null,
          refId: n.refId ?? null,
          parentId: n.parentId ?? null,
          metadata: null,
        },
      }));
      const newEdges: MindEdge[] = parsed.edges.map((e) => ({
        id: e.id!,
        source: e.sourceId!,
        target: e.targetId!,
        label: e.label ?? undefined,
        data: { label: e.label ?? null },
      }));
      // Remove existing then add imported.
      removeNodes(nodes.map((n) => n.id));
      for (const n of newNodes) useMindMapEditor.getState().addNode(n);
      for (const e of newEdges) useMindMapEditor.getState().addEdge(e);
      setTimeout(() => rf.fitView({ padding: 0.2 }), 100);
      toast.success(`Imported ${newNodes.length} node${newNodes.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    }
  }

  const nodeTypes = useMemo(() => NODE_TYPES, []);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div ref={wrapperRef} className="relative min-h-0 flex-1">
        <Toolbar
          mapId={mapId}
          title={meta.title}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          onAdd={handleAddNode}
          onAutoLayout={handleAutoLayout}
          onAiExpand={handleAiExpand}
          onLibrary={() => setLibraryOpen((v) => !v)}
          onUndo={undo}
          onRedo={redo}
          onSearch={() => setSearchOpen((v) => !v)}
          onImport={() => fileInputRef.current?.click()}
          onExport={handleExport}
        />
        <LibraryPicker open={libraryOpen} onClose={() => setLibraryOpen(false)} />

        {searchOpen ? (
          <div className="absolute left-1/2 top-16 z-20 w-80 -translate-x-1/2 rounded-xl border border-border bg-[var(--color-surface)] p-2 shadow-lg">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
              <input
                autoFocus
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
                placeholder="Search nodes…"
                className="w-full rounded-lg border border-border bg-surface-raised py-1.5 pl-8 pr-8 text-sm outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
                aria-label="Close search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {searchTerm.trim() ? (
              <ul className="mt-1 max-h-64 overflow-y-auto">
                {searchMatches.length === 0 ? (
                  <li className="px-2 py-2 text-xs text-fg-subtle">No matches</li>
                ) : (
                  searchMatches.slice(0, 20).map((id) => {
                    const n = nodes.find((x) => x.id === id)!;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => {
                            focusMatch(id);
                            setSearchOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised"
                        >
                          <span className="truncate">{n.data.title}</span>
                          <span className="ml-2 text-fg-subtle">{n.data.type}</span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.md,.markdown,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
            e.currentTarget.value = '';
          }}
        />
        <div className="absolute inset-0 top-14">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onInit={(instance) => {
              // React Flow v12 sometimes measures nodes before the custom
              // components' handles are registered, which leaves EdgeWrappers
              // rendering null. Nudging the store on the next tick makes the
              // instance re-run its bounds pass and edges appear.
              requestAnimationFrame(() => {
                instance.setNodes((ns) => ns.map((n) => ({ ...n })));
                instance.fitView({ padding: 0.2 });
              });
            }}
            onSelectionChange={({ nodes: selectedNodes }) => {
              setSelectedNode(selectedNodes[0]?.id ?? null);
            }}
            defaultEdgeOptions={{ type: 'default' }}
            fitView
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            panOnScroll
            selectionOnDrag
            className="bg-[var(--color-surface)]"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.data as MindNode['data']).color ?? '#8b5cf6'}
              className="!border-border"
            />
            <Controls className="!border-border" />
          </ReactFlow>
        </div>
      </div>
      <NodeInspector mapId={mapId} />
    </div>
  );
}

interface ToolbarProps {
  mapId: string;
  title: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'unsaved' | 'error';
  lastSavedAt: Date | null;
  onAdd: () => void;
  onAutoLayout: () => void;
  onAiExpand: () => void;
  onLibrary: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSearch: () => void;
  onImport: () => void;
  onExport: (kind: 'json' | 'markdown' | 'svg' | 'png') => void;
}

function Toolbar({ mapId, title, saveStatus, lastSavedAt, onAdd, onAutoLayout, onAiExpand, onLibrary, onUndo, onRedo, onSearch, onImport, onExport }: ToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-[var(--color-surface)] px-3">
      <Link href="/mind-map" className="rounded p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <span className="truncate text-sm font-semibold">{title || 'Untitled mind map'}</span>

      <div className="ml-auto flex items-center gap-1">
        <SaveStatus status={saveStatus} lastSavedAt={lastSavedAt} />

        <div className="mx-2 h-6 w-px bg-border" aria-hidden />

        <button
          type="button"
          onClick={onUndo}
          className="rounded p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          className="rounded p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="mx-2 h-6 w-px bg-border" aria-hidden />

        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> Node
        </Button>
        <Button variant="outline" size="sm" onClick={onSearch} title="Search (Ctrl+F)">
          <Search className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={onLibrary} title="Add from library">
          <BookOpen className="h-3.5 w-3.5" /> Library
        </Button>
        <Button variant="outline" size="sm" onClick={onAutoLayout} title="Auto layout">
          <Wand2 className="h-3.5 w-3.5" /> Layout
        </Button>
        <Button variant="outline" size="sm" onClick={onAiExpand}>
          <Sparkles className="h-3.5 w-3.5" /> Expand
        </Button>
        <Button variant="outline" size="sm" onClick={onImport}>
          <Upload className="h-3.5 w-3.5" />
        </Button>
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setExportOpen((v) => !v)}>
            <Download className="h-3.5 w-3.5" />
          </Button>
          {exportOpen ? (
            <div
              className="absolute right-0 top-full z-30 mt-1 w-32 rounded-lg border border-border bg-[var(--color-surface)] p-1 shadow-lg"
              onMouseLeave={() => setExportOpen(false)}
            >
              {(['json', 'markdown', 'svg', 'png'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onExport(k);
                    setExportOpen(false);
                  }}
                  className="w-full rounded-md px-2 py-1 text-left text-xs uppercase hover:bg-surface-raised"
                >
                  {k}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button size="sm" onClick={() => void saveMindMapNow(mapId)}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </div>
    </div>
  );
}

function SaveStatus({ status, lastSavedAt }: { status: string; lastSavedAt: Date | null }) {
  const label =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? `Saved${lastSavedAt ? ` at ${lastSavedAt.toLocaleTimeString()}` : ''}`
        : status === 'unsaved'
          ? 'Unsaved changes'
          : status === 'error'
            ? 'Save failed'
            : lastSavedAt
              ? `Saved at ${lastSavedAt.toLocaleTimeString()}`
              : '';
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
        status === 'saving' && 'text-fg-muted',
        status === 'saved' && 'text-success',
        status === 'unsaved' && 'text-warning',
        status === 'error' && 'text-danger',
      )}
      role="status"
      aria-live="polite"
    >
      {status === 'saving' ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : status === 'error' ? (
        <TriangleAlert className="h-3 w-3" aria-hidden />
      ) : status === 'unsaved' ? (
        <TriangleAlert className="h-3 w-3" aria-hidden />
      ) : status === 'saved' ? (
        <CheckCircle className="h-3 w-3" aria-hidden />
      ) : null}
      {label}
    </span>
  );
}

/**
 * React Flow's default change appliers. Duplicated here so the module has zero
 * indirect imports from React Flow's internal utilities — cleaner tree-shake.
 * These implementations only need the change types we actually emit.
 */
function applyNodeChanges<T extends MindNode>(changes: NodeChange[], nodes: T[]): T[] {
  let next = nodes;
  for (const c of changes) {
    if (c.type === 'position' && c.position && 'id' in c) {
      next = next.map((n) => (n.id === c.id ? { ...n, position: c.position!, dragging: c.dragging } : n));
    } else if (c.type === 'select' && 'id' in c) {
      next = next.map((n) => (n.id === c.id ? { ...n, selected: c.selected } : n));
    } else if (c.type === 'remove' && 'id' in c) {
      next = next.filter((n) => n.id !== c.id);
    } else if (c.type === 'dimensions' && 'id' in c) {
      // React Flow measures each node's DOM after render and emits this to
      // request that the measurement be persisted on the node. If we don't
      // apply it, React Flow keeps `visibility: hidden` on every node and
      // never routes any edges. Persist `measured` verbatim.
      const dim = c.dimensions;
      next = next.map((n) =>
        n.id === c.id
          ? { ...n, measured: dim ? { width: dim.width, height: dim.height } : n.measured }
          : n,
      );
    }
  }
  return next;
}

function applyEdgeChanges<T extends MindEdge>(changes: EdgeChange[], edges: T[]): T[] {
  let next = edges;
  for (const c of changes) {
    if (c.type === 'select' && 'id' in c) {
      next = next.map((e) => (e.id === c.id ? { ...e, selected: c.selected } : e));
    } else if (c.type === 'remove' && 'id' in c) {
      next = next.filter((e) => e.id !== c.id);
    }
  }
  return next;
}
