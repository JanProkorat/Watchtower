import { useEffect, useState } from 'react';
import type { TeamsPushState } from '@watchtower/shared/teamsState.js';
import { invoke } from './ipc';

export type TeamsHook = TeamsPushState & { openTeams(): void };

const INITIAL: TeamsPushState = { open: false, inCall: false, callStartedAt: null };

export function useTeams(): TeamsHook {
  const [state, setState] = useState<TeamsPushState>(INITIAL);

  useEffect(() => {
    // The push is fired by electron-main on every window/audio transition.
    return window.watchtower.on('teamsStateChanged', (payload) => {
      setState(payload);
    });
  }, []);

  const openTeams = (): void => {
    void invoke('teams:open', {});
  };

  return { ...state, openTeams };
}
