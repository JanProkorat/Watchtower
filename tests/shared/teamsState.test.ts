import { describe, it, expect } from 'vitest';
import { deriveTeamsState, formatCallDuration } from '@watchtower/shared/teamsState.js';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';

describe('deriveTeamsState', () => {
  it('is closed and not-in-call when the window is closed', () => {
    expect(deriveTeamsState({ open: false, audible: true, prevCallStartedAt: 42, now: 100 }))
      .toEqual({ open: false, inCall: false, callStartedAt: null });
  });

  it('is open but not in a call when the window is silent', () => {
    expect(deriveTeamsState({ open: true, audible: false, prevCallStartedAt: null, now: 100 }))
      .toEqual({ open: true, inCall: false, callStartedAt: null });
  });

  it('starts the call clock when audio first begins', () => {
    expect(deriveTeamsState({ open: true, audible: true, prevCallStartedAt: null, now: 1000 }))
      .toEqual({ open: true, inCall: true, callStartedAt: 1000 });
  });

  it('keeps the original start time while the call continues', () => {
    expect(deriveTeamsState({ open: true, audible: true, prevCallStartedAt: 1000, now: 5000 }))
      .toEqual({ open: true, inCall: true, callStartedAt: 1000 });
  });

  it('resets the clock when audio stops', () => {
    expect(deriveTeamsState({ open: true, audible: false, prevCallStartedAt: 1000, now: 5000 }))
      .toEqual({ open: true, inCall: false, callStartedAt: null });
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
  it('registers teams:open and teams:close as electron-only', () => {
    expect(ELECTRON_ONLY_KINDS.has('teams:open')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('teams:close')).toBe(true);
  });
});
