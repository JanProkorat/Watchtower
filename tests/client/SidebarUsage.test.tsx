// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { SidebarUsage, tooltipFor } from '../../apps/desktop/src/components/SidebarUsage';

const rl = vi.hoisted(() => ({ value: null as unknown }));
const tu = vi.hoisted(() => ({ value: { data: null } as unknown }));
vi.mock('../../apps/desktop/src/state/useRateLimits', () => ({
  useRateLimits: () => ({ data: rl.value, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../apps/desktop/src/state/useTokenUsage', () => ({ useTokenUsage: () => tu.value }));

const renderIt = (collapsed = false) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <SidebarUsage collapsed={collapsed} />
    </ThemeProvider>,
  );

describe('SidebarUsage', () => {
  it('shows a muted placeholder when there is no data at all', () => {
    rl.value = null;
    tu.value = { data: null };
    renderIt();
    expect(screen.getByText(/no usage data/i)).toBeInTheDocument();
  });

  it('shows Session + Week bars when rate-limit data is present', () => {
    rl.value = { session: { usedPercent: 42, resetsAt: 0 }, week: { usedPercent: 71, resetsAt: 0 }, capturedAt: Date.now() };
    tu.value = { data: null };
    renderIt();
    expect(screen.getByText(/session/i)).toBeInTheDocument();
    expect(screen.getByText(/week/i)).toBeInTheDocument();
    expect(screen.getByText(/42\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/71\s*%/)).toBeInTheDocument();
  });

  it('hides the Week bar and uses ccusage for Session when capture is off (no rate-limit data)', () => {
    rl.value = null;
    tu.value = { data: { available: true, block: { currentPercentUsed: 55, status: 'ok', endTime: new Date(Date.now() + 3_600_000).toISOString() } } };
    renderIt();
    expect(screen.getByText(/session/i)).toBeInTheDocument();
    expect(screen.queryByText(/week/i)).toBeNull();
    // `~` marks it as the ccusage estimate rather than the real rate limit.
    expect(screen.getByText('~55%')).toBeInTheDocument();
  });

  it('does not mark a real rate-limit percentage as an estimate', () => {
    rl.value = { session: { usedPercent: 89, resetsAt: 0 }, week: null, capturedAt: Date.now() };
    tu.value = { data: { available: true, block: { currentPercentUsed: 55, status: 'ok', endTime: new Date(Date.now() + 3_600_000).toISOString() } } };
    renderIt();
    // The snapshot wins over ccusage, and carries no `~`.
    expect(screen.getByText('89%')).toBeInTheDocument();
    expect(screen.queryByText('~89%')).toBeNull();
    expect(screen.queryByText(/55\s*%/)).toBeNull();
  });

  it('drops a ccusage block whose window has already closed', () => {
    // The payload is cached for minutes; a lapsed block must not keep reporting
    // its final percentage after the window it measured has rolled over.
    rl.value = null;
    tu.value = { data: { available: true, block: { currentPercentUsed: 55, status: 'ok', endTime: new Date(Date.now() - 60_000).toISOString() } } };
    renderIt();
    expect(screen.getByText(/no usage data/i)).toBeInTheDocument();
    expect(screen.queryByText(/55\s*%/)).toBeNull();
  });

  it('shows a rolled-over window as 0%', () => {
    // useRateLimits hands down an already-aged snapshot (rollForwardRateLimits).
    rl.value = { session: { usedPercent: 0, resetsAt: 0 }, week: { usedPercent: 71, resetsAt: 0 }, capturedAt: Date.now() };
    tu.value = { data: null };
    renderIt();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});

describe('SidebarUsage tooltip', () => {
  const NOW = Date.UTC(2026, 7, 6, 12, 0);
  const row = (over: Partial<Parameters<typeof tooltipFor>[0]> = {}, nowMs = NOW) =>
    tooltipFor(
      { key: 'session', label: 'Session', tag: 'S', pct: 89, status: null, estimated: false, resetsAt: 0, ...over },
      nowMs,
    );

  it('is just label + percent for a real limit with no reset reported', () => {
    expect(row()).toBe('Session: 89%');
  });

  it('appends a bare time for a reset later the same day', () => {
    // Asserted via the same formatter so the test is timezone-agnostic.
    const resetsAt = (NOW + 90 * 60_000) / 1000;
    const hhmm = new Date(resetsAt * 1000).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' });
    expect(row({ resetsAt })).toBe(`Session: 89% · resets ${hhmm}`);
  });

  it('includes the date for a reset days out, so a week window is not read as today', () => {
    const resetsAt = (NOW + 4 * 86_400_000) / 1000;
    const title = row({ label: 'Week', resetsAt });
    const day = new Date(resetsAt * 1000).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
    expect(title).toContain(`resets ${day} `);
  });

  it('spells out that a ccusage figure is an estimate, and how to get the real one', () => {
    const title = row({ estimated: true });
    expect(title).toMatch(/estimate from ccusage/i);
    expect(title).toMatch(/Capture usage from statusline/i);
  });

  it('collapsed: shows S/W tags and hides the full labels and percentages', () => {
    rl.value = { session: { usedPercent: 42, resetsAt: 0 }, week: { usedPercent: 71, resetsAt: 0 }, capturedAt: Date.now() };
    tu.value = { data: null };
    renderIt(true);
    // Mini-bar tags stand in for the labels.
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    // Full labels and the inline % are suppressed in the collapsed rail (detail
    // lives in the hover tooltip, which is not rendered until hover).
    expect(screen.queryByText(/session/i)).toBeNull();
    expect(screen.queryByText(/week/i)).toBeNull();
    expect(screen.queryByText(/42\s*%/)).toBeNull();
    expect(screen.queryByText(/71\s*%/)).toBeNull();
  });
});
