// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../../packages/data-supabase/src/supabaseClient', () => ({ getSupabase: () => ({ from }) }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {} } }), { virtual: true });

import { renderHook, waitFor } from '@testing-library/react';
import { useAttentionThreads } from '../../packages/data-supabase/src/useAttentionThreads';

describe('useAttentionThreads', () => {
  beforeEach(() => from.mockReset());
  it('fetches, groups, and counts unanswered', async () => {
    from.mockReturnValue({
      select: () => ({ order: () => Promise.resolve({ data: [
        { sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: 'idle-notify', body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' },
      ], error: null }) }),
    });
    const { result } = renderHook(() => useAttentionThreads());
    await waitFor(() => expect(result.current.threads.length).toBe(1));
    expect(result.current.unansweredCount).toBe(1);
  });
});
