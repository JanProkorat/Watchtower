import { describe, it, expect } from 'vitest';
import { readWsConfig } from '../../../client/src/transport/selectTransport';

const noStore = { getItem: () => null };

describe('readWsConfig', () => {
  it('reads url + token from the query string', () => {
    const cfg = readWsConfig(
      { search: '?wsUrl=ws://mac:7440/ws&wsToken=abc' },
      noStore,
    );
    expect(cfg).toEqual({ url: 'ws://mac:7440/ws', token: 'abc' });
  });

  it('falls back to localStorage', () => {
    const store = { getItem: (k: string) => (k === 'watchtower.wsUrl' ? 'ws://m/ws' : k === 'watchtower.wsToken' ? 'tok' : null) };
    expect(readWsConfig({ search: '' }, store)).toEqual({ url: 'ws://m/ws', token: 'tok' });
  });

  it('returns null when nothing is configured', () => {
    expect(readWsConfig({ search: '' }, noStore)).toBeNull();
  });
});
