import { describe, it, expect } from 'vitest';
import { createHubSender } from '../../orchestrator/hubSender.js';
import { DEFAULT_HUB_CONFIG } from '@watchtower/shared/hubConfig.js';

function deps(over = {}) {
  const sent: Array<{ token: string; data: Record<string, unknown> }> = []; const removed: string[] = [];
  const base = {
    getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: true, apnsKey: 'k', apnsKeyId: 'i', apnsTeamId: 't' }),
    listTokens: () => ['tokA', 'tokB'],
    removeToken: (t: string) => removed.push(t),
    sendApns: async (_c: any, token: string, msg: any) => { sent.push({ token, data: msg.data }); return token === 'tokB' ? { ok: false, status: 410, reason: 'Unregistered' } : { ok: true, status: 200 }; },
    buildContext: () => ({ title: 'api', body: 'čeká na povolení' }),
    ...over,
  };
  return { base, sent, removed };
}

describe('hubSender.fire', () => {
  it('sends APNs to all tokens with instanceId data, pruning 410s', async () => {
    const { base, sent, removed } = deps();
    await createHubSender(base).fire('i1', '/x', 'waiting-permission');
    expect(sent.map(s => s.token).sort()).toEqual(['tokA', 'tokB']);
    expect(sent[0].data).toEqual({ instanceId: 'i1' });
    expect(removed).toEqual(['tokB']); // 410 → pruned
  });

  it('does nothing when hub disabled', async () => {
    const { base, sent } = deps({ getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: false }) });
    await createHubSender(base).fire('i1', '/x', 'idle-notify');
    expect(sent).toEqual([]);
  });

  it('does nothing when APNs credentials missing', async () => {
    const { base, sent } = deps({ getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: true, apnsKey: '', apnsKeyId: '', apnsTeamId: '' }) });
    await createHubSender(base).fire('i1', '/x', 'idle-notify');
    expect(sent).toEqual([]);
  });
});
