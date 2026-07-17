import { useCallback, useEffect, useState } from 'react';
import { invoke } from './ipc';

export interface StatuslineCaptureState {
  enabled: boolean;
  available: boolean;
  loading: boolean;
  save(enabled: boolean): Promise<void>;
}

export function useStatuslineCapture(): StatuslineCaptureState {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke('statuslineCapture:status', {});
      setEnabled(res.enabled);
      setAvailable(res.available);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: boolean) => {
    await invoke('statuslineCapture:set', { enabled: next });
    setEnabled(next);
  }, []);

  return { enabled, available, loading, save };
}
