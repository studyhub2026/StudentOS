import type { MindNode, MindEdge } from '@/stores/mind-map-editor-store';

/**
 * Horizontal tree layout — the root sits on the left and children fan out to
 * the right in columns, each sibling stacked vertically. Matches the mental
 * model used by Google NotebookLM and classic outline mind maps: the shape of
 * the diagram mirrors the shape of the hierarchy.
 *
 * The export name stays `radialLayout` to keep the editor's existing wiring
 * intact — it is a tree layout now, not actually radial, but every caller
 * just wants "please lay the graph out sensibly".
 *
 * Algorithm:
 *   1. Build the parent → children adjacency.
 *   2. Pick roots: explicit `type === 'root'` first, otherwise anything with
 *      no incoming edge, otherwise the first node (handles disconnected and
 *      fully cyclic graphs without crashing).
 *   3. Bottom-up DFS: measure each subtree's vertical extent so we know how
 *      much room its children collectively need.
 *   4. Top-down DFS: place each node at the horizontal column for its depth,
 *      vertically centered on its own subtree's slot.
 *
 * Everything is pure (no React Flow API calls) and deterministic.
 */

const NODE_WIDTH = 220;
const NODE_HEIGHT = 56;
const H_SPACING = 80;
const V_SPACING = 24;
const ROOT_GAP = V_SPACING * 2;

export function radialLayout(nodes: MindNode[], edges: MindEdge[]): MindNode[] {
  if (nodes.length === 0) return nodes;

  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const n of nodes) children.set(n.id, []);
  for (const e of edges) {
    children.get(e.source)?.push(e.target);
    hasParent.add(e.target);
  }

  // Root selection: honour an explicit root first, otherwise any orphan,
  // otherwise fall back to the first node so we always produce *something*.
  const explicitRoots = nodes.filter((n) => n.data.type === 'root' && !hasParent.has(n.id));
  const orphanRoots = nodes.filter((n) => !hasParent.has(n.id));
  const roots: string[] = (explicitRoots.length > 0 ? explicitRoots : orphanRoots).map((n) => n.id);
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]!.id);

  const subtreeH = new Map<string, number>();
  const measured = new Set<string>();
  function measure(id: string): number {
    if (measured.has(id)) return subtreeH.get(id) ?? NODE_HEIGHT;
    measured.add(id);
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      subtreeH.set(id, NODE_HEIGHT);
      return NODE_HEIGHT;
    }
    let total = 0;
    for (const k of kids) total += measure(k);
    total += V_SPACING * Math.max(0, kids.length - 1);
    const h = Math.max(NODE_HEIGHT, total);
    subtreeH.set(id, h);
    return h;
  }

  const pos = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>();
  function place(id: string, x: number, yTop: number) {
    if (placed.has(id)) return;
    placed.add(id);
    const h = subtreeH.get(id) ?? NODE_HEIGHT;
    // Centre this node vertically within the slot its subtree occupies, so
    // the connector to each child meets the child on its vertical midpoint.
    pos.set(id, { x, y: yTop + (h - NODE_HEIGHT) / 2 });
    const kids = children.get(id) ?? [];
    let kidY = yTop;
    for (const k of kids) {
      const kh = subtreeH.get(k) ?? NODE_HEIGHT;
      place(k, x + NODE_WIDTH + H_SPACING, kidY);
      kidY += kh + V_SPACING;
    }
  }

  let yCursor = 0;
  for (const root of roots) {
    measure(root);
    place(root, 0, yCursor);
    yCursor += (subtreeH.get(root) ?? NODE_HEIGHT) + ROOT_GAP;
  }

  // Anything a cycle or orphan loop stranded gets stacked at the bottom so
  // the user can still see and move it.
  for (const n of nodes) {
    if (!pos.has(n.id)) {
      pos.set(n.id, { x: 0, y: yCursor });
      yCursor += NODE_HEIGHT + V_SPACING;
    }
  }

  return nodes.map((n) => ({
    ...n,
    position: pos.get(n.id) ?? n.position,
  }));
}
