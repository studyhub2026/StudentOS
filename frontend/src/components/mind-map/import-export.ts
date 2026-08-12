import type { MindMapFull, MindMapNodeDto, MindMapEdgeDto } from '@/hooks/use-mind-maps';
import { newMindId } from '@/lib/mind-map-ids';

/**
 * Convert a mind map to portable JSON — safe to save to disk and re-import
 * into any deployment.
 */
export function toJson(map: MindMapFull): string {
  return JSON.stringify(
    {
      version: 1,
      title: map.title,
      description: map.description,
      nodes: map.nodes.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        type: n.type,
        title: n.title,
        content: n.content,
        x: n.x,
        y: n.y,
        color: n.color,
        icon: n.icon,
        tags: n.tags,
        refType: n.refType,
        refId: n.refId,
      })),
      edges: map.edges.map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        label: e.label,
        type: e.type,
      })),
    },
    null,
    2,
  );
}

export function toMarkdown(map: MindMapFull): string {
  // Build a parent → children index. Roots are nodes without a parentId.
  const childrenByParent = new Map<string, MindMapNodeDto[]>();
  const orphans: MindMapNodeDto[] = [];
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  for (const n of map.nodes) {
    if (n.parentId && nodeById.has(n.parentId)) {
      if (!childrenByParent.has(n.parentId)) childrenByParent.set(n.parentId, []);
      childrenByParent.get(n.parentId)!.push(n);
    } else {
      orphans.push(n);
    }
  }
  const lines: string[] = [`# ${map.title}`];
  if (map.description) lines.push('', map.description);
  const seen = new Set<string>();
  function walk(node: MindMapNodeDto, depth: number) {
    if (seen.has(node.id)) return; // guard against cycles
    seen.add(node.id);
    const prefix = '#'.repeat(Math.min(depth + 1, 6));
    lines.push('', `${prefix} ${node.title}`);
    if (node.content) lines.push(node.content);
    for (const c of childrenByParent.get(node.id) ?? []) walk(c, depth + 1);
  }
  for (const root of orphans) walk(root, 1);
  return lines.join('\n');
}

interface Parsed {
  nodes: Partial<MindMapNodeDto & { id: string; title: string }>[];
  edges: Partial<MindMapEdgeDto & { id: string; sourceId: string; targetId: string }>[];
  title?: string;
}

/**
 * Parse a Markdown outline into a mind map. Uses ATX (#) headings *and* nested
 * list markers (`-`, `*`) — whichever the student wrote.
 *
 * Heading rules: `#` = title (root), `##` = topic, `###+` = deeper. If there
 * are no `#`, the first non-list line becomes the title.
 *
 * List rules: indentation-sensitive. 2 spaces = one deeper level.
 */
export function fromMarkdown(text: string): Parsed {
  const lines = text.split(/\r?\n/);
  const nodes: Parsed['nodes'] = [];
  const edges: Parsed['edges'] = [];

  // Stack of currently-open parents keyed by depth.
  const stack: { depth: number; id: string }[] = [];
  let title: string | undefined;

  function attach(parentId: string | null, id: string) {
    if (parentId) {
      edges.push({ id: newMindId('e'), sourceId: parentId, targetId: id });
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, '');
    if (!line.trim()) continue;

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      const text = heading[2]!.trim();
      if (depth === 1 && !title) {
        title = text;
        // Also produce a root node so a Markdown with just `# Title` still
        // makes a one-node map.
        const rootId = newMindId('n');
        nodes.push({ id: rootId, title, type: 'root', parentId: null });
        stack.length = 0;
        stack.push({ depth: 1, id: rootId });
        continue;
      }
      // Pop stack until we're above `depth`.
      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) stack.pop();
      const parentId = stack[stack.length - 1]?.id ?? null;
      const id = newMindId('n');
      nodes.push({
        id,
        title: text,
        type: depth === 2 ? 'topic' : depth === 3 ? 'subtopic' : 'concept',
        parentId,
      });
      attach(parentId, id);
      stack.push({ depth, id });
      continue;
    }

    const listMatch = /^([ \t]*)(?:[-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch) {
      const indent = listMatch[1]!.replace(/\t/g, '  ').length;
      const text = listMatch[2]!.trim();
      // Map list indentation onto the same depth scale as headings, offset by
      // the deepest heading currently on the stack.
      const depthOffset = stack.length > 0 ? stack[stack.length - 1]!.depth : 1;
      const depth = depthOffset + Math.floor(indent / 2) + 1;
      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) stack.pop();
      const parentId = stack[stack.length - 1]?.id ?? null;
      const id = newMindId('n');
      nodes.push({ id, title: text, type: 'subtopic', parentId });
      attach(parentId, id);
      stack.push({ depth, id });
      continue;
    }

    // Non-heading, non-list line: treat as extra content for the current node.
    const current = stack[stack.length - 1];
    if (current) {
      const node = nodes.find((n) => n.id === current.id);
      if (node) node.content = node.content ? `${node.content}\n${line.trim()}` : line.trim();
    }
  }

  if (nodes.length === 0) {
    return { nodes: [], edges: [], title };
  }
  return { nodes, edges, title };
}

/**
 * Parse a JSON export. Accepts either our v1 shape or a naked
 * `{ nodes: [], edges: [] }` shape (also produced by AI).
 */
export function fromJson(text: string): Parsed {
  const parsed = JSON.parse(text);
  const src = parsed as { title?: string; nodes?: unknown[]; edges?: unknown[] };
  if (!Array.isArray(src.nodes)) throw new Error('Missing "nodes" array');

  const nodes = src.nodes.map((raw) => {
    const n = raw as Record<string, unknown>;
    return {
      id: typeof n.id === 'string' && n.id.startsWith('mmn_') ? n.id : newMindId('n'),
      title: typeof n.title === 'string' ? n.title : 'Untitled',
      type: typeof n.type === 'string' ? n.type : 'topic',
      content: typeof n.content === 'string' ? n.content : null,
      parentId: typeof n.parentId === 'string' ? n.parentId : null,
      color: typeof n.color === 'string' ? n.color : null,
      icon: typeof n.icon === 'string' ? n.icon : null,
      tags: Array.isArray(n.tags) ? (n.tags.filter((t) => typeof t === 'string') as string[]) : [],
      x: typeof n.x === 'number' ? n.x : 0,
      y: typeof n.y === 'number' ? n.y : 0,
      refType: typeof n.refType === 'string' ? n.refType : null,
      refId: typeof n.refId === 'string' ? n.refId : null,
    };
  });

  const idAliases = new Map<string, string>();
  for (let i = 0; i < (src.nodes as Record<string, unknown>[]).length; i++) {
    const original = (src.nodes as Record<string, unknown>[])[i]!.id;
    if (typeof original === 'string') idAliases.set(original, nodes[i]!.id);
  }

  // Rewrite parent ids through the alias table so imported non-mm ids still resolve.
  for (const n of nodes) {
    if (n.parentId && idAliases.has(n.parentId)) n.parentId = idAliases.get(n.parentId)!;
  }

  const edges = Array.isArray(src.edges)
    ? src.edges
        .map((raw) => {
          const e = raw as Record<string, unknown>;
          const source = typeof e.sourceId === 'string' ? e.sourceId : typeof e.source === 'string' ? e.source : null;
          const target = typeof e.targetId === 'string' ? e.targetId : typeof e.target === 'string' ? e.target : null;
          if (!source || !target) return null;
          const src = idAliases.get(source) ?? source;
          const tgt = idAliases.get(target) ?? target;
          if (!nodes.find((n) => n.id === src) || !nodes.find((n) => n.id === tgt)) return null;
          return {
            id: newMindId('e'),
            sourceId: src,
            targetId: tgt,
            label: typeof e.label === 'string' ? e.label : null,
            type: typeof e.type === 'string' ? e.type : 'default',
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null)
    : [];

  return { nodes, edges, title: typeof src.title === 'string' ? src.title : undefined };
}

/**
 * Convert a React Flow container node to an SVG string. We serialise the
 * `.react-flow__viewport` transform + a snapshot of each node's DOM as SVG
 * `<foreignObject>` so styling is preserved without asking the browser for
 * a full DOM-to-SVG raster.
 */
export function exportSvg(container: HTMLElement): string {
  const flowEl = container.querySelector('.react-flow') as HTMLElement | null;
  if (!flowEl) throw new Error('React Flow root not found');
  const bounds = flowEl.getBoundingClientRect();
  const clone = flowEl.cloneNode(true) as HTMLElement;
  // Drop the controls/minimap/attribution which are UI-only.
  for (const sel of ['.react-flow__minimap', '.react-flow__controls', '.react-flow__attribution']) {
    clone.querySelectorAll(sel).forEach((n) => n.remove());
  }
  const html = new XMLSerializer().serializeToString(clone);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
}

export function downloadFile(name: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
