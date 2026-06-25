import { describe, it, expect } from 'vitest';
import { routeMessagingReply } from '../../orchestrator/messagingReply.js';

describe('routeMessagingReply', () => {
  it('delivers to the pty and marks the ping answered', () => {
    const writes: string[] = []; let answered: string | null = null;
    const ok = routeMessagingReply({ instanceId: 'i1', text: 'ano' }, {
      deliver: (id, text) => { writes.push(`${id}:${text}`); return true; },
      markAnswered: (id) => { answered = id; },
    });
    expect(ok).toBe(true);
    expect(writes).toEqual(['i1:ano']);
    expect(answered).toBe('i1');
  });
  it('returns false and does not mark answered when the instance is gone', () => {
    let answered = false;
    const ok = routeMessagingReply({ instanceId: 'dead', text: 'x' }, { deliver: () => false, markAnswered: () => { answered = true; } });
    expect(ok).toBe(false); expect(answered).toBe(false);
  });
});
