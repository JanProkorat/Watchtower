import { useCallback, useEffect, useState } from 'react';
import type { SkillRowPayload } from '../../../shared/ipcContract.js';

interface State {
  loading: boolean;
  skills: SkillRowPayload[];
  error: string | null;
}

export function useSkills(): State & { refresh(): Promise<void> } {
  const [state, setState] = useState<State>({ loading: true, skills: [], error: null });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await window.watchtower.invoke('skills:list', {});
      setState({ loading: false, skills: res.skills, error: null });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
