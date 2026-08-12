'use client';

import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
// Highlight.js's default dark theme — keeps the code block readable in the
// existing dark OmnelOS UI. Auto-detects the language when the fence has one.
import 'highlight.js/styles/github-dark.css';

/**
 * Renders assistant text as Markdown, safely. Highlights fenced code blocks,
 * gives each code block a language label + copy-to-clipboard button, styles
 * tables/lists/headings/blockquotes to match the OmnelOS dark theme.
 *
 * This component is dynamic-imported by the chat page so pages that never
 * open the AI chat don't pay for react-markdown + highlight.js.
 */

function extractLang(className: string | undefined): string | null {
  if (!className) return null;
  const m = /language-([\w+-]+)/.exec(className);
  return m ? m[1]! : null;
}

function readCodeText(children: React.ReactNode): string {
  // react-markdown hands us a nested tree of React nodes — flatten strings.
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(readCodeText).join('');
  if (
    children &&
    typeof children === 'object' &&
    'props' in children &&
    (children as { props?: { children?: React.ReactNode } }).props
  ) {
    return readCodeText((children as { props: { children: React.ReactNode } }).props.children);
  }
  return '';
}

function CodeBlock({
  lang,
  children,
  className,
}: {
  lang: string | null;
  children: React.ReactNode;
  className: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const text = readCodeText(children);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-border/60 bg-black/40 px-3 py-1.5 text-[10px] uppercase tracking-widest text-fg-subtle">
        <span>{lang ?? 'code'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-white/5 hover:text-fg"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

interface Props {
  content: string;
}

function MessageContentInner({ content }: Props) {
  return (
    <div className="mm-md space-y-2 text-sm leading-relaxed text-fg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: (p) => <h1 className="mt-3 text-lg font-bold" {...p} />,
          h2: (p) => <h2 className="mt-3 text-base font-bold" {...p} />,
          h3: (p) => <h3 className="mt-2 text-sm font-semibold" {...p} />,
          p: (p) => <p className="whitespace-pre-wrap" {...p} />,
          a: (p) => (
            <a
              className="text-brand-bright underline underline-offset-2 hover:text-brand"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          ul: (p) => <ul className="ml-4 list-disc space-y-0.5" {...p} />,
          ol: (p) => <ol className="ml-4 list-decimal space-y-0.5" {...p} />,
          li: (p) => <li className="marker:text-fg-subtle" {...p} />,
          blockquote: (p) => (
            <blockquote
              className="border-l-2 border-brand/50 bg-brand/5 pl-3 italic text-fg-muted"
              {...p}
            />
          ),
          table: (p) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs" {...p} />
            </div>
          ),
          thead: (p) => <thead className="border-b border-border" {...p} />,
          th: (p) => <th className="px-2 py-1 text-left font-semibold text-fg" {...p} />,
          td: (p) => <td className="border-b border-border/40 px-2 py-1 text-fg-muted" {...p} />,
          hr: (p) => <hr className="my-3 border-border" {...p} />,
          strong: (p) => <strong className="font-semibold text-fg" {...p} />,
          em: (p) => <em className="italic text-fg" {...p} />,
          code: (props) => {
            const { className, children } = props as {
              className?: string;
              children?: React.ReactNode;
            };
            // react-markdown v10 no longer passes an `inline` prop — detect
            // by fence-provided className. Fenced blocks always carry
            // language-* even for unlabelled fences (rehype-highlight adds
            // "hljs" to blocks). Inline `code` has no class.
            const isFenced = !!className;
            if (isFenced) {
              return (
                <CodeBlock lang={extractLang(className)} className={className}>
                  {children}
                </CodeBlock>
              );
            }
            return (
              <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.85em] text-brand-bright">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MessageContent = memo(MessageContentInner);
