import { useCallback, useMemo, useState } from 'react';
import { Wake } from '../lib/wakePlugin.js';
import { performWake, wakeTargets, type WakeDeps } from './wake.js';
import type { Connection } from '../connection.js';

export type WakeStatus = 'idle' | 'sending' | 'sent' | 'error';

export function useWake(): { status: WakeStatus; wake(cfg: Connection): Promise<void> } {
  const [status, setStatus] = useState<WakeStatus>('idle');
  const deps = useMemo<WakeDeps>(
    () => ({ send: (payloadBase64, host, port) => Wake.wake({ payloadBase64, host, port }) }),
    [],
  );

  const wake = useCallback(async (cfg: Connection) => {
    if (!cfg.mac) return;
    const targets = wakeTargets(cfg);
    if (targets.length === 0) return;
    setStatus('sending');
    const r = await performWake(deps, { mac: cfg.mac, targets });
    setStatus(r.ok ? 'sent' : 'error');
  }, [deps]);

  return { status, wake };
}
