import {
  parseBlastRadiusPost,
  type BlastDecision,
  type BlastRadiusState,
} from '@watchtower/shared/blastRadius.js';

export const HOLD_EXPIRY_MS = 11 * 60 * 1000;

export interface BlastRadiusHooks {
  emit(state: BlastRadiusState): void;
  isKnownInstance(instanceId: string): boolean;
  /** Flag the instance as waiting on the user (idempotent). */
  hold(instanceId: string): void;
  /** Clear that flag (idempotent). */
  release(instanceId: string): void;
}

/** The blast-radius mod's pending hold, the user's answer and the last outcome, per instance, in memory. */
export class BlastRadiusStore {
  private byInstance = new Map<string, BlastRadiusState>();

  constructor(private readonly hooks: BlastRadiusHooks) {}

  ingest(body: unknown, instanceId: string, now: number): boolean {
    if (!this.hooks.isKnownInstance(instanceId)) return false;
    const post = parseBlastRadiusPost(body);
    if (!post) return false;
    const prev = this.byInstance.get(instanceId);
    // Release only the hold we flagged: a stray post must not clear Claude's own permission prompt.
    if (!post.hold && prev?.hold && post.outcome && post.outcome.id !== prev.hold.id) return true;
    const state: BlastRadiusState = post.hold
      ? { instanceId, hold: post.hold, decided: prev?.hold?.id === post.hold.id ? prev.decided : null, outcome: prev?.outcome ?? null, receivedAt: now }
      : { instanceId, hold: null, decided: null, outcome: post.outcome ?? prev?.outcome ?? null, receivedAt: now };
    this.byInstance.set(instanceId, state);
    if (state.hold) this.hooks.hold(instanceId);
    else if (prev?.hold) this.hooks.release(instanceId);
    this.hooks.emit(state);
    return true;
  }

  decide(instanceId: string, holdId: string, decision: BlastDecision, now: number): boolean {
    const s = this.live(instanceId, now);
    if (!s?.hold || s.hold.id !== holdId || s.decided) return false;
    const next = { ...s, decided: decision };
    this.byInstance.set(instanceId, next);
    this.hooks.emit(next);
    return true;
  }

  decisionFor(instanceId: string, holdId: string, now: number): BlastDecision | null | undefined {
    const s = this.live(instanceId, now);
    if (!s?.hold || s.hold.id !== holdId) return undefined;
    // A click into the pane resets its status; keep it flagged while the user still owes an answer.
    if (!s.decided) this.hooks.hold(instanceId);
    return s.decided;
  }

  get(instanceId: string, now: number): BlastRadiusState | null {
    return this.live(instanceId, now) ?? null;
  }

  sweep(now: number): void {
    for (const id of [...this.byInstance.keys()]) this.live(id, now);
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }

  /** The state with an expired hold dropped (and announced). */
  private live(instanceId: string, now: number): BlastRadiusState | undefined {
    const s = this.byInstance.get(instanceId);
    if (!s?.hold || now - s.receivedAt <= HOLD_EXPIRY_MS) return s;
    const next: BlastRadiusState = { ...s, hold: null, decided: null, receivedAt: now };
    this.byInstance.set(instanceId, next);
    this.hooks.release(instanceId);
    this.hooks.emit(next);
    return next;
  }
}
