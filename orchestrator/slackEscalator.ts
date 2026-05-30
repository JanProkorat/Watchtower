import type { InstanceStatus } from '../shared/stateModel.js';
import type { SlackConfig } from '../shared/slackConfig.js';

export type SlackEscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

export interface SlackEscalatorEmitters {
  /** Fire-and-forget: the orchestrator turns this into an async Slack post. */
  post(instanceId: string, cwd: string, kind: SlackEscalationKind): void;
}

// NOTE: assumes the two attention states are never entered directly from one
// another (the state machine only reaches idle-notify from waiting-input), so
// a single armed timer per instance can't carry the wrong kind.
const ATTENTION: ReadonlyArray<InstanceStatus> = ['waiting-permission', 'idle-notify'];

/**
 * Second escalation tier on top of the macOS Notifier: when an instance is
 * waiting on the user and the app window is unfocused, ping Slack after
 * `escalateMs`. Engagement (which moves the instance out of an attention
 * state) cancels the pending timer. Crashes ping immediately.
 */
export class SlackEscalator {
  private timers = new Map<string, NodeJS.Timeout>();
  private windowFocused = true;

  constructor(
    private getConfig: () => SlackConfig,
    private emit: SlackEscalatorEmitters,
  ) {}

  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
  }

  apply(instanceId: string, cwd: string, prev: InstanceStatus, next: InstanceStatus): void {
    if (prev === next) return;
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      this.clear(instanceId);
      return;
    }

    if (next === 'crashed') {
      if (cfg.triggers.crash && !this.windowFocused) this.emit.post(instanceId, cwd, 'crashed');
      this.clear(instanceId);
      return;
    }

    const entered = ATTENTION.includes(next) && !ATTENTION.includes(prev);
    const left = ATTENTION.includes(prev) && !ATTENTION.includes(next);

    if (left) {
      this.clear(instanceId);
      return;
    }
    if (!entered) return;

    const wanted =
      (next === 'waiting-permission' && cfg.triggers.permission) ||
      (next === 'idle-notify' && cfg.triggers.idle);
    if (!wanted) return;

    const kind = next as SlackEscalationKind;
    this.clear(instanceId);
    const t = setTimeout(() => {
      this.timers.delete(instanceId);
      if (!this.windowFocused) this.emit.post(instanceId, cwd, kind);
    }, cfg.escalateMs);
    this.timers.set(instanceId, t);
  }

  clear(instanceId: string): void {
    const existing = this.timers.get(instanceId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(instanceId);
    }
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
