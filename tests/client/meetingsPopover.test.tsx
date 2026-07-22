// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { MeetingsPopover } from '../../apps/desktop/src/components/teams/MeetingsPopover';
import type { MeetingSummary } from '@watchtower/shared/meetings.js';

const MEETINGS: MeetingSummary[] = [
  {
    id: 'm1',
    subject: 'Standup',
    subtitle: '5 attendees',
    startsAt: '2026-07-21T09:00:00.000Z',
    endsAt: '2026-07-21T09:15:00.000Z',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/m1',
  },
  {
    id: 'm2',
    subject: 'Focus block',
    subtitle: '',
    startsAt: '2026-07-21T10:00:00.000Z',
    endsAt: '2026-07-21T11:00:00.000Z',
    joinUrl: null,
  },
];

const renderIt = (overrides: Partial<Parameters<typeof MeetingsPopover>[0]> = {}) => {
  const onJoin = vi.fn();
  const onReturnToCall = vi.fn();
  const onRefresh = vi.fn();
  render(
    <ThemeProvider theme={darkTheme}>
      <MeetingsPopover
        meetings={MEETINGS}
        syncedAt={Date.now()}
        inCall={false}
        onJoin={onJoin}
        onReturnToCall={onReturnToCall}
        onRefresh={onRefresh}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { onJoin, onReturnToCall, onRefresh };
};

describe('MeetingsPopover', () => {
  it('shows a Join button only for the meeting with a joinUrl, and calls onJoin with the URL', () => {
    const { onJoin } = renderIt();

    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Focus block')).toBeInTheDocument();

    const joinButtons = screen.getAllByRole('button', { name: 'Join' });
    expect(joinButtons).toHaveLength(1);

    fireEvent.click(joinButtons[0]);
    expect(onJoin).toHaveBeenCalledWith('https://teams.microsoft.com/l/meetup-join/m1');
  });

  it('renders the empty state when there are no meetings', () => {
    renderIt({ meetings: [], syncedAt: null });
    expect(screen.getByText(/No meetings cached/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
  });

  it('says "no upcoming meetings" when synced but the list is empty (all past)', () => {
    renderIt({ meetings: [], syncedAt: Date.now() });
    expect(screen.getByText(/No upcoming meetings today/i)).toBeInTheDocument();
    expect(screen.queryByText(/No meetings cached/i)).toBeNull();
  });

  it('renders a "Return to call" row when inCall, and clicking it calls onReturnToCall', () => {
    const { onReturnToCall } = renderIt({ inCall: true });

    const returnRow = screen.getByText(/Return to call/i);
    expect(returnRow).toBeInTheDocument();

    fireEvent.click(returnRow);
    expect(onReturnToCall).toHaveBeenCalledTimes(1);
  });

  it('does not render the "Return to call" row when not inCall', () => {
    renderIt({ inCall: false });
    expect(screen.queryByText(/Return to call/i)).toBeNull();
  });
});
