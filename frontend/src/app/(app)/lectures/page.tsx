'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Clock, FileAudio, Headphones, Loader2, Mic, Pause, Play, Square,
  Sparkles, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { useSubjects } from '@/hooks/use-dashboard';

/**
 * Lecture recorder page.
 *
 * The student records (or uploads) a lecture; the server runs Groq Whisper
 * for the transcript and then an AI pass that turns it into a titled note
 * plus a seeded flashcard deck. Everything on-page runs through the native
 * MediaRecorder API — no SDKs or wasm.
 *
 * UX stages: idle → recording (with timer) → review → uploading → done.
 */

type Stage = 'idle' | 'recording' | 'paused' | 'review' | 'processing' | 'done';

interface Result {
  noteId: string;
  deckId: string | null;
  title: string;
  cardCount: number;
  summary: string;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LecturesPage() {
  const router = useRouter();
  const { data: subjects } = useSubjects();

  const [stage, setStage] = useState<Stage>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [titleHint, setTitleHint] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [processingMessage, setProcessingMessage] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const pausedAccumRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick the timer while recording.
  useEffect(() => {
    if (stage === 'recording') {
      timerRef.current = setInterval(() => {
        const now = Date.now();
        setElapsed(Math.floor((now - startedAtRef.current - pausedAccumRef.current) / 1000));
      }, 250);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stage]);

  // Release object URL + mic on unmount or when a new blob is set.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [blobUrl]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Try opus — the common supported format across modern browsers.
      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        '',
      ];
      const mime = mimeCandidates.find((m) => (m ? MediaRecorder.isTypeSupported(m) : true)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = chunksRef.current[0]?.type || 'audio/webm';
        const merged = new Blob(chunksRef.current, { type });
        setBlob(merged);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        setBlobUrl(URL.createObjectURL(merged));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStage('review');
      };
      recorder.start(1_000);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      pausedAccumRef.current = 0;
      setElapsed(0);
      setBlob(null);
      setResult(null);
      setStage('recording');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not access the microphone.');
    }
  }, [blobUrl]);

  const pauseResume = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state === 'recording') {
      r.pause();
      pausedAccumRef.current -= Date.now();
      setStage('paused');
    } else if (r.state === 'paused') {
      r.resume();
      pausedAccumRef.current += Date.now();
      setStage('recording');
    }
  }, []);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state === 'inactive') return;
    if (r.state === 'paused') pausedAccumRef.current += Date.now();
    r.stop();
  }, []);

  const discard = useCallback(() => {
    setBlob(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setElapsed(0);
    setResult(null);
    setStage('idle');
  }, [blobUrl]);

  const chooseFile = useCallback((file: File) => {
    setBlob(file);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(URL.createObjectURL(file));
    setElapsed(0);
    setResult(null);
    setStage('review');
  }, [blobUrl]);

  const submit = useCallback(async () => {
    if (!blob) return;
    setStage('processing');
    setProcessingMessage('Uploading audio…');
    const form = new FormData();
    const name = (blob as File).name || `lecture-${Date.now()}.webm`;
    form.append('audio', blob, name);
    if (subjectId) form.append('subjectId', subjectId);
    if (titleHint.trim()) form.append('titleHint', titleHint.trim());
    if (elapsed > 0) form.append('durationSec', String(elapsed));
    setProcessingMessage('Transcribing with Whisper…');
    try {
      const { data } = await apiClient.post<{ data: Result }>('/lectures/record', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      setProcessingMessage('Building notes & flashcards…');
      setResult(data.data);
      setStage('done');
      toast.success('Lecture processed');
    } catch (err) {
      setStage('review');
      toast.error(apiErrorMessage(err));
    }
  }, [blob, subjectId, titleHint, elapsed]);

  const bytesLabel = useMemo(() => (blob ? fmtBytes(blob.size) : ''), [blob]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Headphones className="h-5 w-5 text-brand-bright" aria-hidden />
          Lectures
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Record a lecture and OmnelOS turns it into a titled note and a flashcard deck for you.
        </p>
      </header>

      {stage === 'idle' ? (
        <IdleCard
          onRecord={startRecording}
          onFile={chooseFile}
        />
      ) : null}

      {stage === 'recording' || stage === 'paused' ? (
        <RecordingCard
          elapsed={elapsed}
          paused={stage === 'paused'}
          onPauseResume={pauseResume}
          onStop={stopRecording}
        />
      ) : null}

      {stage === 'review' && blob ? (
        <ReviewCard
          blobUrl={blobUrl}
          bytesLabel={bytesLabel}
          elapsed={elapsed}
          titleHint={titleHint}
          onTitleHint={setTitleHint}
          subjectId={subjectId}
          onSubjectId={setSubjectId}
          subjects={subjects ?? []}
          onDiscard={discard}
          onSubmit={submit}
        />
      ) : null}

      {stage === 'processing' ? (
        <ProcessingCard message={processingMessage} />
      ) : null}

      {stage === 'done' && result ? (
        <DoneCard
          result={result}
          onNewLecture={discard}
          onOpenNote={() => router.push(`/notes?open=${result.noteId}`)}
          onOpenDeck={() => result.deckId && router.push(`/flashcards/${result.deckId}`)}
        />
      ) : null}
    </div>
  );
}

function IdleCard({
  onRecord,
  onFile,
}: {
  onRecord: () => void;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border bg-surface-raised/40 p-6">
      <div className="flex flex-col items-center gap-5 text-center">
        <button
          type="button"
          onClick={onRecord}
          className="group flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-bright text-white shadow-lg transition-transform hover:scale-105"
          aria-label="Start recording"
        >
          <Mic className="h-10 w-10" />
        </button>
        <div>
          <p className="text-sm font-medium">Press to start recording</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Keep the microphone close. 25 MB max per recording (~45 minutes).
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <span className="h-px w-10 bg-border" />
          or
          <span className="h-px w-10 bg-border" />
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-raised"
        >
          <Upload className="h-4 w-4" /> Upload an audio file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}

function RecordingCard({
  elapsed,
  paused,
  onPauseResume,
  onStop,
}: {
  elapsed: number;
  paused: boolean;
  onPauseResume: () => void;
  onStop: () => void;
}) {
  return (
    <div className="rounded-xl border border-brand/40 bg-gradient-to-br from-brand/5 to-transparent p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative">
          <div
            className={`h-20 w-20 rounded-full bg-red-500/15 ${paused ? '' : 'animate-pulse'}`}
          />
          <Mic className="absolute inset-0 m-auto h-8 w-8 text-red-400" />
        </div>
        <p className="font-mono text-3xl tabular-nums">{fmtTime(elapsed)}</p>
        <p className="text-xs text-fg-subtle">
          {paused ? 'Paused — press play to continue' : 'Recording in progress'}
        </p>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={onPauseResume}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-raised"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-2 rounded-lg bg-red-500/15 border border-red-500/40 px-4 py-2 text-sm text-red-400 hover:bg-red-500/25"
          >
            <Square className="h-4 w-4 fill-current" /> Stop
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewCard({
  blobUrl, bytesLabel, elapsed, titleHint, onTitleHint, subjectId, onSubjectId, subjects, onDiscard, onSubmit,
}: {
  blobUrl: string | null;
  bytesLabel: string;
  elapsed: number;
  titleHint: string;
  onTitleHint: (v: string) => void;
  subjectId: string;
  onSubjectId: (v: string) => void;
  subjects: { id: string; name: string }[];
  onDiscard: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised/40 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileAudio className="h-5 w-5 text-brand-bright" />
          <div>
            <p className="text-sm font-medium">Ready to process</p>
            <p className="text-xs text-fg-subtle">
              {bytesLabel}
              {elapsed > 0 ? ` · ${fmtTime(elapsed)}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg p-2 text-fg-muted hover:bg-red-500/15 hover:text-red-400"
          title="Discard"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {blobUrl ? <audio controls src={blobUrl} className="w-full" /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-fg-muted">Title (optional)</label>
          <input
            value={titleHint}
            onChange={(e) => onTitleHint(e.target.value)}
            placeholder="Introduction to Data Structures"
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs text-fg-muted">Subject (optional)</label>
          <select
            value={subjectId}
            onChange={(e) => onSubjectId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">— None —</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 font-medium text-white hover:bg-brand-bright"
      >
        <Sparkles className="h-4 w-4" /> Process lecture
      </button>
    </div>
  );
}

function ProcessingCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised/40 p-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-brand-bright" />
        <p className="text-sm font-medium">{message || 'Processing…'}</p>
        <p className="text-xs text-fg-subtle">
          Groq is transcribing the audio and the AI is drafting your notes.
        </p>
      </div>
    </div>
  );
}

function DoneCard({
  result,
  onNewLecture,
  onOpenNote,
  onOpenDeck,
}: {
  result: Result;
  onNewLecture: () => void;
  onOpenNote: () => void;
  onOpenDeck: () => void;
}) {
  return (
    <div className="rounded-xl border border-brand/40 bg-gradient-to-br from-brand/10 to-transparent p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-brand/20 p-2 text-brand-bright">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">{result.title}</p>
          <p className="mt-1 text-sm text-fg-muted">{result.summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <Clock className="h-3 w-3" />
        {result.cardCount > 0
          ? `Note + ${result.cardCount} flashcard${result.cardCount === 1 ? '' : 's'} created`
          : 'Note created'}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenNote}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-bright"
        >
          Open note
        </button>
        {result.deckId ? (
          <button
            type="button"
            onClick={onOpenDeck}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-raised"
          >
            Open flashcards
          </button>
        ) : null}
        <button
          type="button"
          onClick={onNewLecture}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-raised"
        >
          <Mic className="h-4 w-4" /> New lecture
        </button>
      </div>
    </div>
  );
}
