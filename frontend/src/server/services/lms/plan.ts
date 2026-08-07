import 'server-only';

/**
 * Shape of the plan produced by a dry-run sync. Populated by the sync engine
 * as it walks the remote data; consumed by the /preview UI to show the user
 * what would happen if they hit Approve.
 *
 * Kept intentionally small: only ids + a short label per record, so a plan
 * for a whole institution's worth of data still fits in a Postgres jsonb
 * cell without needing to page.
 */

export type EntityKind = 'courses' | 'assignments' | 'exams' | 'announcements' | 'grades' | 'files';

export interface PlanSample {
  externalId: string;
  label: string;
  courseName?: string;
}

export interface EntityPlan {
  new: PlanSample[];
  updated: PlanSample[];
  deleted: PlanSample[];
  duplicate: PlanSample[];
}

export type SyncPlan = Record<EntityKind, EntityPlan>;

export interface PlanEstimates {
  durationSec: number;
  aiCostUsd: number;
  storageMb: number;
  records: number;
}

export function emptyEntityPlan(): EntityPlan {
  return { new: [], updated: [], deleted: [], duplicate: [] };
}

export function emptySyncPlan(): SyncPlan {
  return {
    courses: emptyEntityPlan(),
    assignments: emptyEntityPlan(),
    exams: emptyEntityPlan(),
    announcements: emptyEntityPlan(),
    grades: emptyEntityPlan(),
    files: emptyEntityPlan(),
  };
}

/** Counts every planned mutation across all entity kinds. */
export function planTotals(plan: SyncPlan): {
  new: number;
  updated: number;
  deleted: number;
  duplicate: number;
  total: number;
} {
  let n = 0, u = 0, d = 0, dup = 0;
  for (const kind of Object.keys(plan) as EntityKind[]) {
    n += plan[kind].new.length;
    u += plan[kind].updated.length;
    d += plan[kind].deleted.length;
    dup += plan[kind].duplicate.length;
  }
  return { new: n, updated: u, deleted: d, duplicate: dup, total: n + u + d + dup };
}

/**
 * Rough cost/duration/storage extrapolation from the plan. Adapters supply
 * exact byte counts for files; other estimates are heuristic averages tuned
 * from Phase 1/2 real-world traces.
 *
 * - Duration: 40ms per API call + 15ms per record write, plus 200ms per file
 *   for the Knowledge Base extraction round-trip.
 * - AI cost: only new files are OCR'd through Gemini. A conservative
 *   $0.00035 per file (average of PDF + image inputs at 2025 Gemini pricing).
 * - Storage: sum of file bytes → MB. Non-file rows are tiny and rounded out.
 */
export function estimatePlanCost(plan: SyncPlan, fileBytes: number[] = []): PlanEstimates {
  const totals = planTotals(plan);
  const newFiles = plan.files.new.length;
  const totalBytes = fileBytes.reduce((s, b) => s + b, 0);

  const durationSec = Math.max(
    1,
    Math.round((totals.total * 55) / 1000 + newFiles * 0.2),
  );
  const aiCostUsd = Number((newFiles * 0.00035).toFixed(4));
  const storageMb = Number((totalBytes / (1024 * 1024)).toFixed(2));

  return {
    durationSec,
    aiCostUsd,
    storageMb,
    records: totals.total,
  };
}

/** Caps a sample list so a huge institution's plan doesn't bloat the row. */
export function pushSample(bucket: PlanSample[], sample: PlanSample, cap = 50): void {
  if (bucket.length < cap) bucket.push(sample);
}
