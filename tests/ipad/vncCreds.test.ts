import { describe, it, expect } from 'vitest';
import { loadVncCreds, saveVncCreds } from '../../apps/ipad/src/state/vncCreds.js';

function memStore() {
  const mem = new Map<string, string>();
  return { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: string) => void mem.set(k, v) };
}

describe('vncCreds persistence', () => {
  it('round-trips username + password through a store', async () => {
    const store = memStore();
    await saveVncCreds(store, { username: 'jan', password: 'hunter2' });
    expect(await loadVncCreds(store)).toEqual({ username: 'jan', password: 'hunter2' });
  });
  it('returns null when nothing is stored', async () => {
    const store = { get: async () => null, set: async () => {} };
    expect(await loadVncCreds(store)).toBeNull();
  });
  it('returns null on malformed JSON', async () => {
    const store = { get: async () => 'not json', set: async () => {} };
    expect(await loadVncCreds(store)).toBeNull();
  });
  it('returns null when fields are missing/wrong type', async () => {
    const store = { get: async () => JSON.stringify({ username: 'jan' }), set: async () => {} };
    expect(await loadVncCreds(store)).toBeNull();
  });
});
