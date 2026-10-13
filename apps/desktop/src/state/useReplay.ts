import { useEffect, useState } from 'react';
import type { ReplayState, ReplayTurn } from '@watchtower/shared/replay.js';
import { invoke } from './ipc';

/** The replay-theater mod's latest turn for one instance; null until the mod posts. */
export function useReplay(instanceId: string): ReplayState | null {
  const [state, setState] = useState<ReplayState | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    invoke('replay:get', { instanceId })
      .then((s) => {
        if (alive) setState((prev) => prev ?? s);
      })
      .catch(() => {});
    const off = window.watchtower.on('replay', (payload) => {
      if (payload.instanceId === instanceId) setState(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);
  return state;
}

/** Steps of a turn the user hasn't looked at yet; 0 once the Replay tab has shown it. */
export function useUnseenSteps(turn: ReplayTurn | null | undefined, isShowing: boolean): number {
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    if (isShowing && turn) setSeenAt(turn.at);
  }, [isShowing, turn?.at]);
  return turn && turn.at > seenAt && !isShowing ? turn.steps.length : 0;
}
