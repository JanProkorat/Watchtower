import { describe, it, expect } from 'vitest';
import { resolveWsRemoteBind, formatIpadConnectionInfo, isTailscale } from '../../orchestrator/remoteBind.js';

const IF = {
  en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }],
  utun3: [{ address: '100.97.12.34', family: 'IPv4', internal: false }],
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};

describe('resolveWsRemoteBind auto', () => {
  it('prefers the Tailscale (100.64/10) address over LAN', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, IF as never))
      .toEqual({ host: '100.97.12.34', port: 7445 });
  });
  it('falls back to LAN when no Tailscale address is present', () => {
    const lanOnly = { en0: IF.en0, lo0: IF.lo0 };
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, lanOnly as never))
      .toEqual({ host: '192.168.1.50', port: 7445 });
  });
  it('honours an explicit host verbatim', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '100.1.2.3', WATCHTOWER_WS_PORT: '9000' }, IF as never))
      .toEqual({ host: '100.1.2.3', port: 9000 });
  });
  it('defaults to auto when unset (reachable by default)', () => {
    expect(resolveWsRemoteBind({}, IF as never))
      .toEqual({ host: '100.97.12.34', port: 7445 });
  });
  it('honours an explicit localhost opt-out verbatim', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '127.0.0.1' }, IF as never))
      .toEqual({ host: '127.0.0.1', port: 7445 });
  });
  it('returns null when no external interface exists (offline → caller keeps localhost)', () => {
    expect(resolveWsRemoteBind({}, { lo0: IF.lo0 } as never)).toBeNull();
  });
  it('excludes 100.64/10 boundaries correctly (100.63 is NOT tailscale, 100.64 IS)', () => {
    const edge = { a: [{ address: '100.63.0.1', family: 'IPv4', internal: false }], b: [{ address: '100.64.0.1', family: 'IPv4', internal: false }] };
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, edge as never))
      .toEqual({ host: '100.64.0.1', port: 7445 });
  });
});

describe('formatIpadConnectionInfo', () => {
  it('annotates a Tailscale host as off-network reachable', () => {
    const line = formatIpadConnectionInfo({ host: '100.101.102.103', port: 7445, token: 't' });
    expect(line).toContain('Tailscale');
    expect(line).toContain('ws://100.101.102.103:7445/ws');
  });
  it('does not annotate a plain LAN host', () => {
    const line = formatIpadConnectionInfo({ host: '192.168.0.52', port: 7445, token: 't' });
    expect(line).not.toContain('Tailscale');
  });
  it('isTailscale detects the CGNAT range', () => {
    expect(isTailscale('100.64.0.1')).toBe(true);
    expect(isTailscale('192.168.0.52')).toBe(false);
  });
});
