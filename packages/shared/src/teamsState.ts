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

export function deriveTeamsState(input: {
  open: boolean;
  audible: boolean;
  prevCallStartedAt: number | null;
  now: number;
}): TeamsPushState {
  const inCall = input.open && input.audible;
  let callStartedAt: number | null;
  if (!inCall) callStartedAt = null;
  else if (input.prevCallStartedAt != null) callStartedAt = input.prevCallStartedAt;
  else callStartedAt = input.now;
  return { open: input.open, inCall, callStartedAt };
}

/** Format an elapsed duration (ms) as MM:SS; minutes grow past 59. */
export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
