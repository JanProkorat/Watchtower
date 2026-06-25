import { describe, it, expect } from 'vitest';
import type { OrchPush } from '@watchtower/shared/messagePort.js';

describe('authBlock push', () => {
  it('is assignable to OrchPush with instanceId/blocked/reason', () => {
    const push: OrchPush = {
      kind: 'authBlock',
      payload: { instanceId: 'i1', blocked: true, reason: 'saml2aws' },
    };
    expect(push.kind).toBe('authBlock');
    // reason is optional
    const cleared: OrchPush = { kind: 'authBlock', payload: { instanceId: 'i1', blocked: false } };
    expect(cleared.payload.blocked).toBe(false);
  });
});
