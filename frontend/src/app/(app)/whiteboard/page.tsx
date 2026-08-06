'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Circle,
  Download,
  Eraser,
  FileText,
  Layers,
  Loader2,
  Palette,
  Pen,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

type Tool = 'pen' | 'eraser';
type Intent = 'notes' | 'quiz' | 'explain';

interface Stroke {
  color: string;
  size: number;
  tool: Tool;
  points: { x: number; y: number }[];
}

const COLORS = ['#e5e7eb', '#f97316', '#22c55e', '#38bdf8', '#a855f7', '#ef4444'];
const SIZES = [2, 4, 6, 10];

/**
 * A minimal infinite-ish whiteboard: strokes are stored client-side in a
 * ref so drawing stays smooth (no per-point React state), and the canvas
 * is rasterised for Gemini via toDataURL when the student asks the AI to
 * interpret their drawing.
 */
export default function WhiteboardPage() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>('#e5e7eb');
  const [size, setSize] = useState<number>(4);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [intent, setIntent] = useState<Intent>('explain');
  const [aiResult, setAiResult] = useState<string | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      // Re-scale existing strokes onto the fresh backing store.
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redraw]);

  const point = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = {
      color,
      size,
      tool,
      points: [point(e)],
    };
    currentRef.current = stroke;
    strokesRef.current.push(stroke);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = currentRef.current;
    if (!stroke) return;
    stroke.points.push(point(e));
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    // Draw only the newest segment for perf — no need to redraw everything.
    const last = stroke.points[stroke.points.length - 2];
    const now = stroke.points[stroke.points.length - 1]!;
    ctx.strokeStyle = stroke.tool === 'eraser' ? '#0a0a0a' : stroke.color;
    ctx.lineWidth = stroke.tool === 'eraser' ? stroke.size * 4 : stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last?.x ?? now.x, last?.y ?? now.y);
    ctx.lineTo(now.x, now.y);
    ctx.stroke();
  }
  function onPointerUp() {
    currentRef.current = null;
  }

  function clearBoard() {
    strokesRef.current = [];
    redraw();
    setAiResult(null);
  }
  function undo() {
    strokesRef.current.pop();
    redraw();
  }
  function exportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }

  async function askAi() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setAiPending(true);
    setAiResult(null);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1] ?? '';
      const { data } = await apiClient.post<ApiEnvelope<{ result: string }>>(
        '/ai/whiteboard',
        { intent, imageBase64: base64 },
      );
      setAiResult(data.data.result);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setAiPending(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('whiteboard.title')}</h1>
          <p className="text-sm text-fg-muted">
            {t('whiteboard.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Tools */}
          <ToolChip active={tool === 'pen'} onClick={() => setTool('pen')} title={t('whiteboard.tool.pen')}>
            <Pen className="h-4 w-4" />
          </ToolChip>
          <ToolChip active={tool === 'eraser'} onClick={() => setTool('eraser')} title={t('whiteboard.tool.eraser')}>
            <Eraser className="h-4 w-4" />
          </ToolChip>

          {/* Colours */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1">
            <Palette className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
                  color === c ? 'border-white' : 'border-transparent',
                )}
                style={{ background: c }}
              />
            ))}
          </div>

          {/* Sizes */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1">
            <Circle className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Size ${s}`}
                onClick={() => setSize(s)}
                className={cn(
                  'grid h-6 w-6 place-items-center rounded transition-colors',
                  size === s ? 'bg-brand text-white' : 'text-fg-muted hover:bg-surface',
                )}
              >
                <span
                  className="block rounded-full bg-current"
                  style={{ width: s + 2, height: s + 2 }}
                />
              </button>
            ))}
          </div>

          <Button variant="ghost" onClick={undo} aria-label={t('whiteboard.undo')}>
            {t('whiteboard.undo')}
          </Button>
          <Button variant="ghost" onClick={clearBoard} aria-label={t('whiteboard.clear')}>
            <Trash2 className="h-4 w-4" /> {t('whiteboard.clear')}
          </Button>
          <Button variant="ghost" onClick={exportPng}>
            <Download className="h-4 w-4" /> {t('whiteboard.export')}
          </Button>
          <Button onClick={() => setAiOpen((o) => !o)}>
            <Sparkles className="h-4 w-4" /> {t('whiteboard.askAi')}
          </Button>
        </div>
      </header>

      <div ref={wrapRef} className="relative flex-1 overflow-hidden rounded-2xl border border-border bg-[#0a0a0a]">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {aiOpen ? (
          <Card className="absolute right-4 top-4 w-80 space-y-3 border-border bg-surface p-4 shadow-xl">
            <CardHeader className="p-0">
              <CardTitle>
                <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden /> {t('whiteboard.interpretTitle')}
              </CardTitle>
            </CardHeader>
            <div className="grid grid-cols-3 gap-2">
              <IntentChip active={intent === 'explain'} onClick={() => setIntent('explain')}>
                <BookOpen className="h-3.5 w-3.5" /> {t('whiteboard.intent.explain')}
              </IntentChip>
              <IntentChip active={intent === 'notes'} onClick={() => setIntent('notes')}>
                <Layers className="h-3.5 w-3.5" /> {t('whiteboard.intent.notes')}
              </IntentChip>
              <IntentChip active={intent === 'quiz'} onClick={() => setIntent('quiz')}>
                <FileText className="h-3.5 w-3.5" /> {t('whiteboard.intent.quiz')}
              </IntentChip>
            </div>
            <Button
              className="w-full"
              onClick={() => void askAi()}
              disabled={aiPending || strokesRef.current.length === 0}
            >
              {aiPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('whiteboard.reading')}
                </>
              ) : (
                t('whiteboard.send')
              )}
            </Button>
            {aiResult ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-raised p-3 text-xs text-fg">
                <pre className="whitespace-pre-wrap font-sans">{aiResult}</pre>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function ToolChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg border transition-colors',
        active
          ? 'border-brand bg-brand/12 text-brand-bright'
          : 'border-border bg-surface-raised text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function IntentChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand bg-brand/12 text-brand-bright'
          : 'border-border bg-surface-raised text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
) {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#0a0a0a' : stroke.color;
  ctx.lineWidth = stroke.tool === 'eraser' ? stroke.size * 4 : stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i]!.x, stroke.points[i]!.y);
  }
  ctx.stroke();
}
