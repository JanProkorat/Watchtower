import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EscalationGate, type EscalationParams } from '../../orchestrator/escalationGate.js';

const PARAMS: EscalationParams = { escalateMs: 1000, triggers: { permission: true, idle: true, crash: true }, armEnabled: true };

describe('EscalationGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(p: Partial<EscalationParams> = {}) {
    const fired: Array<[string, string, string]> = [];
    const gate = new EscalationGate(() => ({ ...PARAMS, ...p }), (id, cwd, kind) => fired.push([id, cwd, kind]));
    return { gate, fired };
  }

  it('fires after escalateMs when entering attention while unfocused', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([['i1', '/x', 'waiting-permission']]);
  });

  it('does NOT fire if focused at fire time', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'idle-notify');
    gate.setWindowFocused(true);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it('cancels the timer when leaving attention', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    gate.apply('i1', '/x', 'waiting-permission', 'working');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it('fires crashed immediately (no timer) when unfocused', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'crashed');
    expect(fired).toEqual([['i1', '/x', 'crashed']]);
  });

  it('does not arm when armEnabled is false', () => {
    const { gate, fired } = setup({ armEnabled: false });
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it('respects a disabled trigger', () => {
    const { gate, fired } = setup({ triggers: { permission: false, idle: true, crash: true } });
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });
});

// Focus-flip + timer-reset cases (moved verbatim from slackEscalator.test.ts)
const BASE: EscalationParams = {
  escalateMs: 1000,
  triggers: { permission: true, idle: true, crash: true },
  armEnabled: true,
};

function makeGate(overrides: Partial<EscalationParams> = {}) {
  const fired: Array<{ id: string; kind: string }> = [];
  const gate = new EscalationGate(
    () => ({ ...BASE, ...overrides }),
    (id, _cwd, kind) => fired.push({ id, kind }),
  );
  return { gate, fired };
}

describe('EscalationGate (focus-flip + timer-reset)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('still fires when the window is blurred AFTER arming (focus flip down)', () => {
    const { gate, fired } = makeGate();
    gate.setWindowFocused(true);
    gate.apply('a', '/cwd', 'working', 'waiting-permission'); // armed while focused
    gate.setWindowFocused(false); // user walks away before it fires
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([{ id: 'a', kind: 'waiting-permission' }]);
  });

  it('re-arming on a fresh attention entry resets the timer', () => {
    const { gate, fired } = makeGate();
    gate.setWindowFocused(false);
    gate.apply('a', '/cwd', 'working', 'waiting-permission'); // arm #1
    vi.advanceTimersByTime(600);
    gate.apply('a', '/cwd', 'waiting-permission', 'working');  // engaged, cancels
    gate.apply('a', '/cwd', 'working', 'idle-notify');         // arm #2 (fresh 1000ms)
    vi.advanceTimersByTime(600); // 1200ms since arm#1 but only 600ms since arm#2
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(400); // now 1000ms since arm#2
    expect(fired).toEqual([{ id: 'a', kind: 'idle-notify' }]);
  });
});
