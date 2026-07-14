import type { EscalationKind } from './escalationGate.js';
import type { HubConfig } from '@watchtower/shared/hubConfig.js';

export interface HubSenderDeps {
  getConfig(): HubConfig;
  listTokens(): { token: string; bundleId: string }[] | Promise<{ token: string; bundleId: string }[]>;
  removeToken(token: string): void;
  sendApns(cfg: HubConfig, token: string, msg: { title: string; body: string; data: Record<string, unknown> }, topic: string): Promise<{ ok: boolean; status: number; reason?: string }>;
  buildContext(instanceId: string, cwd: string, kind: EscalationKind): { title: string; body: string };
}

export function createHubSender(deps: HubSenderDeps) {
  return {
    async fire(instanceId: string, cwd: string, kind: EscalationKind): Promise<void> {
      const cfg = deps.getConfig();
      if (!cfg.enabled) return;
      if (!cfg.apnsKey || !cfg.apnsKeyId || !cfg.apnsTeamId) return;
      const { title, body } = deps.buildContext(instanceId, cwd, kind);
      const devices = await deps.listTokens();
      for (const { token, bundleId } of devices) {
        const r = await deps.sendApns(cfg, token, { title, body, data: { instanceId, kind } }, bundleId);
        if (!r.ok && (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')) {
          deps.removeToken(token);
        }
      }
    },
  };
}
