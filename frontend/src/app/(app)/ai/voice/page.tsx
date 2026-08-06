'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Loader2, Mic, MicOff, Square, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
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

interface ChatMessageResult {
  conversationId: string;
  message: { id: string; role: 'USER' | 'ASSISTANT'; content: string };
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

  const sendToGemini = useCallback(
    async (content: string) => {
      setThinking(true);
      try {
        const { data } = await apiClient.post<ApiEnvelope<ChatMessageResult>>('/ai/chat', {
          content,
          feature: 'CHAT',
          ...(conversationId.current ? { conversationId: conversationId.current } : {}),
        });
        conversationId.current = data.data.conversationId;
        const reply = data.data.message.content;
        setTurns((prev) => [...prev, { role: 'assistant', text: reply }]);
        speak(reply);
      } catch (error) {
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
    // If Gemini is mid-reply, interrupt cleanly so the user can barge in.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
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
        void sendToGemini(text);
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
  }, [listening, sendToGemini, startLevelMeter, stopLevelMeter, supported]);

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
