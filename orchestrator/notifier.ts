import { decide, type RuleContext } from './notificationRules.js';
import type { InstanceStatus } from '../shared/stateModel.js';

export interface NotifierEmitters {
  notify(payload: {
    instanceId: string;
    cwd: string;
    kind: 'waiting-permission' | 'idle-notify';
  }): void;
  clearAttention(instanceId: string): void;
  setBadge(count: number): void;
}

/**
 * Side-effect wrapper around the pure `decide()` notification rules.
 * Tracks UI focus + per-instance snooze, then on each transition runs
 * the rule and emits notify / clearAttention / badge events.
 */
export class Notifier {
  /** id of the instance whose tab is currently focused, or null. */
  private focused: string | null = null;
  /** Whether the app window itself is focused. */
  private windowFocused = true;
  /** instanceId | '*' → snoozedUntil epoch ms. */
  private snoozedUntil = new Map<string, number>();
  /** instanceIds currently in an attention state. */
  private flagged = new Set<string>();

  constructor(private emit: NotifierEmitters) {}

  setFocused(instanceId: string | null): void {
    this.focused = instanceId;
  }

  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
  }

  /** id of the focused instance, or null — used to acknowledge it on window refocus. */
  focusedId(): string | null {
    return this.focused;
  }

  /**
   * An instance is "focused" for notification purposes only when the window
   * is focused AND its tab is the active one. When the window is blurred the
   * user is looking elsewhere, so even the active instance should ping.
   */
  isFocused(instanceId: string): boolean {
    return this.windowFocused && this.focused === instanceId;
  }

  snooze(scope: string | '*', untilMs: number): void {
    this.snoozedUntil.set(scope, untilMs);
  }

  apply(
    instanceId: string,
    cwd: string,
    prev: InstanceStatus,
    next: InstanceStatus,
    now: number,
  ): void {
    const ctx: RuleContext = {
      focused: this.isFocused(instanceId),
      snoozedUntil: Math.max(this.snoozedUntil.get(instanceId) ?? 0, this.snoozedUntil.get('*') ?? 0),
    };
    const action = decide(prev, next, ctx, now);
    if (action.notify) {
      this.flagged.add(instanceId);
      this.emit.notify({ instanceId, cwd, kind: action.notify.kind });
    }
    if (action.clearAttention) {
      this.flagged.delete(instanceId);
      this.emit.clearAttention(instanceId);
    }
    if (action.badgeDelta !== 0) {
      this.emit.setBadge(this.flagged.size);
    }
  }

  clearAttention(instanceId: string): void {
    if (this.flagged.delete(instanceId)) {
      this.emit.clearAttention(instanceId);
      this.emit.setBadge(this.flagged.size);
    }
  }

  flaggedCount(): number {
    return this.flagged.size;
  }
}
