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
