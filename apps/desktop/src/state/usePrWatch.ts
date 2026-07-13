import { useCallback, useEffect, useState } from 'react';
import type { PrWatchInboxItem, PrHost } from '@watchtower/shared/ipcContract.js';

export function usePrWatch(): {
  items: PrWatchInboxItem[]; unread: number;
  refresh: () => Promise<void>;
  markSeen: (host: PrHost, repoKey: string, prNumber: number) => Promise<void>;
} {
  const [items, setItems] = useState<PrWatchInboxItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const res = await window.watchtower.invoke('prWatch:list', {});
    setItems(res.items);
    setUnread(res.unread);
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

  return { items, unread, refresh, markSeen };
}
