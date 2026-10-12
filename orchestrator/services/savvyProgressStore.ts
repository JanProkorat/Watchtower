import {
  parseSavvySnapshot,
  type SavvyProgressState,
} from '@watchtower/shared/savvyProgress.js';

/**
 * Latest savvy-progress mod snapshot per instance, held in memory only: the
 * mod re-posts its whole state on every change and again on each session start,
 * so nothing here needs to survive a restart. Each accepted snapshot is pushed
 * to the renderer as-is (the mod already coalesces its bursts).
 */
export class SavvyProgressStore {
  private byInstance = new Map<string, SavvyProgressState>();

  constructor(
    private readonly emit: (state: SavvyProgressState) => void,
    private readonly isKnownInstance: (instanceId: string) => boolean,
  ) {}

  /** Validate and store a POSTed body; false when it was dropped. */
  ingest(body: unknown, instanceId: string, now: number): boolean {
    if (!this.isKnownInstance(instanceId)) return false;
    const snapshot = parseSavvySnapshot(body);
    if (!snapshot) return false;
    const state: SavvyProgressState = { instanceId, snapshot, receivedAt: now };
    this.byInstance.set(instanceId, state);
    this.emit(state);
    return true;
  }

  get(instanceId: string): SavvyProgressState | null {
    return this.byInstance.get(instanceId) ?? null;
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }
}
