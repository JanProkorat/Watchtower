import { describe, it, expect } from 'vitest';
import {
  deriveTeamsState,
  formatCallDuration,
  CALL_SILENCE_GRACE_MS,
} from '@watchtower/shared/teamsState.js';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';

describe('deriveTeamsState', () => {
  it('is closed and not-in-call when the window is closed', () => {
    expect(deriveTeamsState({ open: false, audible: true, prevCallStartedAt: 42, now: 100 }))
      .toEqual({ open: false, inCall: false, callStartedAt: null, lastAudibleAt: null });
  });

  it('is open but not in a call when the window is silent', () => {
    expect(deriveTeamsState({ open: true, audible: false, prevCallStartedAt: null, now: 100 }))
      .toEqual({ open: true, inCall: false, callStartedAt: null, lastAudibleAt: null });
  });

  it('starts the call clock when audio first begins', () => {
    expect(deriveTeamsState({ open: true, audible: true, prevCallStartedAt: null, now: 1000 }))
      .toEqual({ open: true, inCall: true, callStartedAt: 1000, lastAudibleAt: 1000 });
  });

  it('keeps the original start time while the call continues', () => {
    expect(deriveTeamsState({ open: true, audible: true, prevCallStartedAt: 1000, now: 5000 }))
      .toEqual({ open: true, inCall: true, callStartedAt: 1000, lastAudibleAt: 5000 });
  });

  it('resets the clock when audio stops with no known audible moment', () => {
    expect(deriveTeamsState({ open: true, audible: false, prevCallStartedAt: 1000, now: 5000 }))
      .toEqual({ open: true, inCall: false, callStartedAt: null, lastAudibleAt: null });
  });

  // Chromium reports a WebContents as non-audible after ~2s below its silence
  // threshold, which happens constantly during a real call (nobody speaking).
  // The pill must not flicker or restart its timer on those gaps.
  it('stays in the call through a silence shorter than the grace period', () => {
    expect(
      deriveTeamsState({
        open: true,
        audible: false,
        prevCallStartedAt: 1000,
        prevLastAudibleAt: 4000,
        now: 4000 + CALL_SILENCE_GRACE_MS - 1,
      }),
    ).toEqual({
      open: true,
      inCall: true,
      callStartedAt: 1000,
      lastAudibleAt: 4000,
    });
  });

  it('keeps the original start time when audio resumes after a silence gap', () => {
    const silent = deriveTeamsState({
      open: true,
      audible: false,
      prevCallStartedAt: 1000,
      prevLastAudibleAt: 4000,
      now: 10_000,
    });
    const resumed = deriveTeamsState({
      open: true,
      audible: true,
      prevCallStartedAt: silent.callStartedAt,
      prevLastAudibleAt: silent.lastAudibleAt,
      now: 12_000,
    });
    expect(resumed).toEqual({
      open: true,
      inCall: true,
      callStartedAt: 1000,
      lastAudibleAt: 12_000,
    });
  });

  it('ends the call once the silence outlasts the grace period', () => {
    expect(
      deriveTeamsState({
        open: true,
        audible: false,
        prevCallStartedAt: 1000,
        prevLastAudibleAt: 4000,
        now: 4000 + CALL_SILENCE_GRACE_MS,
      }),
    ).toEqual({ open: true, inCall: false, callStartedAt: null, lastAudibleAt: null });
  });

  it('starts a fresh clock for a call that begins after a lapsed grace period', () => {
    expect(
      deriveTeamsState({
        open: true,
        audible: true,
        prevCallStartedAt: null,
        prevLastAudibleAt: null,
        now: 90_000,
      }),
    ).toEqual({ open: true, inCall: true, callStartedAt: 90_000, lastAudibleAt: 90_000 });
  });

  it('drops the call immediately when the window closes mid-silence', () => {
    expect(
      deriveTeamsState({
        open: false,
        audible: false,
        prevCallStartedAt: 1000,
        prevLastAudibleAt: 4000,
        now: 5000,
      }),
    ).toEqual({ open: false, inCall: false, callStartedAt: null, lastAudibleAt: null });
  });

  it('honours an explicit grace override', () => {
    expect(
      deriveTeamsState({
        open: true,
        audible: false,
        prevCallStartedAt: 1000,
        prevLastAudibleAt: 4000,
        now: 9000,
        graceMs: 1000,
      }),
    ).toEqual({ open: true, inCall: false, callStartedAt: null, lastAudibleAt: null });
  });
});

describe('formatCallDuration', () => {
  it('formats seconds as MM:SS', () => {
    expect(formatCallDuration(0)).toBe('00:00');
    expect(formatCallDuration(134_000)).toBe('02:14');
  });
  it('lets minutes grow past 59', () => {
    expect(formatCallDuration(3_661_000)).toBe('61:01');
  });
  it('never returns negative time', () => {
    expect(formatCallDuration(-5_000)).toBe('00:00');
  });
});

describe('teams IPC kinds', () => {
  it('registers teams:close as electron-only', () => {
    expect(ELECTRON_ONLY_KINDS.has('teams:close')).toBe(true);
  });
});
