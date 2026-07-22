// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { TeamsPill } from '../../apps/desktop/src/components/teams/TeamsPill';

const teams = vi.hoisted(() => ({
  value: {
    open: false,
    inCall: false,
    callStartedAt: null as number | null,
    meetings: [] as Array<{
      id: string;
      subject: string;
      subtitle: string;
      startsAt: string;
      endsAt: string;
      joinUrl: string | null;
    }>,
    syncedAt: null as number | null,
    refreshMeetings: vi.fn().mockResolvedValue(undefined),
    joinMeeting: vi.fn(),
    focusCall: vi.fn(),
  },
}));
vi.mock('../../apps/desktop/src/state/useTeams', () => ({
  useTeams: () => teams.value,
}));

const showError = vi.fn();
const showSuccess = vi.fn();
vi.mock('../../apps/desktop/src/state/useToast', async () => {
  const actual = await vi.importActual<typeof import('../../apps/desktop/src/state/useToast')>(
    '../../apps/desktop/src/state/useToast',
  );
  return { ...actual, useToast: () => ({ showError, showSuccess, showInfo: vi.fn(), showWarning: vi.fn() }) };
});

const renderIt = () =>
  render(
    <ThemeProvider theme={darkTheme}>
      <TeamsPill />
    </ThemeProvider>,
  );

describe('TeamsPill', () => {
  it('idle: shows "Teams" with no on-call timer', () => {
    teams.value = {
      ...teams.value,
      open: false,
      inCall: false,
      callStartedAt: null,
      meetings: [],
      syncedAt: null,
    };
    renderIt();
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.queryByText('On a call')).toBeNull();
  });

  it('on a call: shows "On a call" + a MM:SS timer string', () => {
    teams.value = {
      ...teams.value,
      open: true,
      inCall: true,
      callStartedAt: Date.now() - 134_000,
      meetings: [],
      syncedAt: null,
    };
    renderIt();
    expect(screen.getByText('On a call')).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('clicking the pill opens the popover and shows the empty-state text', () => {
    teams.value = {
      ...teams.value,
      open: false,
      inCall: false,
      callStartedAt: null,
      meetings: [],
      syncedAt: null,
    };
    renderIt();
    expect(screen.queryByText(/No meetings cached/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /open teams meetings/i }));

    expect(screen.getByText(/No meetings cached/i)).toBeInTheDocument();
  });

  it('clicking the pill opens the popover and shows a cached meeting row', () => {
    teams.value = {
      ...teams.value,
      open: false,
      inCall: false,
      callStartedAt: null,
      meetings: [
        {
          id: 'm1',
          subject: 'Standup',
          subtitle: '',
          startsAt: '2026-07-21T09:00:00.000Z',
          endsAt: '2026-07-21T09:15:00.000Z',
          joinUrl: 'https://teams.microsoft.com/l/meetup-join/m1',
        },
      ],
      syncedAt: Date.now(),
    };
    renderIt();

    fireEvent.click(screen.getByRole('button', { name: /open teams meetings/i }));

    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
  });
});
