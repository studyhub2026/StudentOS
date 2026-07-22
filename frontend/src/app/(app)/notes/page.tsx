'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderPlus,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { NoteEditor } from '@/components/notes/note-editor';
import { NoteVersionPanel } from '@/components/notes/note-version-panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useArchiveNote,
  useCreateFolder,
  useCreateNote,
  useDeleteNote,
  useNote,
  useNoteFolders,
  useNotes,
  usePurgeNote,
  useRestoreNote,
  useToggleFavorite,
} from '@/hooks/use-notes';
import { apiErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { NoteView } from '@/types/api';

const VIEWS: { key: NoteView; label: string; icon: typeof FileText }[] = [
  { key: 'active', label: 'All notes', icon: FileText },
  { key: 'favorites', label: 'Favourites', icon: Star },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

export default function NotesPage() {
  const [view, setView] = useState<NoteView>('active');
  const [folderId, setFolderId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const search = useDebouncedValue(searchInput, 300);

  const filters = useMemo(
    () => ({
      view,
      page,
      limit: 20,
      ...(folderId ? { folderId } : {}),
      ...(search ? { search } : {}),
    }),
    [view, page, folderId, search],
  );

  const { data, isLoading, isError, error } = useNotes(filters);
  const { data: folders } = useNoteFolders();
  const { data: selectedNote } = useNote(selectedId);

  const createNote = useCreateNote();
  const createFolder = useCreateFolder();
  const deleteNote = useDeleteNote();
  const restoreNote = useRestoreNote();
  const purgeNote = usePurgeNote();
  const archiveNote = useArchiveNote();
  const toggleFavorite = useToggleFavorite();

  function switchView(next: NoteView) {
    setView(next);
    setPage(1);
    setSelectedId(null);
  }

  async function handleCreate() {
    const note = await createNote.mutateAsync({
      title: 'Untitled note',
      content: '',
      ...(folderId ? { folderId } : {}),
    });
    setSelectedId(note.id);
  }

  function handleCreateFolder() {
    const name = window.prompt('Folder name');
    if (name?.trim()) createFolder.mutate({ name: name.trim() });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {data ? `${data.pagination.total} in ${VIEWS.find((v) => v.key === view)?.label.toLowerCase()}` : 'Loading…'}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleCreateFolder}>
            <FolderPlus className="h-4 w-4" aria-hidden />
            New folder
          </Button>
          <Button size="sm" loading={createNote.isPending} onClick={() => void handleCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            New note
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Sidebar: views and folders */}
        <aside className="space-y-4">
          <nav className="space-y-1">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-current={view === key ? 'page' : undefined}
                onClick={() => switchView(key)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
                  view === key
                    ? 'bg-brand/12 font-medium text-brand-bright'
                    : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          {folders && folders.length > 0 ? (
            <div>
              <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Folders
              </p>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setFolderId(undefined);
                    setPage(1);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-sm transition-colors',
                    !folderId ? 'text-fg' : 'text-fg-muted hover:bg-surface-raised',
                  )}
                >
                  All folders
                </button>

                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      setFolderId(folder.id === folderId ? undefined : folder.id);
                      setPage(1);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm transition-colors',
                      folderId === folder.id
                        ? 'bg-brand/12 text-brand-bright'
                        : 'text-fg-muted hover:bg-surface-raised',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: folder.color ?? 'var(--color-border-strong)' }}
                        aria-hidden
                      />
                      <span className="truncate">{folder.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-fg-subtle">{folder.noteCount}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        {/* Main: list or editor */}
        <section className="min-w-0">
          {selectedId && selectedNote ? (
            <Card className="h-[calc(100vh-13rem)] overflow-hidden p-0">
              <NoteEditor
                note={selectedNote}
                onClose={() => {
                  setSelectedId(null);
                  setHistoryOpen(false);
                }}
                onOpenHistory={() => setHistoryOpen(true)}
              />
            </Card>
          ) : (
            <>
              <div className="relative mb-4">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => {
                    setSearchInput(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search notes…"
                  aria-label="Search notes"
                  className="h-10 w-full rounded-xl border border-border bg-surface-raised pl-9 pr-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
              </div>

              {isError ? (
                <Card className="text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
                  <p className="mt-3 font-medium">Could not load notes</p>
                  <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
                </Card>
              ) : isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-36 w-full rounded-2xl" />
                  ))}
                </div>
              ) : !data || data.items.length === 0 ? (
                <Card className="py-14 text-center">
                  <FileText className="mx-auto h-10 w-10 text-fg-subtle" aria-hidden />
                  <p className="mt-3 font-medium">
                    {search ? 'No notes match that search' : 'Nothing here yet'}
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
                    {search
                      ? 'Try a different term.'
                      : view === 'trash'
                        ? 'Deleted notes will appear here.'
                        : 'Create a note to get started.'}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {data.items.map((note) => (
                    <article
                      key={note.id}
                      className="group flex flex-col rounded-2xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-brand/40"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(note.id)}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="line-clamp-1 font-medium">{note.title}</h3>
                          {note.favorite ? (
                            <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" aria-label="Favourite" />
                          ) : null}
                        </div>

                        <p className="mt-1.5 line-clamp-3 text-sm text-fg-muted">
                          {note.excerpt || 'Empty note'}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                          {note.folder ? <span>{note.folder.name}</span> : null}
                          <span>{note.wordCount} words</span>
                          {note._count.versions > 0 ? (
                            <span>{note._count.versions} versions</span>
                          ) : null}
                        </div>

                        {note.tags.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {note.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-md bg-surface-raised px-1.5 py-0.5 text-xs text-fg-subtle"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>

                      <div className="mt-3 flex items-center gap-1 border-t border-border pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        {view === 'trash' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => restoreNote.mutate(note.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              Restore
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger"
                              onClick={() => {
                                if (window.confirm(`Permanently delete "${note.title}"? This cannot be undone.`)) {
                                  purgeNote.mutate(note.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              Delete
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={note.favorite ? 'Unfavourite' : 'Favourite'}
                              onClick={() =>
                                toggleFavorite.mutate({ id: note.id, favorite: !note.favorite })
                              }
                            >
                              <Star
                                className={cn('h-4 w-4', note.favorite && 'fill-warning text-warning')}
                                aria-hidden
                              />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={note.archivedAt ? 'Unarchive' : 'Archive'}
                              onClick={() =>
                                archiveNote.mutate({ id: note.id, archived: !note.archivedAt })
                              }
                            >
                              {note.archivedAt ? (
                                <ArchiveRestore className="h-4 w-4" aria-hidden />
                              ) : (
                                <Archive className="h-4 w-4" aria-hidden />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Move to trash"
                              className="ml-auto text-fg-subtle hover:text-danger"
                              onClick={() => deleteNote.mutate(note.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {data && data.pagination.totalPages > 1 ? (
                <nav className="mt-5 flex items-center justify-between" aria-label="Pagination">
                  <p className="text-sm text-fg-subtle">
                    Page {data.pagination.page} of {data.pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!data.pagination.hasPrevious}
                      onClick={() => setPage((current) => current - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!data.pagination.hasNext}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </nav>
              ) : null}
            </>
          )}
        </section>
      </div>

      {historyOpen && selectedId ? (
        <NoteVersionPanel noteId={selectedId} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </div>
  );
}
