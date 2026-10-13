// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidePanel, type SidePanelOptions } from '../../../apps/desktop/src/components/instances/side/useSidePanel';

beforeAll(() => {
  // Node's own localStorage stub shadows jsdom's; the panel width lives there.
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
});

const opts = (over: Partial<SidePanelOptions> = {}): SidePanelOptions => ({
  available: ['agents', 'files'],
  agentsAutoKey: null,
  toggles: {},
  ...over,
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

  it('clamps and remembers the width', () => {
    const { result } = renderHook(() => useSidePanel(opts()));
    act(() => result.current.setWidth(5000));
    expect(result.current.width).toBe(720);
    expect(localStorage.getItem('watchtower.savvyPanelWidth')).toBe('720');
  });
});
