// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { SidePanel } from '../../../apps/desktop/src/components/instances/side/SidePanel';
import { sideTabsFor, useSidePanel, type SidePanelOptions } from '../../../apps/desktop/src/components/instances/side/useSidePanel';

beforeAll(() => {
  // Node's own localStorage stub shadows jsdom's; the panel width lives there.
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
  // jsdom has no PointerEvent; the resize edge reads clientX from one.
  globalThis.PointerEvent ??= class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  } as unknown as typeof PointerEvent;
});

const opts = (over: Partial<SidePanelOptions> = {}): SidePanelOptions => ({
  available: ['agents', 'files'],
  agentsAutoKey: null,
  toggles: {},
  ...over,
});

describe('sideTabsFor', () => {
  it('offers Agents wherever Claude runs, even before any subagent, and Files wherever there is a folder', () => {
    expect(sideTabsFor('claude', '/repo')).toEqual(['agents', 'files', 'replay']);
    expect(sideTabsFor('chat', '/repo')).toEqual(['agents', 'files', 'replay']);
    expect(sideTabsFor('shell', '/repo')).toEqual(['files']);
    expect(sideTabsFor('claude', '')).toEqual(['agents', 'replay']);
  });
});

describe('useSidePanel', () => {
  it('starts closed and opens on the first available tab', () => {
    const { result } = renderHook(() => useSidePanel(opts()));
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tab).toBe('agents');
  });

  it('reopens the last picked tab', () => {
    const { result } = renderHook(() => useSidePanel(opts()));
    act(() => result.current.open('files'));
    act(() => result.current.close());
    act(() => result.current.open());
    expect(result.current.tab).toBe('files');
  });

  it('auto-opens Agents once per new key, only when closed', () => {
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), { initialProps: opts() });
    rerender(opts({ agentsAutoKey: 'flow A' }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tab).toBe('agents');
    act(() => result.current.close());
    rerender(opts({ agentsAutoKey: 'flow A' }));
    expect(result.current.isOpen).toBe(false); // closing holds for the same flow
    rerender(opts({ agentsAutoKey: 'flow B' }));
    expect(result.current.isOpen).toBe(true);
  });

  it('auto-open never steals a tab the user picked', () => {
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), { initialProps: opts() });
    act(() => result.current.open('files'));
    rerender(opts({ agentsAutoKey: 'flow A' }));
    expect(result.current.tab).toBe('files');
  });

  it('a toggle rise opens its tab, switches to it from another tab, or closes it', () => {
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), {
      initialProps: opts({ toggles: { agents: 0, files: 0 } }),
    });
    rerender(opts({ toggles: { agents: 0, files: 1 } }));
    expect(result.current.tab).toBe('files');
    rerender(opts({ toggles: { agents: 1, files: 1 } }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tab).toBe('agents'); // switched, not closed
    rerender(opts({ toggles: { agents: 2, files: 1 } }));
    expect(result.current.isOpen).toBe(false);
  });

  it('a replay toggle rise opens the Replay tab', () => {
    const all = ['agents', 'files', 'replay'] as const;
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), {
      initialProps: opts({ available: all, toggles: { replay: 0 } }),
    });
    rerender(opts({ available: all, toggles: { replay: 1 } }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tab).toBe('replay');
  });

  it('a counter drop (mod reload) or first sighting does not toggle', () => {
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), { initialProps: opts() });
    rerender(opts({ toggles: { agents: 5 } }));
    expect(result.current.isOpen).toBe(false);
    rerender(opts({ toggles: { agents: 0 } }));
    expect(result.current.isOpen).toBe(false);
  });

  it('falls back to another tab when the active one disappears, closes when none is left', () => {
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), { initialProps: opts() });
    act(() => result.current.open('agents'));
    rerender(opts({ available: ['files'] }));
    expect(result.current.tab).toBe('files');
    rerender(opts({ available: [] }));
    expect(result.current.isOpen).toBe(false);
  });

  it('ignores a request for an unavailable tab and never jumps to it later', () => {
    const { result, rerender } = renderHook((o: SidePanelOptions) => useSidePanel(o), { initialProps: opts({ available: ['files'] }) });
    act(() => result.current.toggle('agents'));
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.open('agents'));
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.open());
    expect(result.current.tab).toBe('files');
    // Agents appears later: the panel stays on the tab the user is on.
    rerender(opts({ available: ['agents', 'files'] }));
    expect(result.current.tab).toBe('files');
  });

  it('clamps and remembers the width', () => {
    const { result } = renderHook(() => useSidePanel(opts()));
    act(() => result.current.setWidth(5000));
    expect(result.current.width).toBe(720);
    expect(localStorage.getItem('watchtower.savvyPanelWidth')).toBe('720');
  });
});

describe('SidePanel', () => {
  const renderPanel = (over: Partial<Parameters<typeof SidePanel>[0]> = {}) => {
    const calls = { select: [] as string[], close: 0, resize: [] as number[] };
    render(
      <ThemeProvider theme={darkTheme}>
        <SidePanel
          tabs={['agents', 'files']}
          tab="agents"
          width={340}
          onSelect={(t) => calls.select.push(t)}
          onClose={() => calls.close++}
          onResize={(w) => calls.resize.push(w)}
          {...over}
        >
          <div>body</div>
        </SidePanel>
      </ThemeProvider>,
    );
    return calls;
  };

  it('shows a tab per available tab and marks the active one', () => {
    renderPanel();
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('appends a positive count to a tab label', () => {
    renderPanel({ tabs: ['agents', 'files', 'replay'], counts: { replay: 3 } });
    expect(screen.getByRole('tab', { name: 'Replay · 3' })).toBeInTheDocument();
  });

  it('shows no count when it is 0', () => {
    renderPanel({ tabs: ['agents', 'files', 'replay'], counts: { replay: 0 } });
    expect(screen.getByRole('tab', { name: 'Replay' })).toBeInTheDocument();
  });

  it('selects a tab and closes the panel', () => {
    const calls = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByLabelText('Hide side panel'));
    expect(calls.select).toEqual(['files']);
    expect(calls.close).toBe(1);
  });

  it('dragging the left edge asks for a wider panel', () => {
    const calls = renderPanel();
    const edge = screen.getByLabelText('Resize side panel');
    edge.setPointerCapture = () => {};
    fireEvent.pointerDown(edge, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(edge, { pointerId: 1 });
    expect(calls.resize).toEqual([440]);
  });
});
