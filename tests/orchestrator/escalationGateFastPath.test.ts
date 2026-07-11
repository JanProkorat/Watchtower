import { describe, it, expect, vi } from 'vitest';
import { EscalationGate } from '../../orchestrator/escalationGate';

const cfg = () => ({ escalateMs: 300_000, triggers: { permission: true, idle: true, crash: true }, armEnabled: true });

describe('EscalationGate fast-path follow-ups', () => {
  it('fires immediately for a remotely-engaged instance while unfocused', () => {
    const onFire = vi.fn();
    const gate = new EscalationGate(cfg, onFire);
    gate.setWindowFocused(false);
    gate.markRemotelyEngaged('i1');
    gate.apply('i1', '/c', 'working', 'waiting-permission');
    expect(onFire).toHaveBeenCalledWith('i1', '/c', 'waiting-permission'); // no timer wait
  });
  it('clears the remotely-engaged flag when the window regains focus', () => {
    const onFire = vi.fn();
    const gate = new EscalationGate(cfg, onFire);
    gate.setWindowFocused(false);
    gate.markRemotelyEngaged('i1');
    gate.setWindowFocused(true);
    gate.setWindowFocused(false);
    gate.apply('i1', '/c', 'working', 'waiting-permission');
    expect(onFire).not.toHaveBeenCalled(); // back to timer path
  });
});
