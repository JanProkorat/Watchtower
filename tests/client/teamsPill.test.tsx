// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { TeamsPill } from '../../apps/desktop/src/components/teams/TeamsPill';

const teams = vi.hoisted(() => ({
  value: { open: false, inCall: false, callStartedAt: null as number | null, openTeams: vi.fn() },
}));
vi.mock('../../apps/desktop/src/state/useTeams', () => ({
  useTeams: () => teams.value,
}));

const renderIt = () =>
  render(
    <ThemeProvider theme={darkTheme}>
      <TeamsPill />
    </ThemeProvider>,
  );

describe('TeamsPill', () => {
  it('closed: shows "Teams" with no status', () => {
    teams.value = { open: false, inCall: false, callStartedAt: null, openTeams: vi.fn() };
    renderIt();
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.queryByText('open')).toBeNull();
    expect(screen.queryByText('On a call')).toBeNull();
  });

  it('open (not on a call): shows "Teams" + "open"', () => {
    teams.value = { open: true, inCall: false, callStartedAt: null, openTeams: vi.fn() };
    renderIt();
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('on a call: shows "On a call" + a MM:SS timer string', () => {
    teams.value = { open: true, inCall: true, callStartedAt: Date.now() - 134_000, openTeams: vi.fn() };
    renderIt();
    expect(screen.getByText('On a call')).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });
});
