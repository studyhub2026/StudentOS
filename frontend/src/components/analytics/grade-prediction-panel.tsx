'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePredictGrades, type SubjectPrediction } from '@/hooks/use-prediction';
import { apiErrorMessage } from '@/lib/api-client';

function TrendIcon({ trend }: { trend: SubjectPrediction['trend'] }) {
  if (trend === 'improving') return <TrendingUp className="h-3.5 w-3.5 text-teal" />;
  if (trend === 'declining') return <TrendingDown className="h-3.5 w-3.5 text-danger" />;
  return <Minus className="h-3.5 w-3.5 text-fg-subtle" />;
}

export function GradePredictionPanel() {
  const predict = usePredictGrades();
  const result = predict.data;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand/12">
            <Brain className="h-5 w-5 text-brand" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">AI Grade Prediction</h2>
            <p className="text-xs text-fg-subtle">Forecast grades and weak topics from your study data</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => predict.mutate()}
          disabled={predict.isPending}
          className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-bright disabled:opacity-60"
        >
          {predict.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {result ? 'Regenerate' : 'Predict my grades'}
        </button>
      </div>

      {predict.isError ? (
        <p className="mt-4 rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger">
          {apiErrorMessage(predict.error)}
        </p>
      ) : null}

      {predict.isPending ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-fg-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing your last 30 days of study data with Gemini...
        </div>
      ) : null}

      {result ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 space-y-4"
        >
          <div className="flex flex-wrap items-center gap-4">
            {result.overallPredictedGpa != null ? (
              <div className="rounded-xl border border-border bg-surface-raised px-4 py-2">
                <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Predicted GPA</p>
                <p className="text-2xl font-bold tabular-nums">{result.overallPredictedGpa.toFixed(2)}</p>
              </div>
            ) : null}
            <p className="min-w-0 flex-1 text-sm text-fg-muted">{result.summary}</p>
          </div>

          {result.riskAlert ? (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-sm text-fg">{result.riskAlert}</p>
            </div>
          ) : null}

          {result.subjects.length > 0 ? (
            <div className="space-y-2">
              {result.subjects.map((s) => (
                <div key={s.subjectId} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <TrendIcon trend={s.trend} />
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      {s.currentAverage != null ? (
                        <span className="text-fg-subtle">now {Math.round(s.currentAverage)}%</span>
                      ) : null}
                      <span className="font-semibold tabular-nums text-brand-bright">
                        → {Math.round(s.predictedGrade)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          s.trend === 'declining' ? 'bg-danger' : s.trend === 'improving' ? 'bg-teal' : 'bg-brand',
                        )}
                        style={{ width: `${Math.min(100, s.predictedGrade)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-fg-subtle">{s.confidence}% conf.</span>
                  </div>
                  {s.weakTopics.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.weakTopics.map((t) => (
                        <span key={t} className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs text-fg-muted">{s.recommendation}</p>
                </div>
              ))}
            </div>
          ) : null}

          {result.studyRecommendations.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface-raised/50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                Study Recommendations
              </p>
              <ul className="space-y-1.5">
                {result.studyRecommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-fg">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </motion.div>
      ) : null}

      {!result && !predict.isPending ? (
        <p className="mt-4 text-sm text-fg-subtle">
          Click &ldquo;Predict my grades&rdquo; to get an AI forecast of your likely grades, weak topics, and
          personalized study recommendations based on your last 30 days.
        </p>
      ) : null}
    </div>
  );
}
