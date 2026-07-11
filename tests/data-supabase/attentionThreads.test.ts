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
});
