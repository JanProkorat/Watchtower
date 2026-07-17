// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';
import { newestThreadId } from '../../apps/desktop/src/components/reviews/CommentThread';

const thread = (id: string, dates: string[]): PrCommentThreadPayload => ({
  id, file: null, line: null, status: null,
  comments: dates.map((date) => ({ author: 'x', date, body: 'b' })),
});

describe('newestThreadId', () => {
  it('returns null for no threads', () => {
    expect(newestThreadId([])).toBeNull();
  });

  it('returns the id of the thread with the most recent comment', () => {
    const threads = [
      thread('a', ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z']),
      thread('b', ['2026-03-15T00:00:00Z']),
      thread('c', ['2026-01-20T00:00:00Z']),
    ];
    expect(newestThreadId(threads)).toBe('b');
  });

  it('handles threads with no comments without crashing', () => {
    expect(newestThreadId([thread('a', []), thread('b', ['2026-01-01T00:00:00Z'])])).toBe('b');
  });
});
