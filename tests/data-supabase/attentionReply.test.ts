// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const insert = vi.fn(async () => ({ error: null }));
vi.mock('../../packages/data-supabase/src/supabaseClient', () => ({ getSupabase: () => ({ from: () => ({ insert }) }) }));

import { renderHook, act } from '@testing-library/react';
import { useAttentionReply } from '../../packages/data-supabase/src/useAttentionReply';

describe('useAttentionReply', () => {
  it('inserts a user row and reports success', async () => {
    const { result } = renderHook(() => useAttentionReply());
    let ok = false;
    await act(async () => {
      ok = await result.current.sendReply('i1', 'c1', '1');
    });
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ instance_id: 'i1', role: 'user', reply_to: 'c1', body: '1' }),
    );
  });

  it('sets error and returns false on failure', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'x' } });
    const { result } = renderHook(() => useAttentionReply());
    let ok = true;
    await act(async () => {
      ok = await result.current.sendReply('i1', 'c1', 'no');
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to send reply.');
  });
});
