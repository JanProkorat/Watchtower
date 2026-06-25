import { useCallback, useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';
import { applyPing, type Ping } from './pingStore.js';

export function usePings(): {
  ping: Ping | null;
  clear: () => void;
  seedPing: (p: Ping) => void;
} {
  const { bridge } = useConnection();
  const [ping, setPing] = useState<Ping | null>(null);

  useEffect(() => {
    return bridge.on('attentionPing', (p) => {
      const e = p as Ping;
      setPing((prev) => applyPing(prev, e));
    });
  }, [bridge]);

  const clear = useCallback(() => setPing(null), []);
  const seedPing = useCallback((p: Ping) => {
    setPing((prev) => applyPing(prev, p));
  }, []);

  return { ping, clear, seedPing };
}
