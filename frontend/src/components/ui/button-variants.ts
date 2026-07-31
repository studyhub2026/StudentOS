import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The button's style variants, kept in a plain (non-`'use client'`) module so
 * Server Components — e.g. not-found.tsx — can style a `<Link>` like a button
 * without pulling in the client boundary.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] whitespace-nowrap',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-br from-brand to-accent text-white shadow-[0_6px_20px_-8px_var(--color-brand)] hover:brightness-110',
        secondary:
          'bg-surface-raised text-fg border border-border hover:border-border-strong hover:bg-surface',
        ghost: 'text-fg-muted hover:bg-surface-raised hover:text-fg',
        danger: 'bg-danger/15 text-danger border border-danger/25 hover:bg-danger/25',
        outline: 'border border-border-strong text-fg hover:bg-surface-raised',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
