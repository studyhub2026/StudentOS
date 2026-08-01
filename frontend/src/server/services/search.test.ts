import { describe, expect, it } from 'vitest';
import { highlight } from './search.service';

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
