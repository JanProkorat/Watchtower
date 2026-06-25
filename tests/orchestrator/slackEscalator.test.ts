// SlackEscalator has been replaced by EscalationGate (orchestrator/escalationGate.ts).
// Core behaviour tests live in escalationGate.test.ts. This file retains the two
// focus-flip and timer-reset cases that were unique to the old SlackEscalator suite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EscalationGate, type EscalationParams } from '../../orchestrator/escalationGate.js';

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
