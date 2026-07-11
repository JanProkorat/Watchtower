import { useState, useCallback } from 'react';
import { getSupabase } from './supabaseClient.js';

export interface AttentionReplyHookResult {
  sendReply(instanceId: string, replyToSyncId: string, text: string): Promise<boolean>;
  pending: boolean;
  error: string | null;
}

/**
 * useAttentionReply — write-through user reply into `attention_messages`.
 *
 * Mirrors the optimistic pending/error shape of useWorklogMutations, but
 * there is no local list to reconcile: the escalation thread is re-fetched
 * by useAttentionThreads' poll/refresh, so this hook only owns the insert
 * itself plus a double-send guard while one is in flight.
 */
export function useAttentionReply(): AttentionReplyHookResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendReply = useCallback(
    async (instanceId: string, replyToSyncId: string, text: string): Promise<boolean> => {
      if (pending) return false;
      setPending(true);
      setError(null);
      try {
        const { error: e } = await getSupabase()
          .from('attention_messages')
          .insert({
            sync_id: crypto.randomUUID(),
            instance_id: instanceId,
            role: 'user',
            reply_to: replyToSyncId,
            body: text,
            created_at: new Date().toISOString(),
          });
        if (e) throw e;
        return true;
      } catch {
        setError('Failed to send reply.');
        return false;
      } finally {
        setPending(false);
      }
    },
    [pending],
  );

  return { sendReply, pending, error };
}
