import { useCallback, useEffect, useState } from 'react';
import type { PrWatchInboxItem, PrHost } from '@watchtower/shared/ipcContract.js';

export function usePrWatch(): {
  items: PrWatchInboxItem[]; unread: number; error: string | null;
  refresh: () => Promise<void>;
  markSeen: (host: PrHost, repoKey: string, prNumber: number) => Promise<void>;
} {
  const [items, setItems] = useState<PrWatchInboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read path: never leave a failure silent (repo CLAUDE.md "Surfacing IPC
  // errors"). A rejected prWatch:list would otherwise show an empty inbox and
  // a permanently-zero unread badge; surface it via the hook's `error` field.
  const refresh = useCallback(async () => {
    try {
      const res = await window.watchtower.invoke('prWatch:list', {});
      setItems(res.items);
      setUnread(res.unread);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const markSeen = useCallback(async (host: PrHost, repoKey: string, prNumber: number) => {
    await window.watchtower.invoke('prWatch:markSeen', { host, repoKey, prNumber });
    await refresh();
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const off = window.watchtower.on('prWatchEvent', () => { void refresh(); });
    return () => { off(); };
  }, [refresh]);

  return { items, unread, error, refresh, markSeen };
}
