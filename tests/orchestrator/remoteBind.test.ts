import { describe, it, expect } from 'vitest';
import { resolveWsRemoteBind, formatIpadConnectionInfo } from '../../orchestrator/remoteBind.js';

const ifaces = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  en0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
};

describe('resolveWsRemoteBind', () => {
  it('returns null when WATCHTOWER_WS_HOST is unset (loopback default preserved)', () => {
    expect(resolveWsRemoteBind({}, ifaces)).toBeNull();
  });
  it('uses an explicit host and the default stable port 7445', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '192.168.1.42' }, ifaces))
      .toEqual({ host: '192.168.1.42', port: 7445 });
  });
  it('honors an explicit WATCHTOWER_WS_PORT', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '192.168.1.42', WATCHTOWER_WS_PORT: '7500' }, ifaces))
      .toEqual({ host: '192.168.1.42', port: 7500 });
  });
  it('resolves "auto" to the first non-internal IPv4 interface', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, ifaces))
      .toEqual({ host: '192.168.1.42', port: 7445 });
  });
  it('returns null for "auto" when no external IPv4 exists (stays loopback)', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, { lo0: ifaces.lo0 })).toBeNull();
  });
});

describe('formatIpadConnectionInfo', () => {
  it('builds the ws connect string with the token', () => {
    expect(formatIpadConnectionInfo({ host: '192.168.1.42', port: 7445, token: 'abc' }))
      .toBe('[orchestrator] iPad connect → ws://192.168.1.42:7445/ws  token: abc');
  });
});
