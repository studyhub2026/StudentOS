'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { useMindMapEditor } from '@/stores/mind-map-editor-store';

const DEBOUNCE_MS = 1200;

/**
 * Debounced auto-save for the mind-map editor.
 *
 * Watches the editor store's `dirty` set and, whenever it becomes non-empty
 * and quiet for DEBOUNCE_MS, PATCHes only the changed slice to the server.
 * A save in flight blocks a second save from starting so the server never
 * sees two overlapping writes for the same map.
 *
 * Uses store subscriptions rather than a React effect so drag events don't
 * trigger a full re-render each frame.
 */
export function useMindMapAutoSave(mapId: string | null) {
  const queryClient = useQueryClient();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!mapId) return;

    async function flush() {
      if (!mapId) return;
      if (inFlightRef.current) {
        // Save arrived while we were already saving — remember to run again
        // after the current one finishes rather than starting a parallel PATCH.
        pendingRef.current = true;
        return;
      }
      const { payload, hadChanges } = useMindMapEditor.getState().buildPayload();
      if (!hadChanges) return;

      inFlightRef.current = true;
      useMindMapEditor.getState().markSaving();
      try {
        await apiClient.patch(`/mind-maps/${mapId}`, payload);
        useMindMapEditor.getState().markSaved(new Date());
        void queryClient.invalidateQueries({ queryKey: ['mind-maps'] });
      } catch (err) {
        useMindMapEditor.getState().markError(apiErrorMessage(err));
      } finally {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          // A change came in mid-flight; save the delta immediately.
          void flush();
        }
      }
    }

    // Subscribe to any editor state change; check whether the dirty set is
    // non-empty before starting the debounce. Cheap: the subscription is
    // O(1) and the comparison below short-circuits.
    const unsub = useMindMapEditor.subscribe((state, prev) => {
      const dirty =
        state.dirty.changedNodeIds.size +
          state.dirty.changedEdgeIds.size +
          state.dirty.deletedNodeIds.size +
          state.dirty.deletedEdgeIds.size +
          (state.dirty.metaDirty ? 1 : 0) >
        0;
      const prevDirty =
        prev.dirty.changedNodeIds.size +
          prev.dirty.changedEdgeIds.size +
          prev.dirty.deletedNodeIds.size +
          prev.dirty.deletedEdgeIds.size +
          (prev.dirty.metaDirty ? 1 : 0) >
        0;
      if (!dirty) return;
      // Reset the debounce clock on every dirty change so a burst of drags
      // collapses into one save.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
      // Cross-reference to satisfy the linter (we intentionally read prev).
      void prevDirty;
    });

    // Warn before leaving if there are unsaved changes.
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const s = useMindMapEditor.getState();
      const dirty =
        s.dirty.changedNodeIds.size +
          s.dirty.changedEdgeIds.size +
          s.dirty.deletedNodeIds.size +
          s.dirty.deletedEdgeIds.size +
          (s.dirty.metaDirty ? 1 : 0) >
        0;
      if (dirty || s.saveStatus === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      unsub();
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      // Best-effort flush on unmount — errors are swallowed since the
      // component is going away.
      void flush();
    };
  }, [mapId, queryClient]);

  return null;
}

/** Manual save (Ctrl+S). Skips the debounce and pushes immediately. */
export async function saveMindMapNow(mapId: string) {
  const { payload, hadChanges } = useMindMapEditor.getState().buildPayload();
  if (!hadChanges) return;
  useMindMapEditor.getState().markSaving();
  try {
    await apiClient.patch(`/mind-maps/${mapId}`, payload);
    useMindMapEditor.getState().markSaved(new Date());
  } catch (err) {
    useMindMapEditor.getState().markError(apiErrorMessage(err));
  }
}
