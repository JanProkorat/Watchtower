// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { darkTheme } from '../../apps/desktop/src/theme';
import { ToastProvider } from '../../apps/desktop/src/state/useToast';
import { TaskGridView } from '../../apps/desktop/src/components/timetracker/TaskGridView';

// Regression coverage for the "Sync meetings" button: clicking the popover's
// primary action must call the `meetings:sync` IPC (not copy a command to the
// clipboard) with the picker's formatted range, then toast + refresh on success.

const EMPTY_GRID = {
  year: 2026,
  month: 7,
  daysInMonth: 31,
  tasks: [],
  dailyTotalsTracked: {},
  dailyTotalsReported: {},
  earningsByCurrency: [],
  monthCapacityMinutes: 0,
  publicHolidays: [],
  daysOff: [],
};

function mountWatchtower(invokeImpl: (kind: string, payload: unknown) => Promise<unknown>) {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(invokeImpl),
    on: vi.fn(() => () => {}),
  };
}

function renderIt() {
  render(
    <ThemeProvider theme={darkTheme}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="cs">
        <ToastProvider>
          <TaskGridView />
        </ToastProvider>
      </LocalizationProvider>
    </ThemeProvider>,
  );
}

describe('TaskGridView Sync meetings button', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls meetings:sync with the formatted range and toasts the count on success', async () => {
    const invokeMock = vi.fn(async (kind: string) => {
      switch (kind) {
        case 'projects:list':
          return { projects: [] };
        case 'taskGrid:get':
          return EMPTY_GRID;
        case 'meetings:sync':
          return { ok: true, count: 3 };
        default:
          return {};
      }
    });
    mountWatchtower(invokeMock);

    renderIt();

    const openButton = await screen.findByRole('button', { name: 'Sync meetings' });
    fireEvent.click(openButton);

    const submitButton = await screen.findByRole('button', { name: 'Sync' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'meetings:sync',
        expect.objectContaining({
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });

    await screen.findByText(/Logged 3 meetings as worklogs\./i);
    // Popover closes after a successful sync.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull());
  });

  it('shows an error toast and keeps the popover open when the sync fails', async () => {
    const invokeMock = vi.fn(async (kind: string) => {
      switch (kind) {
        case 'projects:list':
          return { projects: [] };
        case 'taskGrid:get':
          return EMPTY_GRID;
        case 'meetings:sync':
          return { ok: false, error: 'Outlook auth expired' };
        default:
          return {};
      }
    });
    mountWatchtower(invokeMock);

    renderIt();

    const openButton = await screen.findByRole('button', { name: 'Sync meetings' });
    fireEvent.click(openButton);

    const submitButton = await screen.findByRole('button', { name: 'Sync' });
    fireEvent.click(submitButton);

    await screen.findByText(/Outlook auth expired/i);
    // Popover stays open on failure.
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
  });
});
