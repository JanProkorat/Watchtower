import { parseReplay, type ReplayState } from '@watchtower/shared/replay.js';

/** Latest replay-theater turn per instance, in memory; the mod re-posts on every change. */
export class ReplayStore {
  private byInstance = new Map<string, ReplayState>();

  constructor(
    private readonly emit: (state: ReplayState) => void,
    private readonly isKnownInstance: (instanceId: string) => boolean,
  ) {}

  /** Validate and store a POSTed body; false when it was dropped. */
  ingest(body: unknown, instanceId: string, now: number): boolean {
    if (!this.isKnownInstance(instanceId)) return false;
    const snapshot = parseReplay(body);
    if (!snapshot) return false;
    const state: ReplayState = { instanceId, snapshot, receivedAt: now };
    this.byInstance.set(instanceId, state);
    this.emit(state);
    return true;
  }

  get(instanceId: string): ReplayState | null {
    return this.byInstance.get(instanceId) ?? null;
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }
}
