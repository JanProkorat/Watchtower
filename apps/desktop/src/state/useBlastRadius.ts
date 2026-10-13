import { useEffect, useRef, useState } from 'react';
import { outcomeToast, type BlastDecision, type BlastRadiusState } from '@watchtower/shared/blastRadius.js';
import { invoke } from './ipc';
import { toast } from './useToast';

/** One pane's blast-radius hold: the popup's state, the answer, and a toast per outcome. */
export function useBlastRadius(instanceId: string): { state: BlastRadiusState | null; decide(decision: BlastDecision): void } {
  const [state, setState] = useState<BlastRadiusState | null>(null);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    setState(null);
    const toastOnce = (s: BlastRadiusState) => {
      const o = s.outcome;
      if (!o || shown.current.has(o.id)) return;
      shown.current.add(o.id);
      const t = outcomeToast(o);
      if (t.severity === 'warning') toast.showWarning(t.text);
      else toast.showInfo(t.text);
    };
    invoke('blastRadius:get', { instanceId })
      .then((s) => {
        if (!alive) return;
        // An outcome already there at load happened before this pane was watching: no toast.
        if (s?.outcome) shown.current.add(s.outcome.id);
        setState((prev) => prev ?? s);
      })
      .catch(() => {});
    const off = window.watchtower.on('blastRadius', (payload) => {
      if (payload.instanceId !== instanceId) return;
      toastOnce(payload);
      setState(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);

  const decide = (decision: BlastDecision) => {
    const holdId = state?.hold?.id;
    if (holdId) void invoke('blastRadius:decide', { instanceId, holdId, decision }).catch(() => {});
  };

  return { state, decide };
}
