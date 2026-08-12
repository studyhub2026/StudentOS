'use client';

import { use } from 'react';
import { MindMapEditor } from '@/components/mind-map/mind-map-editor';

/**
 * The editor page renders full-height (bypasses the default `<main>` padding
 * from AppLayout by using a negative-margin fixed shell). React Flow needs
 * an explicit height so we take up the full viewport minus the top header.
 */
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
