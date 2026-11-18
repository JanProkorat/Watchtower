// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import {
  HiddenSessionsButton,
  hiddenSessionLabel,
  type HiddenSession,
} from '../../../apps/desktop/src/components/instances/HiddenSessionsButton';

// The hidden-sessions menu used to read "Show hidden session 1/2/3"; it must
// list each session by its generated name so the user can tell them apart.

const SESSIONS: HiddenSession[] = [
  { id: 'a', status: 'working', kind: 'claude', title: 'Pokračování plánu Stripe' },
  { id: 'b', status: 'waiting-input', kind: 'claude', title: null },
  { id: 'c', status: 'idle', kind: 'shell', title: null },
];

function renderButton(sessions = SESSIONS, onUnhide = vi.fn()) {
  render(
    <ThemeProvider theme={darkTheme}>
      <HiddenSessionsButton sessions={sessions} onUnhide={onUnhide} />
    </ThemeProvider>,
  );
  return onUnhide;
}

describe('hiddenSessionLabel', () => {
  it('uses the generated name', () => {
    expect(hiddenSessionLabel(SESSIONS[0]!)).toBe('Pokračování plánu Stripe');
  });

  it('falls back per kind when the session has no name yet', () => {
    expect(hiddenSessionLabel(SESSIONS[1]!)).toBe('Untitled Claude session');
    expect(hiddenSessionLabel(SESSIONS[2]!)).toBe('Terminal');
    expect(hiddenSessionLabel({ id: 'd', status: 'idle', kind: 'chat', title: '  ' })).toBe('Untitled chat');
  });
});

describe('HiddenSessionsButton', () => {
  it('renders nothing when no session is hidden', () => {
    renderButton([]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a labelled count, not a bare icon', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'show 3 hidden sessions' }).textContent).toContain('3 hidden');
  });

  it('lists hidden sessions by name and un-hides the picked one', () => {
    const onUnhide = renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'show 3 hidden sessions' }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['Pokračování plánu Stripe', 'Untitled Claude session', 'Terminal']);
    expect(menu.textContent).not.toMatch(/Show hidden session/);

    fireEvent.click(within(menu).getByText('Pokračování plánu Stripe'));
    expect(onUnhide).toHaveBeenCalledWith('a');
  });
});
