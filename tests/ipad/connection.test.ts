// tests/ipad/connection.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseConnection, connectionToWsUrl, loadConnection, saveConnection,
} from '../../apps/ipad/src/connection.js';

describe('parseConnection', () => {
  it('accepts a valid host/port/token', () => {
    expect(parseConnection({ host: '192.168.1.42', port: '7445', token: 'abc' }))
      .toEqual({ ok: true, value: { host: '192.168.1.42', port: 7445, token: 'abc' } });
  });
  it('rejects an empty host', () => {
    expect(parseConnection({ host: '', port: '7445', token: 'abc' }).ok).toBe(false);
  });
  it('rejects an out-of-range port', () => {
    expect(parseConnection({ host: 'x', port: '70000', token: 'abc' }).ok).toBe(false);
  });
  it('rejects an empty token', () => {
    expect(parseConnection({ host: 'x', port: '7445', token: '' }).ok).toBe(false);
  });
});

describe('connectionToWsUrl', () => {
  it('builds the /ws url', () => {
    expect(connectionToWsUrl({ host: '192.168.1.42', port: 7445, token: 't' }))
      .toBe('ws://192.168.1.42:7445/ws');
  });
});

describe('persistence', () => {
  it('round-trips through a store', async () => {
    const mem = new Map<string, string>();
    const store = {
      get: async (k: string) => mem.get(k) ?? null,
      set: async (k: string, v: string) => void mem.set(k, v),
    };
    await saveConnection(store, { host: 'h', port: 7445, token: 't' });
    expect(await loadConnection(store)).toEqual({ host: 'h', port: 7445, token: 't' });
  });
  it('returns null when nothing is stored', async () => {
    const store = { get: async () => null, set: async () => {} };
    expect(await loadConnection(store)).toBeNull();
  });
});
