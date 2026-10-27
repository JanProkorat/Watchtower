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
let toggled = 0;
function Harness({ enabled = true }: { enabled?: boolean }) {
  chrome = useSavvyChrome('inst-1', enabled, () => toggled++);
  return <div>{chrome.band}</div>;
}
const renderIt = (enabled = true) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <Harness enabled={enabled} />
    </ThemeProvider>,
  );

describe('useSavvyChrome', () => {
  it('has nothing until the mod posts', () => {
    sp.value = null;
    renderIt();
    expect(chrome.band).toBeNull();
    expect(chrome.agents).toBeNull();
    expect(chrome.bottomInset).toBe(0);
  });

  it('stays out of shell panes even with a snapshot', () => {
    sp.value = state();
    renderIt(false);
    expect(chrome.agents).toBeNull();
    expect(chrome.band).toBeNull();
  });

  it('offers the band and the agents data', () => {
    sp.value = state({ panelToggles: 3 });
    renderIt();
    expect(chrome.bottomInset).toBeGreaterThan(0);
    expect(chrome.agents?.snapshot.agents).toHaveLength(1);
    expect(chrome.panelToggles).toBe(3);
  });

  it('the crew button asks the side panel to toggle Agents', () => {
    sp.value = state();
    toggled = 0;
    renderIt();
    fireEvent.click(screen.getByText('×2'));
    expect(toggled).toBe(1);
  });

  it('dismissing the band hides it for that flow', () => {
    sp.value = state();
    renderIt();
    fireEvent.click(screen.getByLabelText('Dismiss progress band'));
    expect(chrome.band).toBeNull();
    expect(chrome.bottomInset).toBe(0);
  });

  it('plain subagents (no flow): agents data but no band', () => {
    sp.value = state({ flow: null });
    renderIt();
    expect(chrome.band).toBeNull();
    expect(chrome.agents).not.toBeNull();
  });
});
