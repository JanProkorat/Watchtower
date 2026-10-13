import { describe, it, expect } from 'vitest';
import { FileTreeActivityStore } from '../../orchestrator/services/fileTreeActivityStore.js';
import type { FileTreeActivityState } from '@watchtower/shared/fileTree.js';

const body = { version: 1, panelToggles: 1, sentAt: 900, activity: [{ path: '/r/a', kind: 'write', at: 800 }] };

describe('FileTreeActivityStore', () => {
  it('stores and pushes a valid body for a known instance; drops the rest', () => {
    const pushed: FileTreeActivityState[] = [];
    const store = new FileTreeActivityStore((s) => pushed.push(s), (id) => id === 'i1');
    expect(store.ingest(body, 'i1', 1_000)).toBe(true);
    expect(store.ingest(body, 'stranger', 1)).toBe(false);
    expect(store.ingest({ version: 9 }, 'i1', 1)).toBe(false);
    expect(pushed).toHaveLength(1);
    expect(store.get('i1')).toMatchObject({ instanceId: 'i1', receivedAt: 1_000, snapshot: { panelToggles: 1 } });
    store.dispose('i1');
    expect(store.get('i1')).toBeNull();
  });
});
