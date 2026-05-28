import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrate, persist } from '../../../client/src/state/useWorkspaceLayout.js';
import {
  DASHBOARD_TAB_ID,
  SETTINGS_KEYS,
  type PersistedLayout,
} from '../../../shared/layout.js';

interface Bridge {
  invoke: ReturnType<typeof vi.fn>;
}

function mockBridge(initial: Partial<Record<string, string>> = {}): {
  bridge: Bridge;
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  const bridge = {
    invoke: vi.fn(async (kind: string, payload: { key: string; value?: string }) => {
      if (kind === 'getSetting') return { value: store[payload.key] ?? null };
      if (kind === 'setSetting') {
        store[payload.key] = payload.value!;
        return { ok: true };
      }
      throw new Error('unexpected ipc kind: ' + kind);
    }),
  };
  return { bridge, store };
}

function installBridge(bridge: Bridge): void {
  (globalThis as unknown as { window: { watchtower: Bridge } }).window = { watchtower: bridge };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('useWorkspaceLayout helpers', () => {
  it('hydrates from empty settings → dashboard fallback', async () => {
    const { bridge } = mockBridge();
    installBridge(bridge);
    const layout = await hydrate();
    expect(layout.root.kind).toBe('leaf');
    if (layout.root.kind === 'leaf') expect(layout.root.tabId).toBe(DASHBOARD_TAB_ID);
    expect(layout.focusedLeafId).toBe(layout.root.id);
    expect(layout.tabFocus).toEqual({});
    expect(layout.tabStripOrder).toEqual([]);
  });

  it('hydrates a stored tree round-trip', async () => {
    const stored: PersistedLayout = {
      root: {
        kind: 'split',
        id: 'r',
        dir: 'row',
        sizes: [50, 50],
        children: [
          { kind: 'leaf', id: 'a', tabId: 'project:1' },
          { kind: 'leaf', id: 'b', tabId: 'project:2' },
        ],
      },
      focusedLeafId: 'a',
      tabFocus: { 'project:1': 'instance-1' },
      tabStripOrder: ['project:1', 'project:2'],
    };
    const { bridge } = mockBridge({
      [SETTINGS_KEYS.workspaceTree]: JSON.stringify(stored.root),
      [SETTINGS_KEYS.focusedLeafId]: JSON.stringify(stored.focusedLeafId),
      [SETTINGS_KEYS.tabFocus]: JSON.stringify(stored.tabFocus),
      [SETTINGS_KEYS.tabStripOrder]: JSON.stringify(stored.tabStripOrder),
    });
    installBridge(bridge);
    const layout = await hydrate();
    expect(layout).toEqual(stored);
  });

  it('persist writes all four settings keys with JSON-encoded values', async () => {
    const { bridge, store } = mockBridge();
    installBridge(bridge);
    const layout: PersistedLayout = {
      root: { kind: 'leaf', id: 'x', tabId: DASHBOARD_TAB_ID },
      focusedLeafId: 'x',
      tabFocus: {},
      tabStripOrder: [DASHBOARD_TAB_ID],
    };
    await persist(layout);
    expect(JSON.parse(store[SETTINGS_KEYS.workspaceTree]!)).toEqual(layout.root);
    expect(JSON.parse(store[SETTINGS_KEYS.focusedLeafId]!)).toBe('x');
    expect(JSON.parse(store[SETTINGS_KEYS.tabFocus]!)).toEqual({});
    expect(JSON.parse(store[SETTINGS_KEYS.tabStripOrder]!)).toEqual([DASHBOARD_TAB_ID]);
  });

  it('persist → hydrate is a faithful round-trip', async () => {
    const { bridge } = mockBridge();
    installBridge(bridge);
    const layout: PersistedLayout = {
      root: {
        kind: 'split',
        id: 'r',
        dir: 'col',
        sizes: [33, 33, 34],
        children: [
          { kind: 'leaf', id: 'a', tabId: 'cwd:/foo' },
          { kind: 'leaf', id: 'b', tabId: 'project:7' },
          { kind: 'leaf', id: 'c', tabId: DASHBOARD_TAB_ID },
        ],
      },
      focusedLeafId: 'b',
      tabFocus: { 'project:7': 'inst-7a' },
      tabStripOrder: ['cwd:/foo', 'project:7', DASHBOARD_TAB_ID],
    };
    await persist(layout);
    const rehydrated = await hydrate();
    expect(rehydrated).toEqual(layout);
  });
});
