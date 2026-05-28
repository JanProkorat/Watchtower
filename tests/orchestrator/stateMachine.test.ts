import { describe, it, expect } from 'vitest';
import { transition } from '../../orchestrator/stateMachine.js';
import type { InstanceStatus } from '../../shared/stateModel.js';
import type { StateEvent, StateOutput } from '../../shared/events.js';

type Case = {
  name: string;
  from: InstanceStatus;
  event: StateEvent;
  to: InstanceStatus;
  outputs?: StateOutput[];
};

const cases: Case[] = [
  {
    name: 'spawning → working on sessionStart (stores session id)',
    from: 'spawning',
    event: { kind: 'sessionStart', sessionId: 'abc' },
    to: 'working',
    outputs: [{ kind: 'storeClaudeSessionId', sessionId: 'abc' }],
  },
  {
    name: 'working → waiting-permission on notificationHook',
    from: 'working',
    event: { kind: 'notificationHook' },
    to: 'waiting-permission',
  },
  {
    name: 'working → waiting-input on stopHook (starts quietTimer)',
    from: 'working',
    event: { kind: 'stopHook' },
    to: 'waiting-input',
    outputs: [{ kind: 'startQuietTimer' }],
  },
  {
    name: 'waiting-input → idle-notify on quietTimerFired',
    from: 'waiting-input',
    event: { kind: 'quietTimerFired' },
    to: 'idle-notify',
  },
  {
    name: 'waiting-permission → working on userPromptSubmit (clears attention + timer)',
    from: 'waiting-permission',
    event: { kind: 'userPromptSubmit' },
    to: 'working',
    outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }],
  },
  {
    name: 'waiting-input → working on userPromptSubmit',
    from: 'waiting-input',
    event: { kind: 'userPromptSubmit' },
    to: 'working',
    outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }],
  },
  {
    name: 'idle-notify → working on userPromptSubmit',
    from: 'idle-notify',
    event: { kind: 'userPromptSubmit' },
    to: 'working',
    outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }],
  },
  {
    name: 'waiting-input → working on ptyData',
    from: 'waiting-input',
    event: { kind: 'ptyData' },
    to: 'working',
  },
  {
    name: 'idle-notify → working on ptyData',
    from: 'idle-notify',
    event: { kind: 'ptyData' },
    to: 'working',
  },
  {
    name: 'working stays on ptyData (no-op)',
    from: 'working',
    event: { kind: 'ptyData' },
    to: 'working',
  },
  {
    name: 'working → finished on ptyExit(0)',
    from: 'working',
    event: { kind: 'ptyExit', code: 0 },
    to: 'finished',
  },
  {
    name: 'working → crashed on ptyExit(non-zero)',
    from: 'working',
    event: { kind: 'ptyExit', code: 1 },
    to: 'crashed',
  },
  {
    name: 'waiting-input → crashed on ptyExit(137)',
    from: 'waiting-input',
    event: { kind: 'ptyExit', code: 137 },
    to: 'crashed',
  },
  {
    // Claude fires SessionEnd during /clear, /compact, auto-compaction and
    // /resume — not only on true process exit — so the state machine must
    // not treat it as terminal. ptyExit is the authoritative signal.
    name: 'working stays on sessionEnd (mid-life rollover, not terminal)',
    from: 'working',
    event: { kind: 'sessionEnd' },
    to: 'working',
  },
  {
    name: 'waiting-input stays on sessionEnd (mid-life rollover, not terminal)',
    from: 'waiting-input',
    event: { kind: 'sessionEnd' },
    to: 'waiting-input',
  },
  {
    name: 'waiting-input → working on tabFocused (cancels attention + timer)',
    from: 'waiting-input',
    event: { kind: 'tabFocused' },
    to: 'working',
    outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }],
  },
  {
    name: 'waiting-permission stays on stopHook (permission trumps input)',
    from: 'waiting-permission',
    event: { kind: 'stopHook' },
    to: 'waiting-permission',
  },
  {
    name: 'waiting-permission stays on quietTimerFired (only waiting-input transitions)',
    from: 'waiting-permission',
    event: { kind: 'quietTimerFired' },
    to: 'waiting-permission',
  },
];

describe('transition', () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = transition(c.from, c.event);
      expect(result.state).toBe(c.to);
      if (c.outputs) expect(result.outputs).toEqual(c.outputs);
    });
  }

  it('is a no-op for events in terminal states', () => {
    expect(transition('finished', { kind: 'ptyData' }).state).toBe('finished');
    expect(transition('crashed', { kind: 'userPromptSubmit' }).state).toBe('crashed');
    expect(transition('suspended', { kind: 'notificationHook' }).state).toBe('suspended');
    expect(transition('resuming', { kind: 'stopHook' }).state).toBe('resuming');
  });

  it('sessionStart on non-spawning state stays put but still records the session id', () => {
    const result = transition('working', { kind: 'sessionStart', sessionId: 'xyz' });
    expect(result.state).toBe('working');
    expect(result.outputs).toEqual([{ kind: 'storeClaudeSessionId', sessionId: 'xyz' }]);
  });
});
