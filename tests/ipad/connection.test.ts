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

describe('parseConnection wake fields', () => {
  const base = { host: 'x', port: '7445', token: 't' };

  it('keeps wake fields absent when not provided', () => {
    const r = parseConnection(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mac).toBeUndefined();
  });

  it('accepts a valid MAC and trims LAN/DDNS hosts', () => {
    const r = parseConnection({ ...base, mac: 'AA:BB:CC:DD:EE:FF', lanIp: ' 192.168.1.50 ', wanHost: ' home.ddns ' });
    expect(r).toEqual({ ok: true, value: {
      host: 'x', port: 7445, token: 't',
      mac: 'AA:BB:CC:DD:EE:FF', lanIp: '192.168.1.50', wanHost: 'home.ddns', wanPort: 9,
    } });
  });

  it('rejects an invalid MAC', () => {
    expect(parseConnection({ ...base, mac: 'nope' }).ok).toBe(false);
  });

  it('defaults wanPort to 9 and validates a provided one', () => {
    expect(parseConnection({ ...base, wanHost: 'h', wanPort: '' }).ok).toBe(true);
    const r = parseConnection({ ...base, wanHost: 'h', wanPort: '9999' });
    expect(r.ok && r.value.wanPort).toBe(9999);
    expect(parseConnection({ ...base, wanHost: 'h', wanPort: '70000' }).ok).toBe(false);
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
