/**
 * Per-instance timers for the waiting-input → idle-notify escalation.
 * The state machine emits a `startQuietTimer` output when `Stop` arrives;
 * if the user doesn't engage within `durationMs`, the timer fires
 * `quietTimerFired` back into the state machine so it transitions to
 * `idle-notify` (which the notifier then turns into a macOS ping).
 */
export class QuietTimers {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private durationMs: number,
    private fire: (instanceId: string) => void,
  ) {}

  start(instanceId: string): void {
    this.clear(instanceId);
    const t = setTimeout(() => {
      this.timers.delete(instanceId);
      this.fire(instanceId);
    }, this.durationMs);
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

  setDuration(durationMs: number): void {
    this.durationMs = durationMs;
  }
}
