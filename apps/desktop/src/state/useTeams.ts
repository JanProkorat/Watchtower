import { useCallback, useEffect, useState } from 'react';
import type { TeamsPushState } from '@watchtower/shared/teamsState.js';
import type { MeetingSummary } from '@watchtower/shared/meetings.js';
import { invoke } from './ipc';

export interface TeamsHook extends TeamsPushState {
  meetings: MeetingSummary[];
  syncedAt: number | null;
  refreshMeetings(): Promise<void>;
  joinMeeting(joinUrl: string): void;
  focusCall(): void;
}

const INITIAL: TeamsPushState = { open: false, inCall: false, callStartedAt: null };

export function useTeams(): TeamsHook {
  const [state, setState] = useState<TeamsPushState>(INITIAL);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    // The push is fired by electron-main on every window/audio transition.
    return window.watchtower.on('teamsStateChanged', (payload) => {
      setState(payload);
    });
  }, []);

  const refreshMeetings = useCallback(async () => {
    const res = await invoke('meetings:listToday', {});
    setMeetings(res.meetings);
    setSyncedAt(res.syncedAt);
  }, []);

  const joinMeeting = useCallback((joinUrl: string) => {
    void invoke('teams:joinMeeting', { joinUrl });
  }, []);

  const focusCall = useCallback(() => {
    void invoke('teams:focusCall', {});
  }, []);

  return { ...state, meetings, syncedAt, refreshMeetings, joinMeeting, focusCall };
}
