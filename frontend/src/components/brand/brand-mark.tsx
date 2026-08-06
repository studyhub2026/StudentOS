import type { SVGProps } from 'react';

/**
 * The OmnelOS mark — a blue-to-purple ring with dot-trails flowing into it.
 * Renders inline so it inherits currentColor conventions and stays crisp at
 * any size. Colour comes from the gradient stops, not currentColor.
 */
export function OmnelMark({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient id="omnel-ring-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <linearGradient id="omnel-dots-a" x1="0" y1="0.5" x2="1" y2="0.5">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      <circle
        cx="118"
        cy="100"
        r="60"
        stroke="url(#omnel-ring-a)"
        strokeWidth="20"
      />

      <g fill="url(#omnel-dots-a)">
        <circle cx="26" cy="100" r="4" opacity="0.35" />
        <circle cx="40" cy="100" r="5" opacity="0.55" />
        <circle cx="56" cy="100" r="6" opacity="0.75" />
        <circle cx="30" cy="80" r="3.5" opacity="0.35" />
        <circle cx="44" cy="80" r="4.5" opacity="0.55" />
        <circle cx="58" cy="80" r="5.5" opacity="0.7" />
        <circle cx="30" cy="120" r="3.5" opacity="0.35" />
        <circle cx="44" cy="120" r="4.5" opacity="0.55" />
        <circle cx="58" cy="120" r="5.5" opacity="0.7" />
      </g>

      <g stroke="url(#omnel-dots-a)" strokeLinecap="round" strokeWidth="4">
        <line x1="70" y1="100" x2="90" y2="100" opacity="0.8" />
        <line x1="70" y1="80" x2="88" y2="80" opacity="0.65" />
        <line x1="70" y1="120" x2="88" y2="120" opacity="0.65" />
      </g>
    </svg>
  );
}

/**
 * The full OmnelOS wordmark: mark + "Omnel" in white + "OS" in the accent
 * gradient. Kept as a single component so brand usage across the app stays
 * consistent — one import, one place to redesign.
 */
export function OmnelWordmark({
  className,
  showTagline = false,
  size = 'md',
}: {
  className?: string;
  showTagline?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const heights = { sm: 'h-6', md: 'h-8', lg: 'h-12' } as const;
  const text = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' } as const;

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <OmnelMark className={heights[size]} />
        <span className={`font-bold tracking-tight ${text[size]}`}>
          <span className="text-fg">Omnel</span>
          <span className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 bg-clip-text text-transparent">
            OS
          </span>
        </span>
      </div>
      {showTagline ? (
        <p className="mt-2 text-xs text-fg-subtle">
          The AI Operating System for Learning
        </p>
      ) : null}
    </div>
  );
}
