// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { useSavvyChrome, type SavvyChrome } from '../../../apps/desktop/src/components/instances/savvy/useSavvyChrome';
import type { SavvyProgressState } from '@watchtower/shared/savvyProgress.js';

const sp = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../../apps/desktop/src/state/useSavvyProgress', () => ({ useSavvyProgress: () => sp.value }));

beforeAll(() => {
  // jsdom has no ResizeObserver; the band measures its slot with one.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const state = (over: Partial<SavvyProgressState['snapshot']> = {}): SavvyProgressState => ({
  instanceId: 'inst-1',
  receivedAt: 10_000,
  snapshot: {
    lang: 'en',
    flow: {
      title: 'Port parser',
      total: 2,
      done: 0,
      running: 1,
      phase: 'delegate',
      isFinished: false,
      tasks: [
        { title: 'Write the parser', tier: 'careful', after: [] },
        { title: 'Add tests', tier: 'light', after: [1] },
      ],
    },
    agents: [
      {
        id: 't1',
        type: 'savvy-careful',
        description: 'Write the parser',
        model: 'claude-opus-5-5',
        status: 'running',
        startedAt: 9_000,
        contextTokens: 0,
        contextMax: 1_000_000,
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round: 1,
      },
    ],
    sentAt: 10_000,
    ...over,
  },
});

let chrome: SavvyChrome;
function Harness({ enabled = true }: { enabled?: boolean }) {
  chrome = useSavvyChrome('inst-1', enabled);
  return (
    <div>
      {chrome.band}
      {chrome.panel}
    </div>
  );
}
const renderIt = (enabled = true) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <Harness enabled={enabled} />
    </ThemeProvider>,
  );

describe('useSavvyChrome', () => {
  it('takes no space and draws nothing until the mod posts', () => {
    sp.value = null;
    renderIt();
    expect(chrome.band).toBeNull();
    expect(chrome.panel).toBeNull();
    expect(chrome.rightInset).toBe(0);
    expect(chrome.bottomInset).toBe(0);
  });

  it('stays out of shell panes even with a snapshot', () => {
    sp.value = state();
    renderIt(false);
    expect(chrome.panel).toBeNull();
    expect(chrome.band).toBeNull();
  });

  it('shows the band and opens the panel with running and planned agents', () => {
    sp.value = state();
    renderIt();
    expect(chrome.rightInset).toBeGreaterThan(0);
    expect(chrome.bottomInset).toBeGreaterThan(0);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByAltText('Write the parser: Opus 5.5, running')).toBeInTheDocument();
    expect(screen.getByAltText('2. Add tests: planned')).toBeInTheDocument();
    // Crew = 1 run + 1 planned task not yet started.
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('closing the panel frees its space; the crew button and openPanel bring it back', () => {
    sp.value = state();
    renderIt();
    fireEvent.click(screen.getByLabelText('Hide agents panel'));
    expect(chrome.panel).toBeNull();
    expect(chrome.rightInset).toBe(0);
    expect(chrome.isPanelClosed).toBe(true);
    fireEvent.click(screen.getByText('×2'));
    expect(chrome.panel).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Hide agents panel'));
    expect(chrome.isPanelClosed).toBe(true);
  });

  it('dismissing the band hides it for that flow', () => {
    sp.value = state();
    renderIt();
    fireEvent.click(screen.getByLabelText('Dismiss progress band'));
    expect(chrome.band).toBeNull();
    expect(chrome.bottomInset).toBe(0);
  });

  it('shows the panel without a band for plain subagents (no flow)', () => {
    sp.value = state({ flow: null });
    renderIt();
    expect(chrome.band).toBeNull();
    expect(chrome.panel).not.toBeNull();
  });
});
