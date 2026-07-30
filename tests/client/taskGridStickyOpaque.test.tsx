// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { darkTheme, lightTheme } from '../../apps/desktop/src/theme';
import { glassPinned, glassSurface } from '../../apps/desktop/src/theme/glass';
import { ToastProvider } from '../../apps/desktop/src/state/useToast';
import { TaskGridView } from '../../apps/desktop/src/components/timetracker/TaskGridView';

// Regression coverage for the see-through pinned surfaces: the grid's sticky
// header row, frozen Key/Title/Logged columns and sticky Total/Earned rows all
// have scrolling task rows passing *underneath* them. They previously painted
// with the translucent glass fill (alpha 0.44 — and alpha(fill, 0.98) for the
// header), so scrolled rows bled through and smeared the pinned text.

const TASK = {
  taskId: 1,
  taskNumber: 'FIE1933-20252',
  taskTitle: 'Prověření — divné vyplňování',
  status: 'in_progress' as const,
  estimatedMinutes: 240,
  totalTracked: 210,
  totalReported: 210,
  epicId: 1,
  epicName: 'Epic',
  projectId: 1,
  projectName: 'Project',
  projectColor: '#7c4dff',
  projectTaskUrlTemplate: null,
  isBillable: true,
  perDayTracked: { 9: 120, 10: 90 },
  perDayReported: { 9: 120, 10: 90 },
};

const GRID = {
  year: 2026,
  month: 7,
  daysInMonth: 31,
  tasks: [TASK],
  dailyTotalsTracked: { 9: 120, 10: 90 },
  dailyTotalsReported: { 9: 120, 10: 90 },
  earningsByCurrency: [{ perDay: { 9: 5469 }, totalAmount: 96250, expectedAmount: 95000 }],
  monthCapacityMinutes: 9120,
  publicHolidays: [],
  daysOff: [],
};

function renderGrid(theme: typeof darkTheme) {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) => {
      switch (kind) {
        case 'projects:list':
          return { projects: [] };
        case 'taskGrid:get':
          return GRID;
        default:
          return {};
      }
    }),
    on: vi.fn(() => () => {}),
  };
  render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="cs">
        <ToastProvider>
          <TaskGridView />
        </ToastProvider>
      </LocalizationProvider>
    </ThemeProvider>,
  );
}

/** The bottom-most background layer — the base a tint may be layered over. */
function baseLayer(background: string): string {
  const layers = background.split(/,(?![^(]*\))/);
  return (layers[layers.length - 1] ?? '').trim();
}

describe('glassPinned', () => {
  it('returns a fully opaque color in both modes', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const pinned = glassPinned(theme, { elevation: 2 });
      expect(pinned).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(pinned).not.toContain('rgba');
    }
  });

  it('is the translucent glass fill composited over the ambient base, not a lighter tint', () => {
    // The old fix was alpha(fill, 0.98), which both transmits and reads lighter
    // than the surrounding glass. Compositing keeps the tone: each channel must
    // land between the ambient base and the raw fill color.
    const fill = glassSurface(darkTheme, { elevation: 2 }).backgroundColor;
    const [fr, fg, fb] = fill.match(/[\d.]+/g)!.map(Number) as [number, number, number];
    const [pr, pg, pb] = glassPinned(darkTheme, { elevation: 2 })
      .match(/\d+/g)!
      .map(Number) as [number, number, number];
    for (const [pinned, raw] of [
      [pr, fr],
      [pg, fg],
      [pb, fb],
    ]) {
      expect(pinned).toBeGreaterThan(0);
      expect(pinned).toBeLessThan(raw);
    }
  });
});

describe('TaskGridView pinned surfaces', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('paints header, frozen columns and totals rows with the opaque pinned fill', async () => {
    renderGrid(darkTheme);
    const pinned = glassPinned(darkTheme, { elevation: 2 });

    // Sticky footer rows — the reported symptom (task rows showing through).
    const totalCell = await screen.findByText('Total hours');
    const earnedCell = await screen.findByText('Earned');
    // Frozen left column of a scrolling data row.
    const keyCell = (await screen.findByText('FIE1933-20252')).closest('td')!;
    // Sticky header cells.
    const headerCell = (await screen.findByText('Key')).closest('th')!;

    for (const cell of [totalCell, earnedCell, keyCell, headerCell]) {
      const bg = getComputedStyle(cell).background;
      expect(baseLayer(bg)).toBe(pinned);
      expect(bg).not.toContain('rgba(44,54,74');
    }
  });

  it('leaves the scrolling day cells translucent so the grid keeps its glass look', async () => {
    renderGrid(darkTheme);
    const dayCell = (await screen.findByTitle(/2 h on 2026-07-09/)).closest?.('td') ?? null;
    await waitFor(() => expect(dayCell).not.toBeNull());
    expect(getComputedStyle(dayCell!).background).not.toContain(
      glassPinned(darkTheme, { elevation: 2 }),
    );
  });
});
