import { describe, expect, it } from 'vitest';
import { mergeTopics } from './tutor-insight.service';

describe('mergeTopics', () => {
  it('unions new and existing, newest first', () => {
    expect(mergeTopics(['algebra'], ['calculus'])).toEqual(['calculus', 'algebra']);
  });

  it('deduplicates case-insensitively, keeping the incoming casing', () => {
    expect(mergeTopics(['Algebra'], ['algebra', 'Vectors'])).toEqual(['algebra', 'Vectors']);
  });

  it('removes topics listed in the remove set', () => {
    // A topic that became strong should drop out of the weak list.
    expect(mergeTopics(['bonding', 'stoichiometry'], [], ['bonding'])).toEqual(['stoichiometry']);
  });

  it('caps the list length', () => {
    const many = Array.from({ length: 30 }, (_, i) => `topic-${i}`);
    expect(mergeTopics([], many).length).toBeLessThanOrEqual(12);
  });

  it('trims and ignores blank entries', () => {
    expect(mergeTopics([], ['  waves  ', '', '   '])).toEqual(['waves']);
  });
});
