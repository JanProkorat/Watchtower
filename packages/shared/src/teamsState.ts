/**
 * Pure state helpers for the Teams-calling feature. Kept free of any Electron
 * import so it can be unit-tested under the node vitest environment and shared
 * between electron-main (deriveTeamsState) and the renderer (formatCallDuration).
 */

export interface TeamsPushState {
  /** Whether the dedicated Teams window is currently open. */
  open: boolean;
  /** Whether we believe a call is active (open && the WebContents is audible). */
  inCall: boolean;
  /** Epoch ms when the current call became audible, or null when not in a call. */
  callStartedAt: number | null;
}

/** Internal call state — the pushed shape plus the audibility bookkeeping. */
export interface TeamsCallState extends TeamsPushState {
  /** Last moment audio was observed audible, or null when not in a call. */
  lastAudibleAt: number | null;
}

/**
 * How long a call survives silence. Chromium's AudioStreamMonitor reports a
 * WebContents as non-audible after ~2s below its silence threshold, so a live
 * call goes "silent" whenever nobody is speaking. Without this grace the pill
 * flickered idle and restarted its timer on every pause in the conversation.
 * The cost is that a call the user hung up on (window left open) keeps showing
 * for up to this long.
 */
export const CALL_SILENCE_GRACE_MS = 60_000;

export function deriveTeamsState(input: {
  open: boolean;
  audible: boolean;
  prevCallStartedAt: number | null;
  /** Previous `lastAudibleAt`; omit to treat the call as having no audio history. */
  prevLastAudibleAt?: number | null;
  now: number;
  graceMs?: number;
}): TeamsCallState {
  const graceMs = input.graceMs ?? CALL_SILENCE_GRACE_MS;
  const ended = { open: input.open, inCall: false, callStartedAt: null, lastAudibleAt: null };
  if (!input.open) return ended;

  if (input.audible) {
    return {
      open: true,
      inCall: true,
      callStartedAt: input.prevCallStartedAt ?? input.now,
      lastAudibleAt: input.now,
    };
  }

  // Silent: hold the call (and its clock) until the silence outlasts the grace.
  const lastAudibleAt = input.prevLastAudibleAt ?? null;
  if (input.prevCallStartedAt == null || lastAudibleAt == null) return ended;
  if (input.now - lastAudibleAt >= graceMs) return ended;
  return { open: true, inCall: true, callStartedAt: input.prevCallStartedAt, lastAudibleAt };
}

/** Format an elapsed duration (ms) as MM:SS; minutes grow past 59. */
export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
