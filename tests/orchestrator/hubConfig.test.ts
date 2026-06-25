import { describe, it, expect } from 'vitest';
import { readHubConfig, writeHubConfig } from '../../orchestrator/services/hubConfig.js';
import { DEFAULT_HUB_CONFIG } from '@watchtower/shared/hubConfig.js';

function fakeSettings() {
  const m = new Map<string, string>();
  return {
    getString: (k: string, d: string) => m.get(k) ?? d,
    getNumber: (k: string, d: number) => (m.has(k) ? Number(m.get(k)) : d),
    set: (k: string, v: string) => void m.set(k, v),
  };
}

describe('hubConfig', () => {
  it('returns defaults when nothing stored', () => {
    expect(readHubConfig(fakeSettings() as never)).toEqual(DEFAULT_HUB_CONFIG);
  });
  it('round-trips through settings', () => {
    const s = fakeSettings();
    const cfg = { enabled: true, apnsKey: '-----P8-----', apnsKeyId: 'ABC123', apnsTeamId: 'TEAM99', apnsEnv: 'sandbox' as const };
    writeHubConfig(s as never, cfg);
    expect(readHubConfig(s as never)).toEqual(cfg);
  });
});
