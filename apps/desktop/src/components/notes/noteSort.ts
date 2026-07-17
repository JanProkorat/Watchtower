import type { NoteViewPayload } from '@watchtower/shared/ipcContract.js';

/** Split the server-ordered list into open (done null|0) and completed (done 1). */
export function splitNotes(notes: NoteViewPayload[]): {
  open: NoteViewPayload[];
  completed: NoteViewPayload[];
} {
  const open: NoteViewPayload[] = [];
  const completed: NoteViewPayload[] = [];
  for (const n of notes) (n.done === 1 ? completed : open).push(n);
  return { open, completed };
}
