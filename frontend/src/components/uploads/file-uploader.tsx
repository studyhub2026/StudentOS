'use client';

import { useRef } from 'react';
import { AlertTriangle, FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useAvatarUpload,
  useDeleteFile,
  useDropzone,
  useFileUpload,
  useUploadStatus,
  type UploadTarget,
} from '@/hooks/use-upload';
import { cn } from '@/lib/utils';
import type { Attachment, UploadFolder } from '@/types/api';

interface FileUploaderProps {
  folder: UploadFolder;
  target?: UploadTarget;
  attachments?: Attachment[];
  label?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileUploader({
  folder,
  target = {},
  attachments = [],
  label = 'Attachments',
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: status } = useUploadStatus();
  const upload = useFileUpload(folder, target);
  const remove = useDeleteFile();

  const { dragging, onDragOver, onDragLeave, onDrop } = useDropzone((file) =>
    upload.mutate(file),
  );

  // Uploads are unavailable rather than broken when Cloudinary is unconfigured
  // — say so plainly instead of showing a control that always fails.
  if (status && !status.configured) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          File uploads are not configured
        </p>
        <p className="mt-1 text-fg-muted">
          The server needs Cloudinary credentials before attachments can be uploaded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-fg-muted">{label}</p>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragging ? 'border-brand bg-brand/8' : 'border-border',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = '';
          }}
        />

        {upload.progress ? (
          <div>
            <p className="text-sm text-fg-muted">
              Uploading… {upload.progress.percent}%
            </p>
            <div className="mx-auto mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all"
                style={{ width: `${upload.progress.percent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">
              {formatBytes(upload.progress.loaded)} of {formatBytes(upload.progress.total)}
            </p>
          </div>
        ) : (
          <>
            <Upload className="mx-auto h-7 w-7 text-fg-subtle" aria-hidden />
            <p className="mt-2 text-sm text-fg-muted">
              Drag a file here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-brand-bright underline underline-offset-2 hover:text-accent"
              >
                browse
              </button>
            </p>
          </>
        )}
      </div>

      {attachments.length > 0 ? (
        <ul className="space-y-2">
          {attachments.map((file) => {
            const isImage = file.mimeType.startsWith('image/');
            return (
              <li
                key={file.id}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-raised">
                  {isImage ? (
                    <ImageIcon className="h-4 w-4 text-accent" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4 text-fg-subtle" aria-hidden />
                  )}
                </span>

                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-sm hover:text-brand-bright">{file.filename}</p>
                  <p className="text-xs text-fg-subtle">{formatBytes(file.sizeBytes)}</p>
                </a>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${file.filename}`}
                  className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => remove.mutate(file.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Avatar picker used in settings. */
export function AvatarUploader({
  currentUrl,
  name,
}: {
  currentUrl: string | null;
  name: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: status } = useUploadStatus();
  const upload = useAvatarUpload();

  // The avatar itself always shows; only the change control depends on the
  // upload provider being configured.
  const configured = status?.configured ?? false;

  return (
    <div className="flex items-center gap-4">
      <span className="relative">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={`${name}'s avatar`}
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-lg font-semibold text-white">
            {name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? '')
              .join('')}
          </span>
        )}

        {upload.progress ? (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/60 text-xs font-medium text-white">
            {upload.progress.percent}%
          </span>
        ) : null}
      </span>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = '';
          }}
        />
        {configured ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Change avatar
            </Button>
            <p className="mt-1 text-xs text-fg-subtle">JPG, PNG, WebP or GIF up to 2MB.</p>
          </>
        ) : (
          <p className="text-xs text-fg-subtle">
            Photo uploads need Cloudinary credentials on the server.
          </p>
        )}
      </div>
    </div>
  );
}
