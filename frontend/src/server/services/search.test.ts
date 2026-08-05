import { describe, expect, it } from 'vitest';
import { highlight, highlightRanges, tokenizeQuery } from './search.service';

describe('highlight', () => {
  it('returns a window around the match', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const result = highlight(text, 'fox');
    expect(result).toContain('fox');
  });

  it('adds a leading ellipsis when the match is deep in the text', () => {
    const text = 'a'.repeat(100) + ' Newton ' + 'b'.repeat(100);
    const result = highlight(text, 'Newton');
    expect(result.startsWith('...')).toBe(true);
    expect(result).toContain('Newton');
  });

  it('matches case-insensitively', () => {
    const text = 'Studying THERMODYNAMICS is fun';
    const result = highlight(text, 'thermodynamics');
    expect(result.toLowerCase()).toContain('thermodynamics');
  });

  it('falls back to the head of the text when no match', () => {
    const text = 'x'.repeat(200);
    const result = highlight(text, 'zzz', 50);
    expect(result.length).toBe(50);
  });

  it('handles empty text', () => {
    expect(highlight('', 'anything')).toBe('');
  });
});

describe('tokenizeQuery', () => {
  it('returns [phrase, ...tokens] deduplicated and lowercased', () => {
    const tokens = tokenizeQuery('Linear Algebra');
    expect(tokens).toContain('linear algebra');
    expect(tokens).toContain('linear');
    expect(tokens).toContain('algebra');
  });

  it('drops tokens shorter than 2 chars but keeps them as part of the phrase', () => {
    const tokens = tokenizeQuery('a big test');
    expect(tokens).toContain('a big test');
    expect(tokens).toContain('big');
    expect(tokens).toContain('test');
    // "a" is dropped from the individual-token list because it would match everywhere.
    expect(tokens.filter((t) => t === 'a')).toHaveLength(0);
  });

  it('returns an empty list on whitespace-only input', () => {
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('highlightRanges', () => {
  it('returns case-insensitive match ranges for each token', () => {
    const ranges = highlightRanges('Newton studied Motion and gravity', ['newton', 'motion']);
    expect(ranges).toEqual([
      [0, 6],
      [15, 21],
    ]);
  });

  it('merges overlapping ranges', () => {
    // "cats" overlaps "cat" starting at the same index; result should merge them.
    const ranges = highlightRanges('The cats sat.', ['cat', 'cats']);
    expect(ranges).toEqual([[4, 8]]);
  });

  it('finds every occurrence of a token', () => {
    const ranges = highlightRanges('ab ab ab', ['ab']);
    expect(ranges).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it('is empty when no tokens match', () => {
    expect(highlightRanges('hello world', ['xyz'])).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(highlightRanges('', ['foo'])).toEqual([]);
    expect(highlightRanges('foo', [])).toEqual([]);
  });
});
