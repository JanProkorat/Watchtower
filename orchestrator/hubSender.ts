import type { EscalationKind } from './escalationGate.js';
import type { HubConfig } from '@watchtower/shared/hubConfig.js';

export interface HubSenderDeps {
  getConfig(): HubConfig;
  listTokens(): string[];
  removeToken(token: string): void;
  sendApns(cfg: HubConfig, token: string, msg: { title: string; body: string; data: Record<string, unknown> }): Promise<{ ok: boolean; status: number; reason?: string }>;
  buildContext(instanceId: string, cwd: string, kind: EscalationKind): { title: string; body: string };
}

export function createHubSender(deps: HubSenderDeps) {
  return {
    async fire(instanceId: string, cwd: string, kind: EscalationKind): Promise<void> {
      const cfg = deps.getConfig();
      if (!cfg.enabled) return;
      if (!cfg.apnsKey || !cfg.apnsKeyId || !cfg.apnsTeamId) return;
      const { title, body } = deps.buildContext(instanceId, cwd, kind);
      for (const token of deps.listTokens()) {
        const r = await deps.sendApns(cfg, token, { title, body, data: { instanceId } });
        if (!r.ok && (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')) {
          deps.removeToken(token);
        }
      }
    },
  };
}
