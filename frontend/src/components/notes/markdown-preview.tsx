'use client';

import { useMemo, type JSX } from 'react';

/**
 * Minimal, dependency-free markdown renderer.
 *
 * Written by hand rather than pulled from a library because the input is the
 * user's own notes and we never use `dangerouslySetInnerHTML` — every node is
 * constructed as a React element, so a note containing `<script>` renders as
 * literal text and can never execute.
 */

type Token =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'code'; language: string; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'rule' }
  | { kind: 'paragraph'; lines: string[] };

function tokenize(markdown: string): Token[] {
  const lines = markdown.split('\n');
  const tokens: Token[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // closing fence
      tokens.push({ kind: 'code', language, lines: body });
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      tokens.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2] ?? '',
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      tokens.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      tokens.push({ kind: 'quote', lines: body });
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*+]\s+/;

      while (index < lines.length && pattern.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(pattern, ''));
        index += 1;
      }
      tokens.push({ kind: 'list', ordered, items });
      continue;
    }

    const body: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !/^(#{1,3}\s|>|```|[-*+]\s|\d+\.\s|-{3,})/.test(lines[index] ?? '')
    ) {
      body.push(lines[index] ?? '');
      index += 1;
    }
    tokens.push({ kind: 'paragraph', lines: body });
  }

  return tokens;
}

/** Applies inline emphasis, code and links, returning React nodes. */
function renderInline(text: string, keyPrefix: string): (string | JSX.Element)[] {
  const pattern =
    /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(`[^`]+`)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/g;

  const nodes: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let counter = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    const token = match[0];
    const key = `${keyPrefix}-${counter}`;
    counter += 1;

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(
        <span key={key} className="line-through opacity-70">
          {token.slice(2, -2)}
        </span>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.85em] text-brand-bright"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link?.[2] ?? '';
      // Only http(s) links are rendered as anchors; javascript: and data:
      // URLs fall back to plain text.
      const safe = /^https?:\/\//i.test(href);
      nodes.push(
        safe ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-bright underline underline-offset-2 hover:text-accent"
          >
            {link?.[1]}
          </a>
        ) : (
          <span key={key}>{link?.[1]}</span>
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function MarkdownPreview({ content }: { content: string }) {
  const tokens = useMemo(() => tokenize(content), [content]);

  if (content.trim() === '') {
    return <p className="text-sm italic text-fg-subtle">Nothing to preview yet.</p>;
  }

  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {tokens.map((token, index) => {
        const key = `token-${index}`;

        switch (token.kind) {
          case 'heading': {
            const sizes = {
              1: 'text-2xl font-bold mt-5',
              2: 'text-xl font-semibold mt-4',
              3: 'text-lg font-semibold mt-3',
            } as const;
            const Tag = (['h1', 'h2', 'h3'] as const)[token.level - 1] ?? 'h3';
            return (
              <Tag key={key} className={sizes[token.level]}>
                {renderInline(token.text, key)}
              </Tag>
            );
          }

          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-xl border border-border bg-surface-raised p-4"
              >
                <code className="font-mono text-[13px] text-fg-muted">
                  {token.lines.join('\n')}
                </code>
              </pre>
            );

          case 'quote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-brand/50 pl-4 italic text-fg-muted"
              >
                {renderInline(token.lines.join(' '), key)}
              </blockquote>
            );

          case 'list': {
            const Tag = token.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={key}
                className={`ml-5 space-y-1 ${token.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {token.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`} className="text-fg-muted">
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </Tag>
            );
          }

          case 'rule':
            return <hr key={key} className="border-border" />;

          case 'paragraph':
            return (
              <p key={key} className="text-fg-muted">
                {renderInline(token.lines.join(' '), key)}
              </p>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
