import { describe, it, expect, beforeEach } from 'vitest';
import type { ModBandsState } from '@watchtower/shared/modBands.js';
import { ModBandsStore } from '../../orchestrator/services/modBandsStore';

let pushes: ModBandsState[];
let store: ModBandsStore;

const rules = (...ids: string[]) => ({ version: 1, items: ids.map((id) => ({ id, rule: `rule ${id}` })) });

beforeEach(() => {
  pushes = [];
  store = new ModBandsStore((s) => pushes.push(s), (id) => id === 'i1');
});

describe('ModBandsStore', () => {
  it('merges each mod into one state per instance and pushes it', () => {
    expect(store.ingest('cache-tax', { version: 1, band: { state: 'cold', text: ' · ping soon' } }, 'i1')).toBe(true);
    expect(store.ingest('collision-guard', { version: 1, peers: [{ id: 'p1', where: null, tasks: [] }] }, 'i1')).toBe(true);
    expect(store.get('i1').bands).toEqual({
      cacheTax: { state: 'cold', text: ' · ping soon' },
      peers: [{ id: 'p1', where: null, tasks: [] }],
      reflect: [],
    });
    expect(pushes).toHaveLength(2);
    expect(pushes[1]?.bands.cacheTax?.state).toBe('cold');
  });

  it('drops posts for unknown instances and malformed bodies', () => {
    expect(store.ingest('cache-tax', { version: 1, band: null }, 'ghost')).toBe(false);
    expect(store.ingest('reflect-mod', { version: 1 }, 'i1')).toBe(false);
    expect(pushes).toHaveLength(0);
  });

  it('queues one click per listed rule, hands them out oldest first, and forgets clicks on rules gone', () => {
    store.ingest('reflect-mod', rules('r1', 'r2', 'r3'), 'i1');
    expect(store.click('i1', 'nope', 'save')).toBe(false);
    expect(store.click('i1', 'r1', 'skip')).toBe(true);
    expect(store.click('i1', 'r2', 'save')).toBe(true);
    expect(store.click('i1', 'r1', 'edit')).toBe(true); // replaces the earlier r1 click
    expect(store.click('i1', 'r3', 'other')).toBe(true);
    store.ingest('reflect-mod', rules('r1', 'r2'), 'i1'); // r3 decided elsewhere
    expect(store.nextClick('i1')).toEqual({ itemId: 'r2', action: 'save' });
    expect(store.nextClick('i1')).toEqual({ itemId: 'r1', action: 'edit' });
    expect(store.nextClick('i1')).toBeNull();
  });

  it('dispose forgets state and clicks', () => {
    store.ingest('reflect-mod', rules('r1'), 'i1');
    store.click('i1', 'r1', 'skip');
    store.dispose('i1');
    expect(store.get('i1').bands.reflect).toEqual([]);
    expect(store.nextClick('i1')).toBeNull();
  });
});
