'use client';

import { useEffect, useRef } from 'react';

interface Props {
  /** Increment this number to fire a new burst. */
  trigger: number;
  /** Number of particles per burst. */
  count?: number;
  /** Colours picked from cyclically. */
  colors?: string[];
}

/**
 * Lightweight canvas confetti. No dependency, no ongoing render loop when
 * idle — the animation only runs while particles exist. Sized to the
 * viewport so bursts always cover the visible area.
 */
export function ConfettiBurst({ trigger, count = 90, colors }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastTrigger = useRef(trigger);

  useEffect(() => {
    if (trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const palette = colors ?? ['#6366f1', '#22c55e', '#f97316', '#eab308', '#ec4899', '#0ea5e9'];
    const particles = Array.from({ length: count }).map(() => ({
      x: width / 2,
      y: height / 3,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 12 - 3,
      size: Math.random() * 6 + 4,
      rotation: Math.random() * Math.PI,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      color: palette[Math.floor(Math.random() * palette.length)]!,
      life: 90 + Math.random() * 40,
    }));

    let frame = 0;
    const step = () => {
      frame += 1;
      ctx.clearRect(0, 0, width, height);
      let alive = 0;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive += 1;
        p.vy += 0.35; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.life -= 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 30));
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (alive > 0 && frame < 260) {
        requestAnimationFrame(step);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };
    requestAnimationFrame(step);
  }, [trigger, count, colors]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[95]"
      aria-hidden
    />
  );
}
