import { describe, it, expect } from 'vitest';
import { createAuthBlockDetector } from '../../orchestrator/authBlockDetector.js';
import type { OrchPush } from '@watchtower/shared/messagePort.js';

describe('auth-block → push wiring', () => {
  it('emits an authBlock OrchPush when the detector fires', () => {
    const pushes: OrchPush[] = [];
    const det = createAuthBlockDetector({
      emit: (e) => pushes.push({ kind: 'authBlock', payload: e }),
    });
    det.onHookEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'saml2aws login' } }, 'i1');
    expect(pushes).toEqual([
      { kind: 'authBlock', payload: { instanceId: 'i1', blocked: true, reason: expect.stringContaining('saml2aws') } },
    ]);
  });
});
