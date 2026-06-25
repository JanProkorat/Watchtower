import { describe, it, expect } from 'vitest';
import { createHubSender } from '../../orchestrator/hubSender.js';
import { DEFAULT_HUB_CONFIG } from '@watchtower/shared/hubConfig.js';

function deps(over = {}) {
  const pushes: any[] = []; const sent: any[] = []; const removed: string[] = [];
  const base = {
    getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: true, apnsKey: 'k', apnsKeyId: 'i', apnsTeamId: 't' }),
    logPing: () => 42,
    listTokens: () => ['tokA', 'tokB'],
    removeToken: (t: string) => removed.push(t),
    emitPush: (p: any) => pushes.push(p),
    sendApns: async (_c: any, token: string) => { sent.push(token); return token === 'tokB' ? { ok: false, status: 410, reason: 'Unregistered' } : { ok: true, status: 200 }; },
    buildContext: () => ({ title: 'api', body: 'čeká na povolení' }),
    ...over,
  };
  return { base, pushes, sent, removed };
}

describe('hubSender.fire', () => {
  it('emits attentionPing and pushes APNs to all tokens, pruning 410s', async () => {
    const { base, pushes, sent, removed } = deps();
    await createHubSender(base).fire('i1', '/x', 'waiting-permission');
    expect(pushes).toEqual([{ kind: 'attentionPing', payload: { instanceId: 'i1', pingId: 42, kind: 'waiting-permission', title: 'api', body: 'čeká na povolení' } }]);
    expect(sent.sort()).toEqual(['tokA', 'tokB']);
    expect(removed).toEqual(['tokB']); // 410 → pruned
  });

  it('does nothing when hub disabled', async () => {
    const { base, pushes, sent } = deps({ getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: false }) });
    await createHubSender(base).fire('i1', '/x', 'idle-notify');
    expect(pushes).toEqual([]); expect(sent).toEqual([]);
  });
});
