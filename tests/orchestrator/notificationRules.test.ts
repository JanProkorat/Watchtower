import { describe, it, expect } from 'vitest';
import { decide, type RuleContext } from '../../orchestrator/notificationRules.js';

const unfocused: RuleContext = { focused: false, snoozedUntil: 0 };
const focused: RuleContext = { focused: true, snoozedUntil: 0 };
const snoozed: RuleContext = { focused: false, snoozedUntil: 5000 };

describe('decide', () => {
  it('fires notification on transition to waiting-permission when unfocused', () => {
    const action = decide('working', 'waiting-permission', unfocused, 1000);
    expect(action.notify).toEqual({ kind: 'waiting-permission' });
    expect(action.badgeDelta).toBe(1);
    expect(action.clearAttention).toBeUndefined();
  });

  it('does not fire when the tab is focused', () => {
    const action = decide('working', 'waiting-permission', focused, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('does not fire when snoozed (snoozedUntil in the future)', () => {
    const action = decide('working', 'waiting-permission', snoozed, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('fires when the snooze window has passed', () => {
    const action = decide('working', 'waiting-permission', snoozed, 6000);
    expect(action.notify).toEqual({ kind: 'waiting-permission' });
  });

  it('fires idle-notify on waiting-input → idle-notify when unfocused', () => {
    const action = decide('waiting-input', 'idle-notify', unfocused, 1000);
    expect(action.notify).toEqual({ kind: 'idle-notify' });
    expect(action.badgeDelta).toBe(1);
  });

  it('fires on waiting-input → waiting-permission (waiting-input is pre-attention; permission ask escalates)', () => {
    // waiting-input is the pre-attention "Claude stopped typing, quietTimer running"
    // state — no notification has been shown yet. A permission ask arriving before
    // the timer expires is the first real attention event, so it fires.
    const action = decide('waiting-input', 'waiting-permission', unfocused, 1000);
    expect(action.notify).toEqual({ kind: 'waiting-permission' });
    expect(action.badgeDelta).toBe(1);
  });

  it('does NOT double-fire between true attention states (waiting-permission → idle-notify)', () => {
    // Both are real attention states — the user has already been notified
    // (waiting-permission fired). Re-entering attention shouldn't re-notify.
    const action = decide('waiting-permission', 'idle-notify', unfocused, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.clearAttention).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('clears attention on waiting-permission → working', () => {
    const action = decide('waiting-permission', 'working', unfocused, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.clearAttention).toBe(true);
    expect(action.badgeDelta).toBe(-1);
  });

  it('clears attention on idle-notify → working', () => {
    const action = decide('idle-notify', 'working', unfocused, 1000);
    expect(action.clearAttention).toBe(true);
    expect(action.badgeDelta).toBe(-1);
  });

  it('does nothing on working → waiting-input (we wait for the quietTimer to escalate)', () => {
    const action = decide('working', 'waiting-input', unfocused, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.clearAttention).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('does nothing on idempotent same-state transition', () => {
    const action = decide('waiting-permission', 'waiting-permission', unfocused, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('clears attention when crashed from an attention state', () => {
    const action = decide('waiting-permission', 'crashed', unfocused, 1000);
    expect(action.clearAttention).toBe(true);
    expect(action.badgeDelta).toBe(-1);
  });

  it('clears attention when finished from idle-notify', () => {
    const action = decide('idle-notify', 'finished', unfocused, 1000);
    expect(action.clearAttention).toBe(true);
    expect(action.badgeDelta).toBe(-1);
  });
});
