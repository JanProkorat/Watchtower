import { describe, it, expect } from 'vitest';
import { createAuthBlockDetector } from '../../orchestrator/authBlockDetector.js';

function setup() {
  const events: Array<{ instanceId: string; blocked: boolean; reason?: string }> = [];
  const det = createAuthBlockDetector({ emit: (e) => events.push(e) });
  return { det, events };
}

describe('authBlockDetector', () => {
  it('blocks on PreToolUse Bash saml2aws and clears on PostToolUse', () => {
    const { det, events } = setup();
    det.onHookEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'saml2aws login --profile x' } }, 'i1');
    det.onHookEvent('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'saml2aws login --profile x' } }, 'i1');
    expect(events).toEqual([
      { instanceId: 'i1', blocked: true, reason: expect.stringContaining('saml2aws') },
      { instanceId: 'i1', blocked: false },
    ]);
  });

  it('ignores non-matching Bash commands', () => {
    const { det, events } = setup();
    det.onHookEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls -la' } }, 'i1');
    expect(events).toEqual([]);
  });

  it('blocks on a pty SSO marker', () => {
    const { det, events } = setup();
    det.onPtyChunk('i2', 'Opening browser to https://localhost:8400/callback ...');
    expect(events).toEqual([{ instanceId: 'i2', blocked: true, reason: expect.any(String) }]);
  });

  it('dedupes repeated blocks and clears on UserPromptSubmit', () => {
    const { det, events } = setup();
    det.onPtyChunk('i3', 'saml2aws');
    det.onPtyChunk('i3', 'saml2aws again'); // no second emit
    det.onHookEvent('UserPromptSubmit', {}, 'i3');
    expect(events).toEqual([
      { instanceId: 'i3', blocked: true, reason: expect.any(String) },
      { instanceId: 'i3', blocked: false },
    ]);
  });
});
