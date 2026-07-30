import { describe, expect, it } from 'vitest';
import { buildExcerpt, countWords } from './note.service';
import { parseCsv, toCsv, type ExportedDeck } from './flashcard.service';

describe('note word counting', () => {
  it('counts plain prose', () => {
    expect(countWords('the quick brown fox')).toBe(4);
  });

  it('returns zero for empty or whitespace-only input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('ignores markdown heading and emphasis markers', () => {
    // "Chapter One" plus "bold text here" — the markers are not words.
    expect(countWords('## Chapter One\n\n**bold** _text_ here')).toBe(5);
  });

  it('excludes fenced code blocks', () => {
    const markdown = 'intro words here\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\noutro';
    expect(countWords(markdown)).toBe(4);
  });

  it('counts link text but not the URL', () => {
    expect(countWords('see [the docs](https://example.com/a/b/c)')).toBe(3);
  });
});

describe('note excerpts', () => {
  it('strips markdown syntax', () => {
    expect(buildExcerpt('# Title\n\nSome **bold** text.')).toBe('Title Some bold text.');
  });

  it('collapses whitespace onto one line', () => {
    expect(buildExcerpt('line one\n\n\nline   two')).toBe('line one line two');
  });

  it('truncates with an ellipsis past the limit', () => {
    const excerpt = buildExcerpt('word '.repeat(100), 40);
    expect(excerpt.length).toBeLessThanOrEqual(41);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('leaves short content unchanged and unsuffixed', () => {
    expect(buildExcerpt('short note')).toBe('short note');
  });

  it('drops code fences from the preview', () => {
    expect(buildExcerpt('intro\n```\nsecret = 1\n```\nafter')).toBe('intro after');
  });
});

function deckOf(cards: ExportedDeck['cards']): ExportedDeck {
  return {
    name: 'Test deck',
    description: null,
    color: '#14b8a6',
    exportedAt: new Date().toISOString(),
    cards,
  };
}

describe('flashcard CSV', () => {
  it('round-trips a simple deck', () => {
    const deck = deckOf([
      { front: 'Capital of France', back: 'Paris', hint: null, tags: [], difficulty: 'EASY' },
      { front: 'Capital of Japan', back: 'Tokyo', hint: 'Not Kyoto', tags: ['geo'], difficulty: 'MEDIUM' },
    ]);

    const parsed = parseCsv(toCsv(deck));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ front: 'Capital of France', back: 'Paris', hint: null });
    expect(parsed[1]).toMatchObject({ front: 'Capital of Japan', back: 'Tokyo', hint: 'Not Kyoto' });
    expect(parsed[1]?.tags).toEqual(['geo']);
  });

  it('survives commas inside fields', () => {
    const deck = deckOf([
      { front: 'List three, in order', back: 'a, b, c', hint: null, tags: [], difficulty: 'MEDIUM' },
    ]);

    const parsed = parseCsv(toCsv(deck));
    expect(parsed[0]?.front).toBe('List three, in order');
    expect(parsed[0]?.back).toBe('a, b, c');
  });

  it('survives quotes inside fields', () => {
    const deck = deckOf([
      { front: 'Who said "I think"?', back: 'Descartes', hint: null, tags: [], difficulty: 'HARD' },
    ]);

    expect(parseCsv(toCsv(deck))[0]?.front).toBe('Who said "I think"?');
  });

  it('survives newlines inside fields', () => {
    const deck = deckOf([
      { front: 'Line one\nLine two', back: 'answer', hint: null, tags: [], difficulty: 'MEDIUM' },
    ]);

    expect(parseCsv(toCsv(deck))[0]?.front).toBe('Line one\nLine two');
  });

  it('round-trips multiple tags', () => {
    const deck = deckOf([
      { front: 'q', back: 'a', hint: null, tags: ['one', 'two', 'three'], difficulty: 'MEDIUM' },
    ]);

    expect(parseCsv(toCsv(deck))[0]?.tags).toEqual(['one', 'two', 'three']);
  });

  it('accepts columns in any order', () => {
    const csv = 'back,front,hint\n"Paris","Capital of France","City"';
    expect(parseCsv(csv)[0]).toMatchObject({
      front: 'Capital of France',
      back: 'Paris',
      hint: 'City',
    });
  });

  it('accepts a file with no optional columns', () => {
    const parsed = parseCsv('front,back\nq1,a1\nq2,a2');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ front: 'q1', back: 'a1', hint: null, tags: [] });
  });

  it('rejects a file missing required columns', () => {
    expect(() => parseCsv('question,answer\nq,a')).toThrow(/front.*back/i);
  });

  it('skips blank rows and rows missing a side', () => {
    const parsed = parseCsv('front,back\nq1,a1\n\n,,\nq2,\n,a3\nq4,a4');
    expect(parsed.map((card) => card.front)).toEqual(['q1', 'q4']);
  });

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('front,back\nq,a')).toHaveLength(1);
  });

  it('returns an empty list for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('emits CRLF line endings for spreadsheet compatibility', () => {
    const csv = toCsv(deckOf([{ front: 'q', back: 'a', hint: null, tags: [], difficulty: 'EASY' }]));
    expect(csv).toContain('\r\n');
  });
});
