import { describe, it, expect } from 'vitest';
import { mapAttentionRow, groupThreads } from '../../packages/data-supabase/src/attentionCache';

describe('attention mappers', () => {
  it('maps snake_case row to camelCase, parsing options', () => {
    const m = mapAttentionRow({
      sync_id: 's1', instance_id: 'i1', project_label: 'wt', role: 'claude',
      kind: 'waiting-permission', body: 'Q?', options: [{ number: 1, label: 'Yes' }],
      reply_to: null, injected_at: null, closed_at: null, created_at: 't0',
    });
    expect(m.instanceId).toBe('i1');
    expect(m.options[0].label).toBe('Yes');
  });
  it('groups by instance, orders by createdAt, flags unanswered', () => {
    const rows = [
      mapAttentionRow({ sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: 'idle-notify', body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' }),
    ];
    const [t] = groupThreads(rows);
    expect(t.instanceId).toBe('i1');
    expect(t.label).toBe('wt');
    expect(t.unanswered).toBe(true);
  });
  it('marks answered when a user row replies to the latest claude row', () => {
    const rows = [
      mapAttentionRow({ sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: null, body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' }),
      mapAttentionRow({ sync_id: 'u1', instance_id: 'i1', project_label: 'wt', role: 'user', kind: null, body: '1', options: [], reply_to: 'c1', injected_at: 't', closed_at: null, created_at: '2' }),
    ];
    expect(groupThreads(rows)[0].unanswered).toBe(false);
  });
  it('parses options given as a JSON string', () => {
    const m = mapAttentionRow({
      sync_id: 's1', instance_id: 'i1', project_label: 'wt', role: 'claude',
      kind: 'waiting-permission', body: 'Q?', options: '[{"number":1,"label":"Yes"}]',
      reply_to: null, injected_at: null, closed_at: null, created_at: 't0',
    });
    expect(m.options).toEqual([{ number: 1, label: 'Yes' }]);
  });
  it('marks a closed thread as closed and not unanswered', () => {
    const rows = [
      mapAttentionRow({ sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: 'idle-notify', body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: 'tc', created_at: '1' }),
    ];
    const [t] = groupThreads(rows);
    expect(t.closed).toBe(true);
    expect(t.unanswered).toBe(false);
  });
  it('groups two distinct instanceIds into separate threads', () => {
    const rows = [
      mapAttentionRow({ sync_id: 'a1', instance_id: 'iA', project_label: 'projA', role: 'claude', kind: null, body: 'Qa', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' }),
      mapAttentionRow({ sync_id: 'b1', instance_id: 'iB', project_label: 'projB', role: 'claude', kind: null, body: 'Qb', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '2' }),
    ];
    const threads = groupThreads(rows);
    expect(threads).toHaveLength(2);
    const byInstance = Object.fromEntries(threads.map(t => [t.instanceId, t]));
    expect(byInstance['iA'].label).toBe('projA');
    expect(byInstance['iA'].messages).toHaveLength(1);
    expect(byInstance['iB'].label).toBe('projB');
    expect(byInstance['iB'].messages).toHaveLength(1);
  });
});
