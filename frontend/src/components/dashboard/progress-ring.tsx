'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  /** CSS color for the arc. */
  color?: string;
  trackColor?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * An animated circular progress indicator. The arc sweeps in on mount, which
 * makes a static figure (a productivity score, a completion rate) feel alive.
 */
export function ProgressRing({
  value,
  size = 72,
  stroke = 7,
  color = 'var(--color-brand)',
  trackColor = 'var(--color-border)',
  children,
  className,
}: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={`relative grid place-items-center ${className ?? ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
