import type { EscalationKind } from './escalationGate.js';
import type { HubConfig } from '@watchtower/shared/hubConfig.js';
import type { OrchPush } from '@watchtower/shared/messagePort.js';

export interface HubSenderDeps {
  getConfig(): HubConfig;
  logPing(p: { instanceId: string; kind: EscalationKind; title: string; body: string }): number;
  listTokens(): string[];
  removeToken(token: string): void;
  emitPush(push: OrchPush): void;
  sendApns(cfg: HubConfig, token: string, msg: { title: string; body: string; data: Record<string, unknown> }): Promise<{ ok: boolean; status: number; reason?: string }>;
  buildContext(instanceId: string, cwd: string, kind: EscalationKind): { title: string; body: string };
}

export function createHubSender(deps: HubSenderDeps) {
  return {
    async fire(instanceId: string, cwd: string, kind: EscalationKind): Promise<void> {
      const cfg = deps.getConfig();
      if (!cfg.enabled) return;
      const { title, body } = deps.buildContext(instanceId, cwd, kind);
      const pingId = deps.logPing({ instanceId, kind, title, body });
      deps.emitPush({ kind: 'attentionPing', payload: { instanceId, pingId, kind, title, body } });
      if (!cfg.apnsKey || !cfg.apnsKeyId || !cfg.apnsTeamId) return;
      const data = { instanceId, pingId };
      for (const token of deps.listTokens()) {
        const r = await deps.sendApns(cfg, token, { title, body, data });
        if (!r.ok && (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')) {
          deps.removeToken(token);
        }
      }
    },
  };
}
