'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Loader2, Mic, MicOff, Square, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api-client';
import { postSse } from '@/lib/sse';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

// ---- Web Speech API typings ---------------------------------------------
// The Web Speech API isn't in lib.dom.d.ts yet, so we declare the minimum
// surface we use here rather than pulling in an ambient module.
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Splits an accumulating stream into speakable sentence chunks. Returns the
 * complete sentences ready to speak now, plus the remaining tail buffer that
 * hasn't reached a boundary yet. Boundaries: . ! ? ؟ ۔ and Arabic full stop.
 * Kept tiny + regex-free so it runs cheaply on every token.
 */
function extractSentences(buffer: string): { spoken: string[]; rest: string } {
  const spoken: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '؟' || ch === '۔' || ch === '\n') {
      // Require at least ~12 chars in the sentence so "Dr." / "e.g." don't
      // chop mid-word. Small enough to still feel live.
      if (i - start >= 12) {
        spoken.push(buffer.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return { spoken, rest: buffer.slice(start) };
}

export default function AiVoicePage() {
  const t = useT();
  const [supported, setSupported] = useState<boolean>(true);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceName, setVoiceName] = useState<string>('');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [transcript, setTranscript] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const conversationId = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [level, setLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef('');

  // Voice list is loaded async in Chrome, populated only after voiceschanged.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setAvailableVoices(list);
      if (!voiceName && list.length > 0) {
        // Prefer an English female voice by name heuristic — falls back to first.
        const pick =
          list.find((v) => /en(-|_)?/i.test(v.lang) && /female|samantha|zira/i.test(v.name)) ??
          list.find((v) => /en(-|_)?/i.test(v.lang)) ??
          list[0]!;
        setVoiceName(pick.name);
      }
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [voiceName]);

  // Feature-detect speech recognition once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ctor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;
    setSupported(Boolean(ctor));
  }, []);

  // Stop everything on unmount so the mic and TTS release cleanly.
  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const speak = useCallback(
    (text: string) => {
      if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = availableVoices.find((v) => v.name === voiceName);
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.pitch = 1;
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [availableVoices, muted, voiceName],
  );

  // Cancels the current stream — user can barge in mid-reply.
  const streamAbortRef = useRef<AbortController | null>(null);

  /**
   * Streams the reply through the same SSE endpoint the /ai page uses, so it
   * benefits from every existing improvement (provider abstraction, runtime
   * fallback, AI context injection, memory, files). Speaks sentence-by-
   * sentence as they arrive — feels like a real conversation instead of
   * a monologue after a long pause.
   *
   * Honours the same `omnel:ai-provider` localStorage key set by the /ai
   * page's Model dropdown, so switching the model there also switches it
   * here.
   */
  const sendToAi = useCallback(
    async (content: string) => {
      setThinking(true);
      // Cancel any prior in-flight stream (defensive; barge-in also cancels).
      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;

      // Read the persisted provider from the chat page — falls back to Auto.
      const savedProvider =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('omnel:ai-provider')
          : null;
      const provider =
        savedProvider === 'gemini' || savedProvider === 'deepseek' ? savedProvider : undefined;

      let accumulated = '';
      let pendingTail = '';
      // Placeholder assistant turn so the transcript shows something growing.
      setTurns((prev) => [...prev, { role: 'assistant', text: '' }]);

      const patchLast = (text: string) => {
        setTurns((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, text }];
        });
      };

      try {
        const generator = postSse(
          '/api/v1/ai/chat/stream',
          {
            feature: 'CHAT',
            content,
            ...(conversationId.current ? { conversationId: conversationId.current } : {}),
            ...(provider ? { provider } : {}),
          },
          controller.signal,
        );

        for await (const frame of generator) {
          if (frame.event === 'meta') {
            const meta = JSON.parse(frame.data) as { conversationId: string };
            conversationId.current = meta.conversationId;
          } else if (frame.event === 'delta') {
            const delta = JSON.parse(frame.data) as string;
            accumulated += delta;
            pendingTail += delta;
            patchLast(accumulated);
            // Flush any complete sentences into the TTS queue.
            const { spoken, rest } = extractSentences(pendingTail);
            pendingTail = rest;
            for (const sentence of spoken) speak(sentence);
          } else if (frame.event === 'error') {
            const err = JSON.parse(frame.data) as { message: string };
            throw new Error(err.message);
          }
        }
        // Speak whatever tail is left (short trailing fragment or reply
        // without a terminating punctuation).
        const tail = pendingTail.trim();
        if (tail.length > 0) speak(tail);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        toast.error(apiErrorMessage(error));
      } finally {
        setThinking(false);
      }
    },
    [speak],
  );

  const startLevelMeter = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        setLevel(sum / data.length / 255);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* mic denied — that's OK, we still let recognition run without a visualiser */
    }
  }, []);

  const stopLevelMeter = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(() => {
    if (!supported || listening) return;
    // If the AI is mid-reply, interrupt cleanly so the user can barge in:
    // cancel the queued TTS AND abort the in-flight stream so tokens stop
    // arriving. Otherwise the user's new question would collide with the
    // tail of the previous answer.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    const ctor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;
    if (!ctor) return;
    const rec = new ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    finalTranscriptRef.current = '';
    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) final += alt.transcript;
        else interim += alt.transcript;
      }
      if (final) finalTranscriptRef.current += final;
      setTranscript(finalTranscriptRef.current + interim);
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') toast.error(`Voice: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      stopLevelMeter();
      const text = finalTranscriptRef.current.trim();
      if (text) {
        setTurns((prev) => [...prev, { role: 'user', text }]);
        setTranscript('');
        void sendToAi(text);
      }
    };
    recognitionRef.current = rec;
    setListening(true);
    void startLevelMeter();
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [listening, sendToAi, startLevelMeter, stopLevelMeter, supported]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const isTalking = thinking;

  const bars = useMemo(() => Array.from({ length: 24 }), []);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href="/ai"
          className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('voice.backToChat')}
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="rounded-lg border border-border bg-surface-raised p-2 text-fg-muted hover:text-fg"
            aria-label={muted ? 'Unmute assistant voice' : 'Mute assistant voice'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <select
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            className="max-w-[180px] rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs"
            aria-label="Assistant voice"
          >
            {availableVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </div>
      </header>

      <h1 className="text-2xl font-semibold tracking-tight">{t('voice.title')}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {t('voice.subtitle')}
      </p>

      {!supported ? (
        <Card className="mt-6 border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          {t('voice.unsupported')}
        </Card>
      ) : null}

      <Card className="mt-6 flex flex-col items-center gap-6 p-8">
        {/* Waveform */}
        <div className="flex h-24 items-end gap-1">
          {bars.map((_, i) => (
            <motion.span
              key={i}
              animate={{
                height: listening
                  ? `${20 + Math.abs(Math.sin(i * 0.4 + level * 6)) * 60 * (0.4 + level * 2)}%`
                  : isTalking
                  ? `${30 + Math.abs(Math.sin(Date.now() / 200 + i)) * 40}%`
                  : '10%',
              }}
              transition={{ duration: 0.15 }}
              className={cn(
                'w-1.5 rounded-full',
                listening ? 'bg-brand' : isTalking ? 'bg-accent' : 'bg-border',
              )}
              style={{ minHeight: 4 }}
            />
          ))}
        </div>

        {/* Live transcript */}
        <p className="min-h-[2.5rem] max-w-md text-center text-sm text-fg-muted">
          {listening
            ? transcript || t('voice.listening')
            : thinking
            ? t('voice.thinking')
            : t('voice.tapHint')}
        </p>

        {/* Mic button */}
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={!supported || thinking}
          className={cn(
            'grid h-20 w-20 place-items-center rounded-full text-white shadow-xl transition-transform hover:scale-105 disabled:opacity-50',
            listening ? 'bg-danger' : 'bg-brand',
          )}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
        >
          {thinking ? (
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          ) : listening ? (
            <Square className="h-7 w-7" aria-hidden />
          ) : supported ? (
            <Mic className="h-8 w-8" aria-hidden />
          ) : (
            <MicOff className="h-8 w-8" aria-hidden />
          )}
        </button>
      </Card>

      {/* Transcript history */}
      <section className="mt-6 flex-1">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
          {t('voice.conversation')}
        </h2>
        {turns.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('voice.nothingYet')}</p>
        ) : (
          <ol className="space-y-3">
            <AnimatePresence initial={false}>
              {turns.map((turn, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2 text-sm',
                    turn.role === 'user'
                      ? 'ml-auto bg-brand/12 text-brand-bright'
                      : 'bg-surface-raised text-fg',
                  )}
                >
                  {turn.text}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </section>
    </div>
  );
}
