import { describe, it, expect } from 'vitest';
import { createHubSender } from '../../orchestrator/hubSender.js';
import { DEFAULT_HUB_CONFIG } from '@watchtower/shared/hubConfig.js';

function deps(over = {}) {
  const sent: Array<{ token: string; topic: string; data: Record<string, unknown> }> = []; const removed: string[] = [];
  const base = {
    getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: true, apnsKey: 'k', apnsKeyId: 'i', apnsTeamId: 't' }),
    listTokens: async () => [
      { token: 'tokA', bundleId: 'cz.greencode.watchtower.ipad' },
      { token: 'tokB', bundleId: 'cz.greencode.watchtower.ios' },
    ],
    removeToken: (t: string) => removed.push(t),
    sendApns: async (_c: any, token: string, msg: any, topic: string) => {
      sent.push({ token, topic, data: msg.data });
      return token === 'tokB' ? { ok: false, status: 410, reason: 'Unregistered' } : { ok: true, status: 200 };
    },
    buildContext: () => ({ title: 'api', body: 'permission needed' }),
    ...over,
  };
  return { base, sent, removed };
}

describe('hubSender.fire', () => {
  it('sends APNs to all tokens with instanceId data and each device\'s bundleId as topic, pruning 410s', async () => {
    const { base, sent, removed } = deps();
    await createHubSender(base).fire('i1', '/x', 'waiting-permission');
    expect(sent).toEqual([
      { token: 'tokA', topic: 'cz.greencode.watchtower.ipad', data: { instanceId: 'i1', kind: 'waiting-permission' } },
      { token: 'tokB', topic: 'cz.greencode.watchtower.ios', data: { instanceId: 'i1', kind: 'waiting-permission' } },
    ]);
    expect(removed).toEqual(['tokB']); // 410 → pruned
  });

  it('passes each device\'s bundleId as the APNs topic', async () => {
    const sent: { token: string; topic: string }[] = [];
    const sender = createHubSender({
      getConfig: () => ({ enabled: true, apnsKey: 'k', apnsKeyId: 'k', apnsTeamId: 't', apnsEnv: 'sandbox' } as any),
      listTokens: async () => [
        { token: 'ipad-tok', bundleId: 'cz.greencode.watchtower.ipad' },
        { token: 'ios-tok', bundleId: 'cz.greencode.watchtower.ios' },
      ],
      removeToken: () => {},
      sendApns: async (_cfg, token, _msg, topic) => { sent.push({ token, topic }); return { ok: true, status: 200 }; },
      buildContext: () => ({ title: 'T', body: 'B' }),
    });
    await sender.fire('inst', '/x/proj', 'crashed');
    expect(sent).toEqual([
      { token: 'ipad-tok', topic: 'cz.greencode.watchtower.ipad' },
      { token: 'ios-tok', topic: 'cz.greencode.watchtower.ios' },
    ]);
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
