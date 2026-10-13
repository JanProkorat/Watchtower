import { describe, it, expect } from 'vitest';
import { BlastRadiusStore, HOLD_EXPIRY_MS, type BlastRadiusHooks } from '../../orchestrator/services/blastRadiusStore.js';
import type { BlastRadiusState } from '@watchtower/shared/blastRadius.js';

const hold = (id: string) => ({ version: 1, hold: { id, command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 's', lines: [], more: 0, note: '', startedAt: 1 } });
const release = (id: string, decision = 'proceed') => ({ version: 1, hold: null, outcome: { id, command: 'rm -rf dist', decision } });

function make() {
  const log: string[] = [];
  const pushed: BlastRadiusState[] = [];
  const hooks: BlastRadiusHooks = {
    emit: (s) => pushed.push(s),
    isKnownInstance: (id) => id === 'i1',
    hold: (id, reassert) => log.push(`${reassert ? 'reassert' : 'hold'} ${id}`),
    release: (id) => log.push(`release ${id}`),
  };
  return { store: new BlastRadiusStore(hooks), log, pushed };
}

describe('BlastRadiusStore', () => {
  it('a hold flags attention and pushes; a release clears it and records the outcome', () => {
    const { store, log, pushed } = make();
    expect(store.ingest(hold('h1'), 'i1', 100)).toBe(true);
    expect(store.get('i1', 100)).toMatchObject({ hold: { id: 'h1' }, decided: null });
    expect(store.ingest(release('h1'), 'i1', 200)).toBe(true);
    expect(store.get('i1', 200)).toMatchObject({ hold: null, outcome: { id: 'h1', decision: 'proceed' } });
    expect(log).toEqual(['hold i1', 'release i1']);
    expect(pushed).toHaveLength(2);
  });

  it('a release with no pending hold records the outcome but never releases attention', () => {
    const { store, log, pushed } = make();
    expect(store.ingest(release('h1'), 'i1', 1)).toBe(true);
    expect(store.get('i1', 1)).toMatchObject({ hold: null, outcome: { id: 'h1' } });
    expect(pushed).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it('a release for another hold id leaves the pending hold untouched', () => {
    const { store, log } = make();
    store.ingest(hold('h2'), 'i1', 1);
    expect(store.ingest(release('h1'), 'i1', 2)).toBe(true);
    expect(store.get('i1', 2)?.hold?.id).toBe('h2');
    expect(log).toEqual(['hold i1']);
  });

  it('drops unknown instances and invalid bodies', () => {
    const { store, pushed } = make();
    expect(store.ingest(hold('h1'), 'stranger', 1)).toBe(false);
    expect(store.ingest({ version: 9 }, 'i1', 1)).toBe(false);
    expect(pushed).toEqual([]);
  });

  it('a decision is collected only for the pending hold id; stale ids are ignored', () => {
    const { store } = make();
    store.ingest(hold('h1'), 'i1', 1);
    expect(store.decide('i1', 'old', 'proceed', 2)).toBe(false);
    expect(store.decisionFor('i1', 'h1', 3)).toBeNull();
    expect(store.decide('i1', 'h1', 'cancel', 4)).toBe(true);
    expect(store.decisionFor('i1', 'h1', 5)).toBe('cancel');
    expect(store.decisionFor('i1', 'other', 6)).toBeUndefined();
    // A second hold starts undecided even if the first one's answer arrives late.
    store.ingest(release('h1', 'cancel'), 'i1', 7);
    store.ingest(hold('h2'), 'i1', 8);
    expect(store.decide('i1', 'h1', 'proceed', 9)).toBe(false);
    expect(store.decisionFor('i1', 'h2', 10)).toBeNull();
  });

  it('a poll while still waiting re-asserts the attention flag (focus clears it)', () => {
    const { store, log } = make();
    store.ingest(hold('h1'), 'i1', 1);
    store.decisionFor('i1', 'h1', 2);
    store.decisionFor('i1', 'h1', 3);
    expect(log).toEqual(['hold i1', 'reassert i1', 'reassert i1']);
    store.decide('i1', 'h1', 'proceed', 4);
    store.decisionFor('i1', 'h1', 5);
    expect(log).toHaveLength(3); // answered: no re-assert
  });

  it('expires a hold after 11 minutes and on dispose', () => {
    const { store, log } = make();
    store.ingest(hold('h1'), 'i1', 0);
    store.sweep(HOLD_EXPIRY_MS - 1);
    expect(store.get('i1', HOLD_EXPIRY_MS - 1)?.hold).not.toBeNull();
    store.sweep(HOLD_EXPIRY_MS + 1);
    expect(store.get('i1', HOLD_EXPIRY_MS + 1)?.hold).toBeNull();
    expect(log.at(-1)).toBe('release i1');
    store.ingest(hold('h2'), 'i1', 0);
    store.dispose('i1');
    expect(store.get('i1', 1)).toBeNull();
  });

  it('expiring a decided hold clears it without releasing attention', () => {
    const { store, log, pushed } = make();
    store.ingest(hold('h1'), 'i1', 0);
    store.decide('i1', 'h1', 'proceed', 1);
    const before = pushed.length;
    store.sweep(HOLD_EXPIRY_MS + 1);
    expect(store.get('i1', HOLD_EXPIRY_MS + 1)?.hold).toBeNull();
    expect(pushed).toHaveLength(before + 1);
    expect(log).toEqual(['hold i1']);
  });

  it('drop clears a pending hold and pushes, without releasing attention', () => {
    const { store, log, pushed } = make();
    store.ingest(release('h0', 'cancel'), 'i1', 0);
    store.ingest(hold('h1'), 'i1', 1);
    store.drop('i1');
    expect(store.get('i1', 2)).toMatchObject({ hold: null, decided: null, outcome: { id: 'h0' } });
    expect(pushed.at(-1)?.hold).toBeNull();
    expect(log).toEqual(['hold i1']);
    const n = pushed.length;
    store.drop('i1');
    expect(pushed).toHaveLength(n);
  });
});
