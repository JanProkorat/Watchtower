import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NoteInputPayload, NoteListFilterPayload, NoteViewPayload,
} from '@watchtower/shared/ipcContract.js';
import { broadcastNotesChanged, subscribeNotes } from './notesBus.js';
import { subscribeProjects } from './projectsBus.js';
import { invoke } from './ipc';

export type NoteScope = 'all' | 'global' | 'project';

export interface NotesFilter {
  scope: NoteScope;
  projectId: number | null;
  search: string;
  openTodosOnly: boolean;
  dueSoon: boolean;
}

export interface NotesState {
  notes: NoteViewPayload[];
  loading: boolean;
  error: string | null;
  filter: NotesFilter;
  setFilter(next: Partial<NotesFilter>): void;
  refresh(): Promise<void>;
  create(input: NoteInputPayload): Promise<NoteViewPayload>;
  update(id: number, input: Partial<NoteInputPayload>): Promise<NoteViewPayload>;
  remove(id: number): Promise<void>;
}

function toIpcFilter(f: NotesFilter): NoteListFilterPayload {
  const out: NoteListFilterPayload = { scope: f.scope, includeCompleted: true };
  if (f.scope === 'project' && f.projectId != null) out.projectId = f.projectId;
  if (f.search.trim()) out.search = f.search.trim();
  if (f.openTodosOnly) out.openTodosOnly = true;
  if (f.dueSoon) out.dueSoon = true;
  return out;
}

export function useNotes(): NotesState {
  const [filter, setFilterState] = useState<NotesFilter>({
    scope: 'all', projectId: null, search: '', openTodosOnly: false, dueSoon: false,
  });
  const [notes, setNotes] = useState<NoteViewPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ipcFilter = useMemo(() => toIpcFilter(filter), [filter]);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await invoke('notes:list', ipcFilter);
      setNotes(res.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ipcFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Refresh on any notes mutation elsewhere, and on project edits (so joined
  // project name/color on rows stay fresh — mirrors useProjects' bus usage).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const listenerRef = useRef<() => void>(() => {});
  useEffect(() => {
    const listener = () => { void refreshRef.current(); };
    listenerRef.current = listener;
    const un1 = subscribeNotes(listener);
    const un2 = subscribeProjects(listener);
    return () => { un1(); un2(); };
  }, []);

  const setFilter = useCallback((next: Partial<NotesFilter>) => {
    setFilterState((prev) => ({ ...prev, ...next }));
  }, []);

  const create = useCallback(async (input: NoteInputPayload) => {
    const res = await invoke('notes:create', input);
    await refresh();
    broadcastNotesChanged(listenerRef.current);
    return res.note;
  }, [refresh]);

  const update = useCallback(async (id: number, input: Partial<NoteInputPayload>) => {
    const res = await invoke('notes:update', { id, input });
    await refresh();
    broadcastNotesChanged(listenerRef.current);
    return res.note;
  }, [refresh]);

  const remove = useCallback(async (id: number) => {
    await invoke('notes:delete', { id });
    await refresh();
    broadcastNotesChanged(listenerRef.current);
  }, [refresh]);

  return { notes, loading, error, filter, setFilter, refresh, create, update, remove };
}
