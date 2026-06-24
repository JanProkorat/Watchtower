import { describe, it, expect } from 'vitest';
import { isStale, STALE_THRESHOLD_MS } from '../../apps/desktop/src/state/useBoard.js';
import type { BoardSnapshotPayload } from '@watchtower/shared/ipcContract.js';

function snapshot(syncedAt: string | null): BoardSnapshotPayload {
  return { cards: [], syncedAt, lastSyncResult: null };
}

describe('useBoard.isStale', () => {
  const t0 = Date.parse('2026-05-26T14:32:00Z');

  it('reports stale when snapshot is null', () => {
    expect(isStale(null, t0)).toBe(true);
  });

  it('reports stale when snapshot has no syncedAt', () => {
    expect(isStale(snapshot(null), t0)).toBe(true);
  });

  it('reports stale when syncedAt is older than the threshold', () => {
    const oneMinTooOld = new Date(t0 - STALE_THRESHOLD_MS - 60_000).toISOString();
    expect(isStale(snapshot(oneMinTooOld), t0)).toBe(true);
  });

  it('reports fresh when syncedAt is within the threshold', () => {
    const justUnderThreshold = new Date(t0 - STALE_THRESHOLD_MS + 60_000).toISOString();
    expect(isStale(snapshot(justUnderThreshold), t0)).toBe(false);
  });

  it('reports fresh when syncedAt is exactly the boundary (strict gt)', () => {
    const exactBoundary = new Date(t0 - STALE_THRESHOLD_MS).toISOString();
    expect(isStale(snapshot(exactBoundary), t0)).toBe(false);
  });
});
