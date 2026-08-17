'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { cn } from '@/lib/utils';

/**
 * Drawer that lists AI-generated proposals for extending this mind map after
 * a Moodle/Canvas sync brought in new material. The student decides which
 * proposals to apply — nothing is auto-materialised.
 */

interface ProposedNode {
  clientId: string;
  type: string;
  title: string;
  content: string | null;
  parentNodeId: string | null;
}
interface ProposalChanges {
  summary: string;
  rationale: string | null;
  nodes: ProposedNode[];
  edges: { source: string; target: string }[];
}
interface Proposal {
  id: string;
  summary: string | null;
  changes: ProposalChanges;
  connectionId: string | null;
  createdAt: string;
}

export function useProposals(mapId: string) {
  return useQuery<Proposal[]>({
    queryKey: ['mind-map', mapId, 'proposals'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Proposal[]>>(
        `/mind-maps/${mapId}/proposals`,
      );
      return data.data;
    },
    // Cheap enough to poll every 2 min so a background sync's proposals
    // appear on an open editor without a refresh, but not so aggressive that
    // an idle tab hammers the endpoint.
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

export function ProposalDrawer({
  mapId,
  open,
  onClose,
}: {
  mapId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: proposals, isLoading } = useProposals(mapId);
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function apply(id: string) {
    setBusyId(id);
    try {
      await apiClient.post(`/mind-maps/${mapId}/proposals/${id}/apply`);
      toast.success('Applied — new nodes added to the map');
      await qc.invalidateQueries({ queryKey: ['mind-map', mapId, 'proposals'] });
      await qc.invalidateQueries({ queryKey: ['mind-map', mapId] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      await apiClient.post(`/mind-maps/${mapId}/proposals/${id}/dismiss`);
      await qc.invalidateQueries({ queryKey: ['mind-map', mapId, 'proposals'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-14 z-20 flex h-[calc(100vh-3.5rem)] w-full max-w-[24rem] flex-col border-l border-border bg-[var(--color-surface)] sm:w-96">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-brand-bright" /> Sync suggestions
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-subtle hover:text-fg"
          aria-label="Close suggestions"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <p className="text-xs text-fg-subtle">Loading…</p>
        ) : !proposals || proposals.length === 0 ? (
          <p className="mt-4 text-center text-xs text-fg-subtle">
            No pending suggestions. When a linked Moodle/Canvas course brings
            new material, suggestions will appear here for you to review.
          </p>
        ) : (
          proposals.map((p) => (
            <article
              key={p.id}
              className="rounded-lg border border-border bg-surface-raised p-3 text-xs"
            >
              <p className="text-[10px] uppercase tracking-widest text-fg-subtle">
                {new Date(p.createdAt).toLocaleDateString()}
              </p>
              <p className="mt-1 font-medium text-fg">{p.summary || 'Suggested additions'}</p>
              {p.changes.rationale ? (
                <p className="mt-1 text-fg-muted">{p.changes.rationale}</p>
              ) : null}
              <ul className="mt-2 space-y-1">
                {p.changes.nodes.slice(0, 8).map((n) => (
                  <li key={n.clientId} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-fg">{n.title}</span>
                      <span className="ml-1 text-fg-subtle">({n.type})</span>
                      {n.content ? (
                        <span className="mt-0.5 block text-fg-muted">{n.content}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
                {p.changes.nodes.length > 8 ? (
                  <li className="text-fg-subtle">…and {p.changes.nodes.length - 8} more</li>
                ) : null}
              </ul>
              <div className="mt-2 flex gap-1">
                <Button
                  size="sm"
                  onClick={() => void apply(p.id)}
                  disabled={busyId === p.id}
                  className="flex-1"
                >
                  {busyId === p.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void dismiss(p.id)}
                  disabled={busyId === p.id}
                >
                  Dismiss
                </Button>
              </div>
            </article>
          ))
        )}
      </div>

      <p className="border-t border-border px-3 py-2 text-[10px] text-fg-subtle">
        Suggestions never modify your map until you click Apply.
      </p>
    </aside>
  );
}

/** Compact badge with the pending count — clip on the editor toolbar. */
export function ProposalBadge({
  mapId,
  onOpen,
}: {
  mapId: string;
  onOpen: () => void;
}) {
  const { data } = useProposals(mapId);
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand-bright transition-colors hover:bg-brand/20',
      )}
      title="Review sync suggestions"
    >
      <Sparkles className="h-3 w-3" />
      {count} suggestion{count === 1 ? '' : 's'}
    </button>
  );
}
