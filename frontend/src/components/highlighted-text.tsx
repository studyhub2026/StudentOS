'use client';

import type { HighlightRange } from '@/hooks/use-search';

interface Props {
  text: string;
  ranges?: HighlightRange[];
  className?: string;
}

/**
 * Renders `text` with the given non-overlapping ranges wrapped in <mark>.
 * Ranges are produced server-side by `highlightRanges()`; falling back to
 * plain text if none are supplied keeps this safe for empty results.
 */
export function HighlightedText({ text, ranges, className }: Props) {
  if (!ranges || ranges.length === 0) {
    return <span className={className}>{text}</span>;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={i}
        className="rounded-sm bg-brand/25 px-0.5 text-brand-bright"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
}
