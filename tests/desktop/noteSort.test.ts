import { describe, it, expect } from 'vitest';
import { splitNotes } from '../../apps/desktop/src/components/notes/noteSort.js';
import type { NoteViewPayload } from '@watchtower/shared/ipcContract.js';

const mk = (id: number, done: null | 0 | 1): NoteViewPayload => ({
  id, title: `n${id}`, body: '', done, doneAt: null, dueDate: null,
  priority: 'none', pinned: false, projectId: null, projectName: null,
  projectColor: null, createdAt: '', updatedAt: '',
});

describe('splitNotes', () => {
  it('splits completed (done=1) from open (null | 0), preserving order', () => {
    const { open, completed } = splitNotes([mk(1, 0), mk(2, 1), mk(3, null), mk(4, 1)]);
    expect(open.map((n) => n.id)).toEqual([1, 3]);
    expect(completed.map((n) => n.id)).toEqual([2, 4]);
  });
});
