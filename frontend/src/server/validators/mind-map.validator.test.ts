import { describe, expect, it } from 'vitest';
import { aiGeneratedGraphSchema, bulkSaveSchema } from './mind-map.validator';

describe('aiGeneratedGraphSchema', () => {
  it('accepts a minimal valid graph', () => {
    const parsed = aiGeneratedGraphSchema.parse({
      title: 'Cybersecurity',
      nodes: [
        { id: 'root', type: 'root', title: 'Cybersecurity' },
        { id: 'net', type: 'topic', title: 'Network Security', parentId: 'root' },
      ],
      edges: [{ source: 'root', target: 'net' }],
    });
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
  });

  it('defaults edges to an empty array when absent', () => {
    const parsed = aiGeneratedGraphSchema.parse({
      title: 'X',
      nodes: [{ id: 'r', type: 'root', title: 'X' }],
    });
    expect(parsed.edges).toEqual([]);
  });

  it('rejects a graph with zero nodes', () => {
    expect(() =>
      aiGeneratedGraphSchema.parse({ title: 'X', nodes: [] }),
    ).toThrow();
  });

  it('rejects a graph with excessive nodes (runaway model guard)', () => {
    const runaway = {
      title: 'RUNAWAY',
      nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: 'topic', title: `Node ${i}` })),
    };
    expect(() => aiGeneratedGraphSchema.parse(runaway)).toThrow();
  });

  it('rejects an over-long title', () => {
    expect(() =>
      aiGeneratedGraphSchema.parse({
        title: 'x'.repeat(1000),
        nodes: [{ id: 'r', type: 'root', title: 'r' }],
      }),
    ).toThrow();
  });
});

describe('bulkSaveSchema', () => {
  it('accepts a nodes-only payload', () => {
    const parsed = bulkSaveSchema.parse({
      nodes: [{ id: 'mmn_abc123', title: 'Alpha' }],
    });
    expect(parsed.nodes?.[0]?.id).toBe('mmn_abc123');
  });

  it('rejects a node with a too-long title', () => {
    expect(() =>
      bulkSaveSchema.parse({
        nodes: [{ id: 'mmn_abc123', title: 'x'.repeat(500) }],
      }),
    ).toThrow();
  });

  it('rejects an edge with the same source and target left off', () => {
    expect(() =>
      bulkSaveSchema.parse({
        edges: [{ id: 'mme_abc', sourceId: 'mmn_a' }],
      }),
    ).toThrow();
  });

  it('caps the number of nodes in a single save', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: `mmn_${i.toString().padStart(6, '0')}`, title: `n${i}` }));
    expect(() => bulkSaveSchema.parse({ nodes: many })).toThrow();
  });
});
