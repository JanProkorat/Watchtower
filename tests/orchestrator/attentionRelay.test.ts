import { describe, it, expect, vi } from 'vitest';
import { createAttentionRelay } from '../../orchestrator/attentionRelay';

function fakePg() {
  const inserts: any[] = [];
  const updates: any[] = [];
  const deletes: [string, unknown[] | undefined][] = [];
  let pending: any[] = [];
  let deleteRows: any[] = [];
  return {
    inserts, updates, deletes,
    setPending: (r: any[]) => { pending = r; },
    setDeleteRows: (r: any[]) => { deleteRows = r; },
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO attention_messages/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/DELETE FROM attention_messages/.test(sql)) { deletes.push([sql, params]); return { rows: deleteRows }; }
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
    // UPDATE carried the right params: [now(), sync_id]
    expect(pg.updates[0]).toContain('r1');
    expect(pg.updates[0]).toContain('now');
  });

  it('stamps a dead reply (deliverReply false) exactly once — never retried', async () => {
    const pg = fakePg();
    pg.setPending([{ sync_id: 'r1', instance_id: 'inst-gone', body: '2' }]);
    const deliver = vi.fn(() => false); // instance gone
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => '', deliverReply: deliver,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    const n = await relay.pollOnce();
    expect(n).toBe(1);
    expect(deliver).toHaveBeenCalledWith('inst-gone', '2');
    // injected_at UPDATE ran exactly once even though delivery failed:
    // locks in that a dead reply is stamped and never retried forever.
    expect(pg.updates.length).toBe(1);
    expect(pg.updates[0]).toContain('r1');
  });

  it('is a no-op when pg is null', async () => {
    const relay = createAttentionRelay({
      pg: null, getSnapshot: async () => '', deliverReply: () => true,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    await relay.writeClaudeMessage('i', '/c', 'crashed');
    expect(await relay.pollOnce()).toBe(0);
  });

  it('pruneClosedThreads deletes closed threads older than the cutoff and returns the count', async () => {
    const pg = fakePg();
    pg.setDeleteRows([{ sync_id: 'a' }, { sync_id: 'b' }]);
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => '', deliverReply: () => true,
      resolveLabel: () => 'x', newId: () => 'id', now: () => '2026-07-11T00:00:00.000Z',
    });
    const n = await relay.pruneClosedThreads();
    expect(n).toBe(2);
    expect(pg.deletes.length).toBe(1);
    const [sql, params] = pg.deletes[0];
    expect(sql).toMatch(/DELETE FROM attention_messages/);
    expect(sql).toMatch(/closed_at IS NOT NULL/);
    expect(sql).toMatch(/closed_at < \$1/);
    // default 14-day cutoff computed from deps.now(), not Date.now()
    expect(params?.[0]).toBe('2026-06-27T00:00:00.000Z');
  });

  it('pruneClosedThreads honors an explicit olderThanDays argument', async () => {
    const pg = fakePg();
    pg.setDeleteRows([{ sync_id: 'a' }]);
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => '', deliverReply: () => true,
      resolveLabel: () => 'x', newId: () => 'id', now: () => '2026-07-11T00:00:00.000Z',
    });
    const n = await relay.pruneClosedThreads(1);
    expect(n).toBe(1);
    expect(pg.deletes[0][1]?.[0]).toBe('2026-07-10T00:00:00.000Z');
  });

  it('pruneClosedThreads is a no-op (no query, returns 0) when pg is null', async () => {
    const relay = createAttentionRelay({
      pg: null, getSnapshot: async () => '', deliverReply: () => true,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    expect(await relay.pruneClosedThreads()).toBe(0);
  });
});
