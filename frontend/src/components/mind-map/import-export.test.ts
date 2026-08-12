import { describe, expect, it } from 'vitest';
import { fromJson, fromMarkdown, toJson, toMarkdown } from './import-export';
import type { MindMapFull } from '@/hooks/use-mind-maps';

function makeMap(): MindMapFull {
  return {
    id: 'm1',
    title: 'Sample',
    description: null,
    favorite: false,
    aiGenerated: false,
    subjectId: null,
    subject: null,
    settings: null,
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    nodes: [
      {
        id: 'mmn_root',
        parentId: null,
        type: 'root',
        title: 'Root',
        content: null,
        x: 0,
        y: 0,
        color: null,
        icon: null,
        tags: [],
        refType: null,
        refId: null,
        style: null,
        metadata: null,
      },
      {
        id: 'mmn_child',
        parentId: 'mmn_root',
        type: 'topic',
        title: 'Child',
        content: null,
        x: 100,
        y: 0,
        color: null,
        icon: null,
        tags: [],
        refType: null,
        refId: null,
        style: null,
        metadata: null,
      },
    ],
    edges: [
      {
        id: 'mme_1',
        sourceId: 'mmn_root',
        targetId: 'mmn_child',
        label: null,
        type: 'default',
        style: null,
        metadata: null,
      },
    ],
  };
}

describe('mind-map JSON round-trip', () => {
  it('serialises and re-parses cleanly', () => {
    const map = makeMap();
    const roundTripped = fromJson(toJson(map));
    expect(roundTripped.nodes).toHaveLength(2);
    expect(roundTripped.edges).toHaveLength(1);
    expect(roundTripped.title).toBe('Sample');
    // Ids are rewritten to fresh mmn_ ids on import; parent chain must survive.
    const child = roundTripped.nodes.find((n) => n.title === 'Child');
    const root = roundTripped.nodes.find((n) => n.title === 'Root');
    expect(child?.parentId).toBe(root?.id);
  });

  it('throws on missing nodes array', () => {
    expect(() => fromJson(JSON.stringify({ title: 'x' }))).toThrow();
  });
});

describe('mind-map Markdown parser', () => {
  it('parses a heading-only outline', () => {
    const md = `# Cybersecurity\n\n## Network Security\n### Firewalls\n### IDS\n## Application Security\n### OWASP`;
    const parsed = fromMarkdown(md);
    expect(parsed.title).toBe('Cybersecurity');
    // Root + 2 topics + 3 subtopics = 6 nodes.
    expect(parsed.nodes).toHaveLength(6);
    const netSec = parsed.nodes.find((n) => n.title === 'Network Security')!;
    const firewalls = parsed.nodes.find((n) => n.title === 'Firewalls')!;
    expect(firewalls.parentId).toBe(netSec.id);
  });

  it('parses a bullet-list outline', () => {
    const md = `Study Plan\n- Sorting\n  - Bubble sort\n  - Merge sort\n- Searching\n  - Binary search`;
    const parsed = fromMarkdown(md);
    // No `#` heading so we don't produce a root node; bullets become nested nodes.
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(5);
    const sorting = parsed.nodes.find((n) => n.title === 'Sorting');
    const bubble = parsed.nodes.find((n) => n.title === 'Bubble sort');
    expect(bubble?.parentId).toBe(sorting?.id);
  });

  it('does not execute embedded HTML', () => {
    // Guard against a naïve importer that inlines HTML — the parser only
    // extracts text from headings/lists.
    const md = `# <script>alert(1)</script>Hi\n## <img onerror="x">Node`;
    const parsed = fromMarkdown(md);
    // Titles keep the literal characters (safe: they're text nodes when rendered).
    expect(parsed.nodes.some((n) => n.title?.includes('<script>'))).toBe(true);
    // But there is no code path that inserts them as HTML — that's on the
    // renderer, which uses {node.data.title} in React (auto-escaped).
  });

  it('returns an empty parse when the input is only prose', () => {
    const parsed = fromMarkdown('just some random paragraph text.');
    expect(parsed.nodes).toHaveLength(0);
  });
});

describe('mind-map Markdown export', () => {
  it('exports the map hierarchy as headings', () => {
    const md = toMarkdown(makeMap());
    expect(md.startsWith('# Sample')).toBe(true);
    expect(md).toContain('## Root');
    expect(md).toContain('### Child');
  });
});
