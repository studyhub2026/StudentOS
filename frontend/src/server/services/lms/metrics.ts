import 'server-only';

/**
 * Lightweight, mutable collector adapters increment on every HTTP request.
 * The sync engine passes one to the adapter factory, then reads the finalised
 * counters at end-of-sync to persist onto SyncLog.
 *
 * Everything is a running sum + count; averages are derived on read. This
 * keeps the write path branch-free and avoids allocating per-request objects.
 */
export class SyncMetrics {
  requests = 0;
  totalResponseMs = 0;
  skipped = 0;
  duplicates = 0;
  deleted = 0;
  failed = 0;

  /** Record one completed HTTP request and its duration. */
  recordRequest(durationMs: number): void {
    this.requests++;
    this.totalResponseMs += durationMs;
  }

  incSkipped(n = 1): void {
    this.skipped += n;
  }
  incDuplicates(n = 1): void {
    this.duplicates += n;
  }
  incDeleted(n = 1): void {
    this.deleted += n;
  }
  incFailed(n = 1): void {
    this.failed += n;
  }

  avgResponseMs(): number {
    return this.requests > 0 ? Math.round(this.totalResponseMs / this.requests) : 0;
  }

  snapshot(): {
    apiRequestsMade: number;
    avgResponseTimeMs: number;
    skippedRecords: number;
    duplicateRecords: number;
    deletedRecords: number;
    failedRecords: number;
  } {
    return {
      apiRequestsMade: this.requests,
      avgResponseTimeMs: this.avgResponseMs(),
      skippedRecords: this.skipped,
      duplicateRecords: this.duplicates,
      deletedRecords: this.deleted,
      failedRecords: this.failed,
    };
  }
}

/**
 * Wraps a fetch call to record its duration onto the metrics collector.
 * Adapters that already have their own fetchWithBackoff loops can wrap the
 * innermost fetch with this — the retry timing still counts toward
 * totalResponseMs because that's the wall time the sync actually waited on.
 */
export async function timedFetch(
  metrics: SyncMetrics | undefined,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const start = Date.now();
  try {
    return await fetch(url, init);
  } finally {
    if (metrics) metrics.recordRequest(Date.now() - start);
  }
}
