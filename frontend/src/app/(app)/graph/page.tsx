'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  CheckSquare,
  FileText,
  Layers,
  Loader2,
  MousePointer,
  Network,
  Target,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useKnowledgeGraph, type GraphNode, type GraphNodeKind } from '@/hooks/use-knowledge-graph';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  radius: number;
}

const KIND_COLOR: Record<GraphNodeKind, string> = {
  subject: '#6366f1',
  note: '#22c55e',
  assignment: '#f97316',
  deck: '#0ea5e9',
  document: '#a855f7',
  goal: '#eab308',
};

const KIND_RADIUS: Record<GraphNodeKind, number> = {
  subject: 30,
  note: 12,
  assignment: 12,
  deck: 14,
  document: 12,
  goal: 12,
};

/**
 * Static radial layout: subjects sit on an inner ring, and each subject's
 * children fan out in a wedge behind it. Orphan nodes (no subjectId) go on
 * the outer ring. No physics loop — layout is deterministic in one pass so
 * the graph is stable between refreshes and works without a heavy sim lib.
 */
function layout(nodes: GraphNode[], edges: { from: string; to: string }[]): PositionedNode[] {
  const subjects = nodes.filter((n) => n.kind === 'subject');
  const others = nodes.filter((n) => n.kind !== 'subject');
  const width = 1600;
  const height = 1200;
  const cx = width / 2;
  const cy = height / 2;
  const subjectRadius = 250;
  const childRadius = 480;
  const orphanRadius = 720;

  const positions = new Map<string, { x: number; y: number }>();

  subjects.forEach((s, i) => {
    const angle = (i / Math.max(1, subjects.length)) * Math.PI * 2;
    positions.set(s.id, {
      x: cx + Math.cos(angle) * subjectRadius,
      y: cy + Math.sin(angle) * subjectRadius,
    });
  });

  // Group children per subject.
  const childBySubject = new Map<string, GraphNode[]>();
  const orphans: GraphNode[] = [];
  for (const n of others) {
    const sid = n.subjectId ? `subject:${n.subjectId}` : null;
    if (sid && positions.has(sid)) {
      const arr = childBySubject.get(sid) ?? [];
      arr.push(n);
      childBySubject.set(sid, arr);
    } else {
      orphans.push(n);
    }
  }

  for (const [sid, children] of childBySubject) {
    const sPos = positions.get(sid)!;
    const baseAngle = Math.atan2(sPos.y - cy, sPos.x - cx);
    // Fan the children in a wedge centred on the subject's outward direction.
    const spread = Math.PI * 0.9;
    const step = children.length > 1 ? spread / (children.length - 1) : 0;
    children.forEach((c, i) => {
      const angle = baseAngle - spread / 2 + step * i;
      positions.set(c.id, {
        x: cx + Math.cos(angle) * childRadius,
        y: cy + Math.sin(angle) * childRadius,
      });
    });
  }

  orphans.forEach((o, i) => {
    const angle = (i / Math.max(1, orphans.length)) * Math.PI * 2;
    positions.set(o.id, {
      x: cx + Math.cos(angle) * orphanRadius,
      y: cy + Math.sin(angle) * orphanRadius,
    });
  });

  return nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: cx, y: cy };
    return { ...n, x: pos.x, y: pos.y, radius: KIND_RADIUS[n.kind] };
  });
}

const KIND_LABEL: Record<GraphNodeKind, string> = {
  subject: 'Subjects',
  note: 'Notes',
  assignment: 'Assignments',
  deck: 'Flashcard decks',
  document: 'Documents',
  goal: 'Goals',
};

const KIND_ICONS: Record<GraphNodeKind, React.ComponentType<{ className?: string }>> = {
  subject: Layers,
  note: BookOpen,
  assignment: CheckSquare,
  deck: Layers,
  document: FileText,
  goal: Target,
};

export default function KnowledgeGraphPage() {
  const { data, isLoading, error } = useKnowledgeGraph();
  const [filter, setFilter] = useState<Set<GraphNodeKind>>(
    () => new Set<GraphNodeKind>(['subject', 'note', 'assignment', 'deck', 'document', 'goal']),
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const positioned = useMemo(() => (data ? layout(data.nodes, data.edges) : []), [data]);

  const filteredNodes = useMemo(
    () => positioned.filter((n) => filter.has(n.kind)),
    [positioned, filter],
  );
  const nodeById = useMemo(
    () => new Map(filteredNodes.map((n) => [n.id, n])),
    [filteredNodes],
  );
  const visibleEdges = useMemo(
    () =>
      (data?.edges ?? []).filter(
        (e) => nodeById.has(e.from) && nodeById.has(e.to),
      ),
    [data, nodeById],
  );

  function toggle(kind: GraphNodeKind) {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-7xl flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Network className="h-5 w-5 text-brand-bright" aria-hidden />
            Knowledge Graph
          </h1>
          <p className="text-sm text-fg-muted">
            How your subjects connect to notes, assignments, decks and documents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-fg-subtle">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Kind filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(KIND_LABEL) as GraphNodeKind[]).map((k) => {
          const Icon = KIND_ICONS[k];
          const active = filter.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                active
                  ? 'border-transparent text-white'
                  : 'border-border bg-surface-raised text-fg-muted hover:text-fg',
              )}
              style={active ? { background: KIND_COLOR[k] } : undefined}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>

      <Card className="relative flex-1 overflow-hidden">
        {isLoading ? (
          <div className="grid h-full place-items-center text-fg-subtle">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center text-sm text-danger">
            Could not load graph.
          </div>
        ) : filteredNodes.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-fg-subtle">
            <div>
              <MousePointer className="mx-auto mb-2 h-6 w-6" aria-hidden />
              Nothing to show — enable at least one filter, or add some data.
            </div>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox="0 0 1600 1200"
            className="h-full w-full"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            role="img"
            aria-label="Knowledge graph"
          >
            {/* Edges first so nodes sit on top */}
            <g>
              {visibleEdges.map((edge, i) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) return null;
                const dim = hovered && hovered !== from.id && hovered !== to.id;
                return (
                  <line
                    key={i}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={from.color ?? KIND_COLOR[from.kind]}
                    strokeOpacity={dim ? 0.08 : 0.35}
                    strokeWidth={edge.kind === 'contains' ? 1.5 : 1}
                    strokeDasharray={edge.kind === 'related' ? '4 4' : undefined}
                  />
                );
              })}
            </g>
            {/* Nodes */}
            <g>
              {filteredNodes.map((n) => {
                const dim = hovered && hovered !== n.id;
                const fill = n.color ?? KIND_COLOR[n.kind];
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x} ${n.y})`}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: n.url ? 'pointer' : 'default' }}
                  >
                    {n.url ? (
                      <Link href={n.url}>
                        <NodeShape node={n} fill={fill} dim={!!dim} />
                      </Link>
                    ) : (
                      <NodeShape node={n} fill={fill} dim={!!dim} />
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </Card>
    </div>
  );
}

function NodeShape({
  node,
  fill,
  dim,
}: {
  node: PositionedNode;
  fill: string;
  dim: boolean;
}) {
  return (
    <>
      <circle
        r={node.radius}
        fill={fill}
        fillOpacity={dim ? 0.2 : 0.85}
        stroke={fill}
        strokeOpacity={dim ? 0.3 : 1}
        strokeWidth={node.kind === 'subject' ? 3 : 1.5}
      />
      <text
        y={node.radius + 14}
        textAnchor="middle"
        fontSize={node.kind === 'subject' ? 14 : 11}
        fontWeight={node.kind === 'subject' ? 600 : 400}
        fill="currentColor"
        opacity={dim ? 0.4 : 1}
        style={{ pointerEvents: 'none' }}
      >
        {node.label.length > 30 ? node.label.slice(0, 28) + '…' : node.label}
      </text>
    </>
  );
}
