'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

/**
 * Editor page — React Flow + @xyflow/react is ~130 KB gzip and only needed
 * when the user opens a specific mind map. Dynamic-import keeps that weight
 * off the /mind-map list page and off every other page under (app), and
 * defers evaluation until this route is actually rendered. SSR is disabled
 * because ReactFlow reaches into the DOM on mount.
 */
const MindMapEditor = dynamic(
  () => import('@/components/mind-map/mind-map-editor').then((m) => m.MindMapEditor),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full w-full place-items-center text-fg-muted">
        <span className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading editor…
        </span>
      </div>
    ),
  },
);

export default function MindMapEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="fixed inset-0 top-0 flex flex-col lg:left-60">
      <div className="h-14 lg:h-0" aria-hidden />
      <div className="flex min-h-0 flex-1">
        <MindMapEditor mapId={id} />
      </div>
    </div>
  );
}
