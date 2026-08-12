import type { MindNode, MindEdge } from '@/stores/mind-map-editor-store';

/**
 * Auto-layout for mind maps. A pure BFS radial layout — the root sits at the
 * centre, its children fan out on concentric rings. Simple, deterministic,
 * and dependency-free.
 *
 * We treat the graph as undirected for layout purposes but pick a root based
 * on: (1) explicit `type === "root"`, (2) node with fewest incoming edges,
 * (3) first node otherwise. For disconnected components each root is offset
 * so they don't collide.
 */

const RING_SPACING = 220;
const MIN_NODE_ANGLE = (2 * Math.PI) / 3; // 120° per child before we expand rings

export function radialLayout(nodes: MindNode[], edges: MindEdge[]): MindNode[] {
  if (nodes.length === 0) return nodes;

  // Adjacency list — undirected for BFS.
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);

  const laidOut = new Map<string, { x: number; y: number }>();
  const remaining = new Set(nodes.map((n) => n.id));
  let componentOffsetX = 0;

  while (remaining.size > 0) {
    // Pick a root for this component.
    const roots = nodes.filter((n) => remaining.has(n.id) && n.data.type === 'root');
    let rootId: string;
    if (roots.length > 0) {
      rootId = roots[0]!.id;
    } else {
      const candidates = [...remaining]
        .map((id) => ({ id, deg: inDegree.get(id) ?? 0 }))
        .sort((a, b) => a.deg - b.deg);
      rootId = candidates[0]!.id;
    }

    // BFS levels from the root.
    const levels = new Map<string, number>();
    const parentInLayout = new Map<string, string>();
    const queue: string[] = [rootId];
    levels.set(rootId, 0);
    const visitOrder: string[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (!remaining.has(cur)) continue;
      visitOrder.push(cur);
      remaining.delete(cur);
      const depth = levels.get(cur)!;
      for (const neighbour of adj.get(cur) ?? []) {
        if (!levels.has(neighbour) && remaining.has(neighbour)) {
          levels.set(neighbour, depth + 1);
          parentInLayout.set(neighbour, cur);
          queue.push(neighbour);
        }
      }
    }

    // Group by depth.
    const byDepth = new Map<number, string[]>();
    for (const id of visitOrder) {
      const d = levels.get(id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(id);
    }

    laidOut.set(rootId, { x: componentOffsetX, y: 0 });

    const maxDepth = Math.max(...byDepth.keys());
    for (let d = 1; d <= maxDepth; d++) {
      const ids = byDepth.get(d) ?? [];
      // Slot children under their parent's angular range so siblings stay
      // near their parent (rather than a naïve "spread all at this depth").
      const parents = new Map<string, string[]>();
      for (const id of ids) {
        const p = parentInLayout.get(id) ?? rootId;
        if (!parents.has(p)) parents.set(p, []);
        parents.get(p)!.push(id);
      }
      const radius = RING_SPACING * d;
      for (const [pid, children] of parents) {
        const parentPos = laidOut.get(pid) ?? { x: componentOffsetX, y: 0 };
        const parentAngle = Math.atan2(parentPos.y, parentPos.x - componentOffsetX);
        // For depth-1 spread children full circle, else in a fan pointing away
        // from the root.
        const angularRange = d === 1 ? Math.PI * 2 : MIN_NODE_ANGLE;
        const step = children.length > 1 ? angularRange / (children.length - (d === 1 ? 0 : 1)) : 0;
        const start = d === 1 ? 0 : parentAngle - angularRange / 2;
        for (let i = 0; i < children.length; i++) {
          const angle = start + step * i;
          laidOut.set(children[i]!, {
            x: componentOffsetX + Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
          });
        }
      }
    }

    componentOffsetX += RING_SPACING * (maxDepth + 2);
  }

  return nodes.map((n) => ({
    ...n,
    position: laidOut.get(n.id) ?? n.position,
  }));
}
