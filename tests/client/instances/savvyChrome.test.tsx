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
  // jsdom has no PointerEvent either; the resize edge reads clientX from one.
  globalThis.PointerEvent ??= class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  } as unknown as typeof PointerEvent;
  // Node's own localStorage stub shadows jsdom's; the panel width lives there.
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
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
    panelToggles: 0,
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
const tree = (enabled = true) => (
  <ThemeProvider theme={darkTheme}>
    <Harness enabled={enabled} />
  </ThemeProvider>
);
const renderIt = (enabled = true) => render(tree(enabled));

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

  it('each /agents-info (a rise in panelToggles) toggles the panel; a mod reload does not', () => {
    sp.value = state();
    const { rerender } = renderIt();
    expect(chrome.panel).not.toBeNull();
    sp.value = state({ panelToggles: 1 });
    rerender(tree());
    expect(chrome.panel).toBeNull();
    expect(chrome.rightInset).toBe(0);
    sp.value = state({ panelToggles: 2 });
    rerender(tree());
    expect(chrome.panel).not.toBeNull();
    // The mod restarted and counts from zero again: nothing flips.
    sp.value = state({ panelToggles: 0 });
    rerender(tree());
    expect(chrome.panel).not.toBeNull();
  });

  it('dragging the left edge resizes the panel within bounds and remembers it', () => {
    localStorage.removeItem('watchtower.savvyPanelWidth');
    sp.value = state();
    renderIt();
    const start = chrome.rightInset;
    const edge = screen.getByLabelText('Resize agents panel');
    edge.setPointerCapture = () => {};
    fireEvent.pointerDown(edge, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 400, pointerId: 1 });
    expect(chrome.rightInset).toBe(start + 100);
    fireEvent.pointerMove(edge, { clientX: -5000, pointerId: 1 });
    expect(chrome.rightInset).toBe(720);
    fireEvent.pointerUp(edge, { pointerId: 1 });
    expect(localStorage.getItem('watchtower.savvyPanelWidth')).toBe('720');
  });

  it('shows the panel without a band for plain subagents (no flow)', () => {
    sp.value = state({ flow: null });
    renderIt();
    expect(chrome.band).toBeNull();
    expect(chrome.panel).not.toBeNull();
  });
});
