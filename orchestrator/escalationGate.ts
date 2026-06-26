import type { InstanceStatus } from '@watchtower/shared/stateModel.js';

export type EscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

export interface EscalationParams {
  escalateMs: number;
  triggers: { permission: boolean; idle: boolean; crash: boolean };
  armEnabled: boolean; // arm timers when ANY escalation channel is enabled
}

const ATTENTION: ReadonlyArray<InstanceStatus> = ['waiting-permission', 'idle-notify'];

export class EscalationGate {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private windowFocused = true;

  constructor(
    private getParams: () => EscalationParams,
    private onFire: (instanceId: string, cwd: string, kind: EscalationKind) => void,
  ) {}

  setWindowFocused(focused: boolean): void { this.windowFocused = focused; }

  apply(instanceId: string, cwd: string, prev: InstanceStatus, next: InstanceStatus): void {
    if (prev === next) return;
    const p = this.getParams();
    if (!p.armEnabled) { this.clear(instanceId); return; }

    if (next === 'crashed') {
      if (p.triggers.crash && !this.windowFocused) this.onFire(instanceId, cwd, 'crashed');
      this.clear(instanceId);
      return;
    }

    const entered = ATTENTION.includes(next) && !ATTENTION.includes(prev);
    const left = ATTENTION.includes(prev) && !ATTENTION.includes(next);
    if (left) { this.clear(instanceId); return; }
    if (!entered) return;

    const kind: EscalationKind = next === 'waiting-permission' ? 'waiting-permission' : 'idle-notify';
    if (kind === 'waiting-permission' && !p.triggers.permission) return;
    if (kind === 'idle-notify' && !p.triggers.idle) return;

    this.clear(instanceId);
    const timer = setTimeout(() => {
      this.timers.delete(instanceId);
      if (!this.windowFocused) this.onFire(instanceId, cwd, kind);
    }, p.escalateMs);
    this.timers.set(instanceId, timer);
  }

  clear(instanceId: string): void {
    const t = this.timers.get(instanceId);
    if (t) { clearTimeout(t); this.timers.delete(instanceId); }
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
