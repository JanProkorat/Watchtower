import { describe, it, expect, vi } from 'vitest';
import { routeReply, type InboundMessage } from '../../orchestrator/slackReply.js';

function deps(over: Partial<Parameters<typeof routeReply>[1]> = {}) {
  return {
    dmChannelId: 'D1',
    resolveInstance: (ts: string) => (ts === 'T1' ? 'inst-1' : null),
    deliver: vi.fn(),
    ack: vi.fn(),
    ...over,
  };
}

const base: InboundMessage = { channel: 'D1', text: 'yes', ts: 'M1', thread_ts: 'T1' };

describe('routeReply', () => {
  it('delivers a thread reply to the mapped instance and acks', () => {
    const d = deps();
    expect(routeReply(base, d)).toBe(true);
    expect(d.deliver).toHaveBeenCalledWith('inst-1', 'yes');
    expect(d.ack).toHaveBeenCalledWith('D1', 'T1');
  });
  it('ignores messages from other channels', () => {
    const d = deps();
    expect(routeReply({ ...base, channel: 'C-other' }, d)).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });
  it('ignores the bot\'s own messages and edits/subtypes', () => {
    const d = deps();
    expect(routeReply({ ...base, bot_id: 'B1' }, d)).toBe(false);
    expect(routeReply({ ...base, subtype: 'message_changed' }, d)).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });
  it('ignores replies whose thread maps to no instance', () => {
    const d = deps();
    expect(routeReply({ ...base, thread_ts: 'T-unknown' }, d)).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });
  it('falls back to ts when thread_ts is absent (top-level message)', () => {
    const d = deps({ resolveInstance: (ts) => (ts === 'M1' ? 'inst-1' : null) });
    expect(routeReply({ channel: 'D1', text: 'hi', ts: 'M1' }, d)).toBe(true);
    expect(d.deliver).toHaveBeenCalledWith('inst-1', 'hi');
  });
});
