// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { ModuleRail } from '../../apps/desktop/src/components/ModuleRail';

// SidebarUsage is rendered inside the rail; stub its data hooks so the rail test
// doesn't need the IPC bridge.
vi.mock('../../apps/desktop/src/state/useRateLimits', () => ({
  useRateLimits: () => ({
    data: { session: { usedPercent: 42, resetsAt: 0 }, week: { usedPercent: 71, resetsAt: 0 }, capturedAt: 0 },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('../../apps/desktop/src/state/useTokenUsage', () => ({
  useTokenUsage: () => ({ data: null }),
}));

const renderRail = () =>
  render(
    <ThemeProvider theme={darkTheme}>
      <ModuleRail
        active="settings"
        billingTab="projects"
        settingsTab="general"
        onSelect={vi.fn()}
        onSelectBillingTab={vi.fn()}
        onSelectSettingsTab={vi.fn()}
        mode="dark"
        onToggleMode={vi.fn()}
        reviewsUnread={0}
        reviewsNotifications={[]}
        onOpenNotification={vi.fn()}
        onMarkAllNotificationsSeen={vi.fn()}
      />
    </ThemeProvider>,
  );

/** Nearest ancestor of `el` that scrolls vertically, or null. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const overflowY = getComputedStyle(n).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return n;
  }
  return null;
}

// Both sub-sections default to open (readPersistedBool falls back to true when
// nothing is stored); Settings alone adds eight child rows, which is what used
// to overflow the rail.
describe('ModuleRail — nav overflow', () => {
  it('renders every Settings sub-tab when the section is expanded', () => {
    renderRail();
    for (const label of ['General', 'settings.json', 'Hooks', 'Skills', 'Agents', 'MCP', 'Messaging hub', 'Cloud Sync']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('keeps the usage bars and the collapse button rendered alongside the expanded sub-nav', () => {
    renderRail();
    // Previously the rail's own `overflow: hidden` clipped these once the
    // Settings children pushed the column past the window height.
    expect(screen.getByText('Session')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeInTheDocument();
  });

  it('puts the nav in its own scroll region', () => {
    renderRail();
    const nav = scrollParent(screen.getByRole('button', { name: 'Dashboard' }));
    expect(nav).not.toBeNull();
    // A flex child only shrinks below its content height (and therefore
    // scrolls) when min-height is 0 — the whole point of the fix.
    expect(parseFloat(getComputedStyle(nav as HTMLElement).minHeight)).toBe(0);
  });

  it('leaves the pinned footer outside that scroll region', () => {
    renderRail();
    const nav = scrollParent(screen.getByRole('button', { name: 'Dashboard' })) as HTMLElement;
    const collapse = screen.getByRole('button', { name: /collapse sidebar/i });
    // If the footer were inside the scroller it would scroll away with the nav
    // instead of staying pinned at the bottom of the rail.
    expect(nav.contains(collapse)).toBe(false);
    expect(nav.contains(screen.getByText('Session'))).toBe(false);
  });
});
