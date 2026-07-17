// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { SidebarUsage } from '../../apps/desktop/src/components/SidebarUsage';

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
    tu.value = { data: { available: true, block: { currentPercentUsed: 55, status: 'ok', endTime: Date.now() + 3_600_000 } } };
    renderIt();
    expect(screen.getByText(/session/i)).toBeInTheDocument();
    expect(screen.queryByText(/week/i)).toBeNull();
    expect(screen.getByText(/55\s*%/)).toBeInTheDocument();
  });
});
