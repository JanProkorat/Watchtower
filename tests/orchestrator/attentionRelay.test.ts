import { describe, it, expect, vi } from 'vitest';
import { createAttentionRelay } from '../../orchestrator/attentionRelay';

function fakePg() {
  const inserts: any[] = [];
  const updates: any[] = [];
  let pending: any[] = [];
  return {
    inserts, updates, setPending: (r: any[]) => { pending = r; },
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO attention_messages/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/SELECT[\s\S]*role = 'user' AND injected_at IS NULL/.test(sql)) return { rows: pending };
      if (/UPDATE attention_messages SET injected_at/.test(sql)) { updates.push(params); pending = []; return { rows: [] }; }
      if (/SELECT 1 FROM attention_messages[\s\S]*role = 'claude'/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
}

describe('AttentionRelay', () => {
  it('writeClaudeMessage inserts a parsed claude row', async () => {
    const pg = fakePg();
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => 'Allow Bash(x)?\n1. Yes\n2. No',
      deliverReply: () => true, resolveLabel: () => 'watchtower',
      newId: () => 'uuid-1', now: () => '2026-07-11T00:00:00Z',
    });
    await relay.writeClaudeMessage('inst-1', '/repo/wt', 'waiting-permission');
    expect(pg.inserts.length).toBe(1);
    const params = pg.inserts[0] as any[];
    expect(params).toContain('inst-1');
    expect(params).toContain('watchtower');
    expect(params.some(p => typeof p === 'string' && p.includes('"number":1'))).toBe(true); // options JSON
  });

  it('pollOnce injects each pending user reply and stamps injected_at', async () => {
    const pg = fakePg();
    pg.setPending([{ sync_id: 'r1', instance_id: 'inst-1', body: '1' }]);
    const deliver = vi.fn(() => true);
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => '', deliverReply: deliver,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    const n = await relay.pollOnce();
    expect(n).toBe(1);
    expect(deliver).toHaveBeenCalledWith('inst-1', '1');
    expect(pg.updates.length).toBe(1);
  });

  it('is a no-op when pg is null', async () => {
    const relay = createAttentionRelay({
      pg: null, getSnapshot: async () => '', deliverReply: () => true,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    await relay.writeClaudeMessage('i', '/c', 'crashed');
    expect(await relay.pollOnce()).toBe(0);
  });
});
