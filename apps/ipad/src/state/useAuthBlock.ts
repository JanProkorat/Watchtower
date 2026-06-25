import { useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';
import { applyAuthBlock } from './authBlockStore.js';

export function useAuthBlock(): { blockedIds: Set<string> } {
  const { bridge } = useConnection();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    return bridge.on('authBlock', (p) => {
      const e = p as { instanceId: string; blocked: boolean; reason?: string };
      setBlockedIds((prev) => applyAuthBlock(prev, e));
    });
  }, [bridge]);

  return { blockedIds };
}
