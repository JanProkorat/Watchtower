import { describe, it, expect } from 'vitest';
import { SavvyProgressStore } from '../../orchestrator/services/savvyProgressStore.js';
import type { SavvyProgressState } from '@watchtower/shared/savvyProgress.js';

const body = { version: 1, lang: 'en', flow: null, agents: [], sentAt: 900 };

describe('SavvyProgressStore', () => {
  it('stores and pushes a valid snapshot for a known instance', () => {
    const pushed: SavvyProgressState[] = [];
    const store = new SavvyProgressStore((s) => pushed.push(s), (id) => id === 'inst-1');
    expect(store.ingest(body, 'inst-1', 1_000)).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ instanceId: 'inst-1', receivedAt: 1_000, snapshot: { sentAt: 900 } });
    expect(store.get('inst-1')).toEqual(pushed[0]);
  });

  it('drops snapshots for unknown instances and invalid bodies', () => {
    const pushed: SavvyProgressState[] = [];
    const store = new SavvyProgressStore((s) => pushed.push(s), (id) => id === 'inst-1');
    expect(store.ingest(body, 'stranger', 1)).toBe(false);
    expect(store.ingest({ version: 1 }, 'inst-1', 1)).toBe(false);
    expect(pushed).toHaveLength(0);
    expect(store.get('stranger')).toBeNull();
  });

  it('replaces the previous snapshot and forgets it on dispose', () => {
    const store = new SavvyProgressStore(() => {}, () => true);
    store.ingest(body, 'inst-1', 1);
    store.ingest({ ...body, sentAt: 2 }, 'inst-1', 3);
    expect(store.get('inst-1')?.snapshot.sentAt).toBe(2);
    store.dispose('inst-1');
    expect(store.get('inst-1')).toBeNull();
  });
});
