import { parseFileTreeActivity, type FileTreeActivityState } from '@watchtower/shared/fileTree.js';

/** Latest filetree-mod activity per instance, in memory; the mod re-posts on every change. */
export class FileTreeActivityStore {
  private byInstance = new Map<string, FileTreeActivityState>();

  constructor(
    private readonly emit: (state: FileTreeActivityState) => void,
    private readonly isKnownInstance: (instanceId: string) => boolean,
  ) {}

  /** Validate and store a POSTed body; false when it was dropped. */
  ingest(body: unknown, instanceId: string, now: number): boolean {
    if (!this.isKnownInstance(instanceId)) return false;
    const snapshot = parseFileTreeActivity(body);
    if (!snapshot) return false;
    const state: FileTreeActivityState = { instanceId, snapshot, receivedAt: now };
    this.byInstance.set(instanceId, state);
    this.emit(state);
    return true;
  }

  get(instanceId: string): FileTreeActivityState | null {
    return this.byInstance.get(instanceId) ?? null;
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }
}
