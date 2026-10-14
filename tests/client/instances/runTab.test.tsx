// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { RunTab, runningCount } from '../../../apps/desktop/src/components/instances/side/RunTab';
import type { RunServerState, RunState } from '@watchtower/shared/runServers.js';

const server = (over: Partial<RunServerState>): RunServerState => ({
  id: 'api', label: 'API', port: 5001, url: null, status: 'stopped', exit: null, log: [], ...over,
});
const state = (servers: RunServerState[], error: string | null = null): RunState => ({ root: '/repo', servers, error });

function renderTab(s: RunState) {
  const handlers = { onStart: vi.fn(), onStop: vi.fn(), onReload: vi.fn() };
  render(<ThemeProvider theme={darkTheme}><RunTab state={s} {...handlers} /></ThemeProvider>);
  return handlers;
}

describe('RunTab', () => {
  it('starts all or one server while everything is off', () => {
    const h = renderTab(state([server({}), server({ id: 'web', label: 'Web', port: 5173 })]));
    fireEvent.click(screen.getByRole('button', { name: 'Start all' }));
    expect(h.onStart).toHaveBeenCalledWith();
    fireEvent.click(within(screen.getByTestId('run-web')).getByRole('button', { name: 'Start' }));
    expect(h.onStart).toHaveBeenCalledWith('web');
  });

  it('shows status per server, Open only for a running one with a url, and Stop all while any is up', () => {
    const h = renderTab(state([
      server({ status: 'running' }),
      server({ id: 'web', label: 'Web', port: 5173, status: 'running', url: 'http://localhost:5173' }),
      server({ id: 'job', label: 'Job', port: null, status: 'exited', exit: 'exit 1' }),
    ]));
    expect(within(screen.getByTestId('run-api')).getByText(':5001')).toBeTruthy();
    expect(within(screen.getByTestId('run-api')).queryByRole('button', { name: 'Open' })).toBeNull();
    expect(within(screen.getByTestId('run-web')).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(within(screen.getByTestId('run-job')).getByText('stopped (exit 1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    expect(h.onStop).toHaveBeenCalledWith();
  });

  it('shows the picked server log and a broken run.json', () => {
    renderTab(state([server({ log: ['api line'] }), server({ id: 'web', label: 'Web', log: ['web line'] })], 'servers[0] needs an "id".'));
    expect(screen.getByText('servers[0] needs an "id".')).toBeTruthy();
    expect(screen.getByTestId('run-log').textContent).toBe('api line');
    fireEvent.click(screen.getByRole('tab', { name: 'Web log' }));
    expect(screen.getByTestId('run-log').textContent).toBe('web line');
  });

  it('counts starting and running servers for the tab badge', () => {
    expect(runningCount(null)).toBe(0);
    expect(runningCount(state([server({ status: 'starting' }), server({ status: 'running' }), server({ status: 'busy' })]))).toBe(2);
  });
});
