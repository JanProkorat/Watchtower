# Side Panel Tabs (Agents + native Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each instance pane one tabbed right-side panel (Agents | Files) that replaces both the savvy agents panel and the filetree mod's terminal pane, with a native git-aware file tree and Claude's read/write activity flashing on it.

**Architecture:** The renderer gets a per-pane `useSidePanel` state hook and a `SidePanel` frame (tab strip, close, drag-to-resize) that `PaneCard` lays out right of the terminal. The orchestrator gets a `fileTree` service (lazy folder listing, git status + numstat, name search, a ref-counted recursive watcher) behind five IPC kinds and one push. A vendored, patched filetree mod stops docking inside Watchtower and posts Claude's file activity to `/mods/filetree`, stored by a `FileTreeActivityStore` twin of `SavvyProgressStore`.

**Tech Stack:** TypeScript, React 18 + MUI v5 (renderer), Node `utilityProcess` orchestrator (`node:fs`, `node:child_process`), vitest + @testing-library/react 16 (jsdom), Claude Code mod engine (`claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-13-side-panel-tabs-design.md`

## Global Constraints

- UI text is English; date/number formatting stays Czech (`CZ_DATE_FORMAT` = `D. M. YYYY` from `apps/desktop/src/util/format.ts`). No i18n.
- All renderer IPC goes through `invoke()` in `apps/desktop/src/state/ipc.ts`, never `window.watchtower.invoke`.
- New IPC kinds follow CLAUDE.md "When adding a new kind": `packages/shared/src/ipcContract.ts` (request + response + push) → mirror into `packages/shared/src/messagePort.ts` → handler in `orchestrator/index.ts` → thin hook in `apps/desktop/src/state/`.
- Background/poll kinds go on `SILENT_KINDS`: `fileTree:git`, `fileTree:search`, `fileTree:watch`, `fileTree:unwatch`, `fileTreeActivity:get`. `fileTree:list` stays loud (a user-initiated expand may toast); refreshes pass `{ silent: true }`.
- Panel width: 260–720 px, default 340, `localStorage` key `watchtower.savvyPanelWidth` (kept as is).
- File tree limits: 5,000 entries per folder (`truncated` = the rest), 20,000-file cap on the non-repo search walk, 200 search results, 300 ms watcher debounce, 5 s git timeout, last 50 activity entries, 4 s flash.
- Git colours: modified `#e0a43a` (amber), added/untracked `#5fbf8f` (green), deleted `#e5534b` (red), ignored at opacity 0.45. Flash: read `#8f8cf4` (purple), write `#d97757` (orange).
- Paths: every folder the renderer asks for is resolved with `realpath` and must stay inside the instance cwd; otherwise the call rejects with `Path is outside the instance folder`.
- Code comments in English, one or two lines; match the surrounding file's semicolon style (renderer/orchestrator use semicolons; the mods do not).
- Every task ends green on: `npx vitest run <its test files>` and `npm run typecheck:ci`. Before the final commit of each phase run the full `npm test` (7 known env failures: `bootstrap*.test.ts`, `sync/{pull,purge,service}.test.ts`, `taskGridStickyOpaque.test.tsx` — anything else is new).
- Commit after each task with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`.

## Review Focus

1. A pane whose cwd was deleted or moved after launch: Files tab shows an inline "Folder not found" note instead of a stuck spinner or a toast storm — pinned in Task 9.
2. A repo with no commits yet (`git diff HEAD` fails): the tree still shows untracked files green, branch row shows the branch name — pinned in Task 5.
3. File names with spaces, unicode, or a rename (`R` entries, NUL-separated original path): statuses land on the right row — pinned in Task 5.
4. `/agents-info` while the panel shows Files: switches to Agents rather than closing — pinned in Task 1.
5. Two panes on the same folder: closing one pane's Files tab must not stop the other pane's live refresh — pinned in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/desktop/src/components/instances/side/useSidePanel.ts` (new) | Per-pane open/closed, active tab, width; auto-open and toggle-counter rules |
| `apps/desktop/src/components/instances/side/SidePanel.tsx` (new) | Panel chrome: tab strip, close button, resize edge, body slot |
| `apps/desktop/src/components/instances/savvy/useSavvyChrome.tsx` (modify) | Shrinks to: progress band + agents data for the panel |
| `apps/desktop/src/components/instances/savvy/SavvyAgentsPanel.tsx` (modify) | Agents tab body only (no frame, close or resize) |
| `apps/desktop/src/components/instances/PaneCard.tsx` (modify) | Lays out terminal, side panel and band |
| `packages/shared/src/fileTree.ts` (new) | File tree + activity shapes, `parseFileTreeActivity` |
| `orchestrator/services/fileTree.ts` (new) | `resolveInside`, `listDir`, git parse/read, search |
| `orchestrator/services/fileTreeWatchers.ts` (new) | Ref-counted recursive watchers with debounce |
| `orchestrator/services/fileTreeActivityStore.ts` (new) | Latest filetree-mod activity per instance |
| `apps/desktop/src/state/useFileTree.ts` (new) | Listing/git/watch lifecycle for one pane |
| `apps/desktop/src/state/useFileTreeActivity.ts` (new) | Activity snapshot for one pane |
| `apps/desktop/src/components/instances/side/fileTreeModel.ts` (new) | Pure: rows from listings, git index, folder totals, search reveal |
| `apps/desktop/src/components/instances/side/FilesTab.tsx` (new) | Files tab UI |
| `plugins/filetree/**` (new, vendored) | Patched filetree mod |

---

## Phase 0 — prerequisite

### Task 0: Commit the reviewed savvy panel work

The attached/resizable agents panel and `/agents-info` toggle (reviewed in the dev app on 2026-10-13) are uncommitted on `main`. Phase 1 builds on them.

- [ ] **Step 1: Confirm the working tree holds exactly that work**

Run: `git status --short`
Expected modified: `apps/desktop/src/components/instances/PaneCard.tsx`, `.../savvy/SavvyAgentsPanel.tsx`, `.../savvy/useSavvyChrome.tsx`, `packages/shared/src/savvyProgress.ts`, `plugins/savvy-progress/{README.md,hooks/register.tsx,tests/bridge.test.ts}`, `tests/client/instances/savvyChrome.test.tsx`, `tests/shared/savvyProgress.test.ts`. Unrelated (do NOT stage): `.gitignore`, `package-lock.json`, `.codex/`, `AGENTS.md`, `docs/superpowers/specs/2026-08-12-finance-module-design.md`, `plugins/savvy-progress/tsconfig.json`.

- [ ] **Step 2: Verify**

Run: `npx vitest run savvy && claude plugin test plugins/savvy-progress && npm run typecheck:ci`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/instances/PaneCard.tsx apps/desktop/src/components/instances/savvy/SavvyAgentsPanel.tsx apps/desktop/src/components/instances/savvy/useSavvyChrome.tsx packages/shared/src/savvyProgress.ts plugins/savvy-progress/README.md plugins/savvy-progress/hooks/register.tsx plugins/savvy-progress/tests/bridge.test.ts tests/client/instances/savvyChrome.test.tsx tests/shared/savvyProgress.test.ts
git commit -m "feat(savvy): attach the agents panel to its pane, make it resizable, route /agents-info to it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then create the feature worktree from this commit (superpowers:using-git-worktrees); all later tasks run there. In the worktree run `npm install` then `npm run electron:rebuild` before any dev-app run.

---

## Phase 1 — Tab host with Agents

### Task 1: `useSidePanel` state hook

**Files:**
- Create: `apps/desktop/src/components/instances/side/useSidePanel.ts`
- Test: `tests/client/instances/sidePanel.test.tsx`

**Interfaces:**
- Consumes: `clampPanelWidth`, `PANEL_W` from `apps/desktop/src/components/instances/savvy/SavvyAgentsPanel.tsx` (exist today).
- Produces:
```ts
export type SideTab = 'agents' | 'files';
export interface SidePanelOptions {
  /** Tabs with something to show, in strip order. */
  available: readonly SideTab[];
  /** Non-null while the agents tab has content; a new value auto-opens Agents once. */
  agentsAutoKey: string | null;
  /** Each tab's toggle counter from its mod; a rise toggles that tab. */
  toggles: Partial<Record<SideTab, number | undefined>>;
}
export interface SidePanel {
  available: readonly SideTab[];
  isOpen: boolean;
  tab: SideTab | null;
  width: number;
  setWidth(width: number): void;
  open(tab?: SideTab): void;
  close(): void;
  select(tab: SideTab): void;
  toggle(tab: SideTab): void;
}
export function useSidePanel(opts: SidePanelOptions): SidePanel;
```

- [ ] **Step 1: Write the failing tests**

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client/instances/sidePanel.test.tsx`
Expected: FAIL — cannot resolve `.../side/useSidePanel`.

- [ ] **Step 3: Implement**

```ts
import { useEffect, useRef, useState } from 'react';
import { PANEL_W, clampPanelWidth } from '../savvy/SavvyAgentsPanel.js';

export type SideTab = 'agents' | 'files';

export interface SidePanelOptions {
  /** Tabs with something to show, in strip order. */
  available: readonly SideTab[];
  /** Non-null while the agents tab has content; a new value auto-opens Agents once. */
  agentsAutoKey: string | null;
  /** Each tab's toggle counter from its mod; a rise toggles that tab. */
  toggles: Partial<Record<SideTab, number | undefined>>;
}

export interface SidePanel {
  available: readonly SideTab[];
  isOpen: boolean;
  tab: SideTab | null;
  width: number;
  setWidth(width: number): void;
  open(tab?: SideTab): void;
  close(): void;
  select(tab: SideTab): void;
  toggle(tab: SideTab): void;
}

const WIDTH_KEY = 'watchtower.savvyPanelWidth';

/** One pane's right-side panel: which tab shows, whether it is open, and how wide. */
export function useSidePanel({ available, agentsAutoKey, toggles }: SidePanelOptions): SidePanel {
  const [isOpenRaw, setIsOpen] = useState(false);
  const [picked, setPicked] = useState<SideTab | null>(null);
  const [width, setWidthState] = useState(readWidth);

  const tab = picked && available.includes(picked) ? picked : available[0] ?? null;
  const isOpen = isOpenRaw && tab !== null;

  const open = (t?: SideTab) => {
    const next = t ?? (picked && available.includes(picked) ? picked : available[0]);
    if (!next) return;
    setPicked(next);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);
  const toggle = (t: SideTab) => (isOpen && tab === t ? close() : open(t));

  // Agents opens by itself once per new flow, and only into a closed panel.
  const lastAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (agentsAutoKey === null || agentsAutoKey === lastAutoKey.current) return;
    lastAutoKey.current = agentsAutoKey;
    if (!isOpen) open('agents');
    // Only a new key should act; the rest is read as of that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsAutoKey]);

  useToggleRise(toggles.agents, () => toggle('agents'));
  useToggleRise(toggles.files, () => toggle('files'));

  const setWidth = (w: number) => {
    const next = clampPanelWidth(w);
    setWidthState(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Not remembered; the width still applies for this session.
    }
  };

  return { available, isOpen, tab, width, setWidth, open, close, select: (t) => open(t), toggle };
}

/** Calls `onRise` when `count` goes up; the first value and any drop (a mod reload) only resync. */
function useToggleRise(count: number | undefined, onRise: () => void): void {
  const last = useRef(count);
  useEffect(() => {
    const prev = last.current;
    last.current = count;
    if (prev !== undefined && count !== undefined && count > prev) onRise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
}

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clampPanelWidth(saved) : PANEL_W;
  } catch {
    return PANEL_W;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/client/instances/sidePanel.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/instances/side/useSidePanel.ts tests/client/instances/sidePanel.test.tsx
git commit -m "feat(side-panel): per-pane side panel state with tab toggle rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: `SidePanel` chrome and a frameless `SavvyAgentsPanel`

**Files:**
- Create: `apps/desktop/src/components/instances/side/SidePanel.tsx`
- Modify: `apps/desktop/src/components/instances/savvy/SavvyAgentsPanel.tsx` (move `ResizeEdge` out; drop `onResize`, `onClose`, the "Agents" title and the close button)
- Test: `tests/client/instances/sidePanel.test.tsx` (append a `describe('SidePanel')`)

**Interfaces:**
- Consumes: `SideTab` from Task 1.
- Produces:
```ts
export const SIDE_TAB_LABEL: Record<SideTab, string>; // { agents: 'Agents', files: 'Files' }
export function SidePanel(props: {
  tabs: readonly SideTab[]; tab: SideTab; width: number;
  onSelect(tab: SideTab): void; onClose(): void; onResize(width: number): void;
  children: ReactNode;
}): JSX.Element;
// SavvyAgentsPanel props become: { snapshot: SavvyProgressSnapshot; at: number; width: number }
```

- [ ] **Step 1: Write the failing tests** (append to `tests/client/instances/sidePanel.test.tsx`; add `PointerEvent` stand-in to the existing `beforeAll`)

```tsx
// Add at the top with the other imports:
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { SidePanel } from '../../../apps/desktop/src/components/instances/side/SidePanel';

// Add inside the existing beforeAll:
  // jsdom has no PointerEvent; the resize edge reads clientX from one.
  globalThis.PointerEvent ??= class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  } as unknown as typeof PointerEvent;

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client/instances/sidePanel.test.tsx`
Expected: FAIL — cannot resolve `.../side/SidePanel`.

- [ ] **Step 3: Implement `SidePanel.tsx`**

```tsx
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Box, ButtonBase, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { SideTab } from './useSidePanel.js';

export const SIDE_TAB_LABEL: Record<SideTab, string> = { agents: 'Agents', files: 'Files' };

interface Props {
  tabs: readonly SideTab[];
  tab: SideTab;
  width: number;
  onSelect(tab: SideTab): void;
  onClose(): void;
  onResize(width: number): void;
  children: ReactNode;
}

/** The right-side panel's chrome: tab strip, close button and resize edge. PaneCard draws the frame. */
export function SidePanel({ tabs, tab, width, onSelect, onClose, onResize, children }: Props) {
  return (
    <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ResizeEdge width={width} onResize={onResize} />
      <Box role="tablist" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pt: 0.75, pb: 0.5 }}>
        {tabs.map((t) => (
          <ButtonBase
            key={t}
            role="tab"
            aria-selected={t === tab}
            onClick={() => onSelect(t)}
            sx={{
              fontSize: 12.5,
              fontWeight: t === tab ? 600 : 500,
              color: t === tab ? 'text.primary' : 'text.secondary',
              borderRadius: '6px',
              px: 1,
              py: 0.25,
              backgroundColor: t === tab ? 'action.selected' : 'transparent',
              ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            }}
          >
            {SIDE_TAB_LABEL[t]}
          </ButtonBase>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Hide panel">
          <IconButton aria-label="Hide side panel" size="small" onClick={onClose} sx={{ width: 22, height: 22 }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Box>
  );
}

/** The panel's left edge: drag it to change the width. */
function ResizeEdge({ width, onResize }: { width: number; onResize(width: number): void }) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onResize(width + (startX - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      onPointerDown={onPointerDown}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -4,
        width: 8,
        zIndex: 2,
        cursor: 'col-resize',
        ':hover::after': { opacity: 1 },
        '::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 3,
          width: 2,
          backgroundColor: 'primary.main',
          opacity: 0,
          transition: 'opacity 120ms ease',
        },
      }}
    />
  );
}
```

- [ ] **Step 4: Slim `SavvyAgentsPanel.tsx`**

In `apps/desktop/src/components/instances/savvy/SavvyAgentsPanel.tsx`:
1. `Props` becomes `{ snapshot: SavvyProgressSnapshot; at: number; width: number }` (delete `onResize`, `onClose` and their doc comment).
2. Signature: `export function SavvyAgentsPanel({ snapshot, at, width }: Props)`.
3. Root: replace `<Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>` + `<ResizeEdge width={width} onResize={onResize} />` with `<Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>`.
4. Header row: delete the `<Typography …>{s.pane}</Typography>` and the whole `<Tooltip title="Hide panel">…</Tooltip>`; keep the Collapse/Expand `TextButton`, right-aligned:
```tsx
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: `${PAD}px`, pb: 0.5 }}>
        <TextButton onClick={() => setIsCompact((v) => !v)}>{isCompact ? s.expand : s.collapse}</TextButton>
      </Box>
```
5. Delete the `ResizeEdge` function, and drop now-unused imports (`IconButton`, `Tooltip`, `CloseIcon`, `type PointerEvent as ReactPointerEvent`). Keep `PANEL_W` and `clampPanelWidth` exports; update the doc comment to "Agents tab body; SidePanel draws the chrome."

- [ ] **Step 5: Run to verify**

Run: `npx vitest run tests/client/instances/sidePanel.test.tsx`
Expected: PASS (11 tests). `tests/client/instances/savvyChrome.test.tsx` and typecheck now fail — Task 3 fixes them.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/instances/side/SidePanel.tsx apps/desktop/src/components/instances/savvy/SavvyAgentsPanel.tsx tests/client/instances/sidePanel.test.tsx
git commit -m "feat(side-panel): tabbed panel chrome; agents panel becomes a tab body

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Wire the side panel into `PaneCard`

**Files:**
- Modify: `apps/desktop/src/components/instances/savvy/useSavvyChrome.tsx` (full rewrite below)
- Modify: `apps/desktop/src/components/instances/PaneCard.tsx`
- Modify: `tests/client/instances/savvyChrome.test.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `useSidePanel`, `SideTab` (Task 1); `SidePanel` (Task 2); `SavvyAgentsPanel` new props (Task 2).
- Produces:
```ts
export interface SavvyChrome {
  bottomInset: number;
  band: ReactNode;
  /** Data for the Agents tab; null when there is nothing to show. */
  agents: { snapshot: SavvyProgressSnapshot; at: number } | null;
  /** Non-null while there are agents; changes when a new flow starts. */
  agentsAutoKey: string | null;
  panelToggles: number | undefined;
}
export function useSavvyChrome(instanceId: string, enabled: boolean, onToggleAgents: () => void): SavvyChrome;
```

- [ ] **Step 1: Rewrite the test** `tests/client/instances/savvyChrome.test.tsx`

Keep the file's existing imports, `vi.mock`, `beforeAll` (ResizeObserver, PointerEvent, localStorage stand-ins) and the `state()` factory unchanged; replace `Harness`, `tree`, `renderIt` and the `describe` block with:

```tsx
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
    expect(chrome.agentsAutoKey).toBeNull();
    expect(chrome.bottomInset).toBe(0);
  });

  it('stays out of shell panes even with a snapshot', () => {
    sp.value = state();
    renderIt(false);
    expect(chrome.agents).toBeNull();
    expect(chrome.band).toBeNull();
  });

  it('offers the band, the agents data and the flow as the auto-open key', () => {
    sp.value = state({ panelToggles: 3 });
    renderIt();
    expect(chrome.bottomInset).toBeGreaterThan(0);
    expect(chrome.agents?.snapshot.agents).toHaveLength(1);
    expect(chrome.agentsAutoKey).toBe('Port parser');
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
    expect(chrome.agentsAutoKey).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client/instances/savvyChrome.test.tsx`
Expected: FAIL — `chrome.agents` undefined / wrong arity.

- [ ] **Step 3: Rewrite `useSavvyChrome.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import type { SavvyProgressSnapshot } from '@watchtower/shared/savvyProgress.js';
import { useSavvyProgress } from '../../../state/useSavvyProgress.js';
import { SavvyProgressBand, BAND_BOX_H } from './SavvyProgressBand.js';
import { plannedOf } from './savvyDraw.js';

const GAP = 8;

export interface SavvyChrome {
  /** Space to keep free below the terminal for the band (0 when hidden). */
  bottomInset: number;
  band: ReactNode;
  /** Data for the Agents tab; null when there is nothing to show. */
  agents: { snapshot: SavvyProgressSnapshot; at: number } | null;
  /** Non-null while there are agents; changes when a new flow starts. */
  agentsAutoKey: string | null;
  /** The mod's `/agents-info` counter. */
  panelToggles: number | undefined;
}

/**
 * The savvy-progress mod's band below the terminal, plus the data its Agents
 * tab draws from. Nothing shows until the mod has posted something.
 */
export function useSavvyChrome(instanceId: string, enabled: boolean, onToggleAgents: () => void): SavvyChrome {
  const state = useSavvyProgress(instanceId);
  const snapshot = enabled ? state?.snapshot ?? null : null;
  const flow = snapshot?.flow ?? null;
  const agents = snapshot?.agents ?? [];
  const isWorking = agents.some((a) => a.status === 'running');
  const now = useTicker(isWorking);
  // Times in the snapshot are on the mod's clock; carry them onto ours.
  const at = now - (state ? state.receivedAt - state.snapshot.sentAt : 0);
  const [dismissedFlow, setDismissedFlow] = useState<string | null>(null);

  const crew = agents.length + plannedOf(flow, agents).length;
  const hasContent = snapshot != null && crew > 0;
  const isBandShown = flow != null && dismissedFlow !== flow.title;

  return {
    bottomInset: isBandShown ? BAND_BOX_H + GAP : 0,
    band:
      isBandShown && snapshot && flow ? (
        <SavvyProgressBand
          flow={flow}
          lang={snapshot.lang}
          crew={crew}
          isWorking={isWorking}
          onToggleAgents={onToggleAgents}
          onDismiss={() => setDismissedFlow(flow.title)}
        />
      ) : null,
    agents: hasContent && snapshot ? { snapshot, at } : null,
    agentsAutoKey: hasContent ? flow?.title ?? '' : null,
    panelToggles: snapshot?.panelToggles,
  };
}

/** Date.now(), re-read every second while `active` (running agents' clocks). */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
```

- [ ] **Step 4: Update `PaneCard.tsx`**

Imports — replace the `useSavvyChrome` import line and add:
```tsx
import { useSavvyChrome } from './savvy/useSavvyChrome.js';
import { SavvyAgentsPanel } from './savvy/SavvyAgentsPanel.js';
import { SidePanel } from './side/SidePanel.js';
import { useSidePanel, type SideTab } from './side/useSidePanel.js';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
```
Remove the `GroupsIcon` import if nothing else uses it.

Replace `const savvy = useSavvyChrome(instanceId, kind !== 'shell');` with:
```tsx
  // The right-side panel (Agents from the savvy-progress mod, Files in Task 9)
  // and the savvy band below the terminal, all drawn natively.
  const sideToggle = useRef<(tab: SideTab) => void>(() => {});
  const savvy = useSavvyChrome(instanceId, kind !== 'shell', () => sideToggle.current('agents'));
  const available: SideTab[] = savvy.agents ? ['agents'] : [];
  const side = useSidePanel({
    available,
    agentsAutoKey: savvy.agentsAutoKey,
    toggles: { agents: savvy.panelToggles },
  });
  sideToggle.current = side.toggle;
  const rightInset = side.isOpen ? side.width : 0;
```
(add `useRef` to the React import).

Then in the JSX:
1. Title-bar button: replace the `savvy.isPanelClosed && (…GroupsIcon…)` block with
```tsx
          {!side.isOpen && side.available.length > 0 && (
            <ChromeButton title="Show side panel" onClick={() => side.open()}>
              <ViewSidebarOutlinedIcon sx={{ fontSize: 15 }} />
            </ChromeButton>
          )}
```
2. Content box: `right: rightInset`, and the square-corner rule keyed on `side.isOpen`:
```tsx
          right: rightInset,
          bottom: savvy.bottomInset,
          ...(side.isOpen ? { '& > *': { borderBottomRightRadius: 0 } } : {}),
```
3. Replace the `{savvy.panel && (<Box …>{savvy.panel}</Box>)}` block with
```tsx
      {side.isOpen && side.tab && (
        <Box
          sx={{
            position: 'absolute',
            top: BAR_H,
            right: 0,
            bottom: savvy.bottomInset,
            width: rightInset,
            boxSizing: 'border-box',
            backgroundColor: cardBg,
            border: `1px solid ${cardBorder}`,
            borderTop: 'none',
            borderLeft: 'none',
            borderRadius: '0 0 12px 0',
            boxShadow: isDark ? '0 10px 28px rgba(0,0,0,0.40)' : '0 10px 26px rgba(15,18,24,0.16)',
          }}
        >
          <SidePanel
            tabs={side.available}
            tab={side.tab}
            width={side.width}
            onSelect={side.select}
            onClose={side.close}
            onResize={side.setWidth}
          >
            {side.tab === 'agents' && savvy.agents && (
              <SavvyAgentsPanel snapshot={savvy.agents.snapshot} at={savvy.agents.at} width={side.width} />
            )}
          </SidePanel>
        </Box>
      )}
```
The band box already spans `left: 0, right: 0` — leave it.

- [ ] **Step 5: Run to verify**

Run: `npx vitest run tests/client/instances/ && npm run typecheck:ci`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Full suite, then commit (end of Phase 1)**

Run: `npm test` — expected only the 7 known env failures.
```bash
git add apps/desktop/src/components/instances/savvy/useSavvyChrome.tsx apps/desktop/src/components/instances/PaneCard.tsx tests/client/instances/savvyChrome.test.tsx
git commit -m "feat(side-panel): the agents panel opens as a tab in the pane's side panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 2 — Native Files tab

### Task 4: Shared shapes, safe paths and folder listing

**Files:**
- Create: `packages/shared/src/fileTree.ts`
- Create: `orchestrator/services/fileTree.ts`
- Test: `tests/orchestrator/fileTree.test.ts`

**Interfaces:**
- Produces (shared):
```ts
export interface FileEntry { name: string; isDir: boolean; size: number; mtimeMs: number }
export interface FileListResult { dir: string; entries: FileEntry[]; truncated: number }
export type GitFileStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'ignored';
export interface GitFile { path: string; status: GitFileStatus; added: number; deleted: number }
export type FileTreeGit =
  | { isRepo: false }
  | { isRepo: true; branch: string; upstream: string | null; ahead: number; behind: number; files: GitFile[] };
```
- Produces (orchestrator):
```ts
export const OUTSIDE_ROOT = 'Path is outside the instance folder';
export async function resolveInside(root: string, rel: string): Promise<string>;
export async function listDir(root: string, dir: string, limit?: number): Promise<FileListResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDir, resolveInside, OUTSIDE_ROOT } from '../../orchestrator/services/fileTree.js';

let root: string;
let outside: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wt-ft-')));
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'wt-out-')));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'a dir'));
  writeFileSync(path.join(root, 'b.txt'), 'hello');
  writeFileSync(path.join(root, 'A.md'), '#');
  writeFileSync(path.join(root, 'src', 'žluťoučký.ts'), 'x');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('listDir', () => {
  it('lists folders first, then files, by name, with size and mtime', async () => {
    const res = await listDir(root, '');
    expect(res.dir).toBe('');
    expect(res.entries.map((e) => e.name)).toEqual(['a dir', 'src', 'A.md', 'b.txt']);
    const b = res.entries.find((e) => e.name === 'b.txt');
    expect(b).toMatchObject({ isDir: false, size: 5 });
    expect(b?.mtimeMs).toBeGreaterThan(0);
    expect(res.truncated).toBe(0);
  });

  it('lists a subfolder by its relative path, unicode names included', async () => {
    const res = await listDir(root, 'src');
    expect(res.entries.map((e) => e.name)).toEqual(['žluťoučký.ts']);
  });

  it('caps the listing and reports the rest', async () => {
    for (let i = 0; i < 5; i++) writeFileSync(path.join(root, `f${i}`), '');
    const res = await listDir(root, '', 3);
    expect(res.entries).toHaveLength(3);
    expect(res.truncated).toBe(6);
  });

  it('shows a symlink that leaves the folder as a plain file (not expandable)', async () => {
    symlinkSync(outside, path.join(root, 'escape'));
    const res = await listDir(root, '');
    expect(res.entries.find((e) => e.name === 'escape')).toMatchObject({ isDir: false });
  });
});

describe('resolveInside', () => {
  it('refuses ../ and symlink escapes', async () => {
    symlinkSync(outside, path.join(root, 'escape'));
    await expect(resolveInside(root, '../')).rejects.toThrow(OUTSIDE_ROOT);
    await expect(resolveInside(root, 'escape')).rejects.toThrow(OUTSIDE_ROOT);
    await expect(listDir(root, 'escape')).rejects.toThrow(OUTSIDE_ROOT);
  });

  it('accepts the root and folders inside it', async () => {
    expect(await resolveInside(root, '')).toBe(root);
    expect(await resolveInside(root, 'src')).toBe(path.join(root, 'src'));
  });

  it('rejects a root that no longer exists', async () => {
    rmSync(root, { recursive: true, force: true });
    await expect(listDir(root, '')).rejects.toThrow(/ENOENT/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/fileTree.test.ts`
Expected: FAIL — cannot resolve `orchestrator/services/fileTree.js`.

- [ ] **Step 3: Implement the shared shapes** `packages/shared/src/fileTree.ts`

```ts
// Shapes for the native Files tab (orchestrator/services/fileTree.ts) and the
// filetree mod's activity bridge (plugins/filetree → POST /mods/filetree).

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

/** One folder's listing; `dir` is relative to the instance cwd ('' = the cwd). */
export interface FileListResult {
  dir: string;
  entries: FileEntry[];
  /** Entries left out past the cap. */
  truncated: number;
}

export type GitFileStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'ignored';

/** `path` is relative to the cwd; an ignored folder has no trailing slash. */
export interface GitFile {
  path: string;
  status: GitFileStatus;
  added: number;
  deleted: number;
}

export type FileTreeGit =
  | { isRepo: false }
  | { isRepo: true; branch: string; upstream: string | null; ahead: number; behind: number; files: GitFile[] };
```

- [ ] **Step 4: Implement listing** `orchestrator/services/fileTree.ts`

```ts
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, FileListResult } from '@watchtower/shared/fileTree.js';

export const OUTSIDE_ROOT = 'Path is outside the instance folder';
const LIST_LIMIT = 5_000;

/** Absolute real path of `rel` under `root`; throws when it resolves outside `root`. */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = await realpath(path.resolve(realRoot, rel));
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw new Error(OUTSIDE_ROOT);
  return target;
}

/** One folder's entries: folders first, then files, by name; capped at `limit`. */
export async function listDir(root: string, dir: string, limit = LIST_LIMIT): Promise<FileListResult> {
  const realRoot = await realpath(root);
  const abs = await resolveInside(realRoot, dir);
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const d of dirents) {
    const full = path.join(abs, d.name);
    try {
      const l = await lstat(full);
      let isDir = l.isDirectory();
      let s = l;
      if (l.isSymbolicLink()) {
        // A link is expandable only when it stays inside the cwd.
        const inside = await resolveInside(realRoot, path.relative(realRoot, full)).then(() => true, () => false);
        s = inside ? await stat(full) : l;
        isDir = inside && s.isDirectory();
      }
      entries.push({ name: d.name, isDir, size: isDir ? 0 : s.size, mtimeMs: s.mtimeMs });
    } catch {
      // Vanished between readdir and lstat; skip it.
    }
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : a.isDir ? -1 : 1));
  return { dir, entries: entries.slice(0, limit), truncated: Math.max(0, entries.length - limit) };
}
```

Note the expected order in the test `['a dir', 'src', 'A.md', 'b.txt']` relies on base-sensitivity compare (`A.md` < `b.txt`).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/fileTree.test.ts && npm run typecheck:ci`
Expected: PASS (7 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fileTree.ts orchestrator/services/fileTree.ts tests/orchestrator/fileTree.test.ts
git commit -m "feat(files): safe folder listing for the native file tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Git status, line counts and branch

**Files:**
- Modify: `orchestrator/services/fileTree.ts`
- Test: `tests/orchestrator/fileTree.test.ts` (append)

**Interfaces:**
- Consumes: `FileTreeGit`, `GitFile`, `GitFileStatus` (Task 4).
- Produces:
```ts
export interface StatusV2 { branch: string; upstream: string | null; ahead: number; behind: number; files: Map<string, GitFileStatus> }
export function parseStatusV2(out: string): StatusV2;
export function parseNumstat(out: string): Map<string, { added: number; deleted: number }>;
export async function readGit(root: string): Promise<FileTreeGit>;
```

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { execFileSync } from 'node:child_process';
import { parseStatusV2, parseNumstat, readGit } from '../../orchestrator/services/fileTree.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

describe('parseStatusV2', () => {
  it('reads branch headers and every entry kind, renames and spaces included', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a a src/app.ts',
      '1 A. N... 000000 100644 100644 0 a new file.ts',
      '1 .D N... 100644 100644 000000 a a gone.ts',
      '2 R. N... 100644 100644 100644 a a R100 renamed.ts',
      'old name.ts',
      '? notes.md',
      '! node_modules/',
      '',
    ].join('\0');
    const s = parseStatusV2(out);
    expect(s).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(Object.fromEntries(s.files)).toEqual({
      'src/app.ts': 'modified',
      'new file.ts': 'added',
      'gone.ts': 'deleted',
      'renamed.ts': 'renamed',
      'notes.md': 'untracked',
      node_modules: 'ignored',
    });
  });

  it('a detached head and no upstream', () => {
    const s = parseStatusV2(['# branch.head (detached)', ''].join('\0'));
    expect(s).toMatchObject({ branch: '(detached)', upstream: null, ahead: 0, behind: 0 });
  });
});

describe('parseNumstat', () => {
  it('reads counts, treats binary as 0, and keys renames by the new path', () => {
    const out = ['3\t1\tsrc/app.ts', '-\t-\timg.png', '2\t2\t', 'old name.ts', 'renamed.ts', ''].join('\0');
    expect(Object.fromEntries(parseNumstat(out))).toEqual({
      'src/app.ts': { added: 3, deleted: 1 },
      'img.png': { added: 0, deleted: 0 },
      'renamed.ts': { added: 2, deleted: 2 },
    });
  });
});

describe('readGit', () => {
  it('outside a repo: isRepo false', async () => {
    expect(await readGit(root)).toEqual({ isRepo: false });
  });

  it('a repo with no commits yet: untracked files and the branch name', async () => {
    git(root, 'init', '-q', '-b', 'main');
    const g = await readGit(root);
    expect(g.isRepo).toBe(true);
    if (!g.isRepo) return;
    expect(g.branch).toBe('main');
    expect(g.files.find((f) => f.path === 'b.txt')).toMatchObject({ status: 'untracked', added: 0, deleted: 0 });
  });

  it('a committed repo: modified with line counts, ignored folders', async () => {
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(root, '.gitignore'), 'build/\n');
    mkdirSync(path.join(root, 'build'));
    writeFileSync(path.join(root, 'build', 'out.js'), '');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'init');
    writeFileSync(path.join(root, 'b.txt'), 'hello\nworld\n');
    const g = await readGit(root);
    if (!g.isRepo) throw new Error('expected a repo');
    expect(g.files.find((f) => f.path === 'b.txt')).toMatchObject({ status: 'modified', added: 2, deleted: 1 });
    expect(g.files.find((f) => f.path === 'build')).toMatchObject({ status: 'ignored' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/fileTree.test.ts`
Expected: FAIL — `parseStatusV2` is not exported.

- [ ] **Step 3: Implement** (append to `orchestrator/services/fileTree.ts`; extend the shared import to `import type { FileEntry, FileListResult, FileTreeGit, GitFile, GitFileStatus } from '@watchtower/shared/fileTree.js';` and add `import { execFile } from 'node:child_process';`)

```ts
const GIT_TIMEOUT = 5_000;

export interface StatusV2 {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: Map<string, GitFileStatus>;
}

/** Parses `git status --porcelain=v2 --branch -z --ignored=matching`. */
export function parseStatusV2(out: string): StatusV2 {
  const s: StatusV2 = { branch: '', upstream: null, ahead: 0, behind: 0, files: new Map() };
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? '';
    if (f.startsWith('# branch.head ')) s.branch = f.slice(14);
    else if (f.startsWith('# branch.upstream ')) s.upstream = f.slice(18);
    else if (f.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(f);
      s.ahead = Number(m?.[1] ?? 0);
      s.behind = Number(m?.[2] ?? 0);
    } else if (f.startsWith('1 ')) {
      const parts = f.split(' ');
      s.files.set(parts.slice(8).join(' '), statusOf(parts[1] ?? '..'));
    } else if (f.startsWith('2 ')) {
      // A rename: the new path ends this field, the original path is the next one.
      s.files.set(f.split(' ').slice(9).join(' '), 'renamed');
      i++;
    } else if (f.startsWith('? ')) s.files.set(f.slice(2), 'untracked');
    else if (f.startsWith('! ')) s.files.set(f.slice(2).replace(/\/$/, ''), 'ignored');
  }
  return s;
}

function statusOf(xy: string): GitFileStatus {
  if (xy.includes('D')) return 'deleted';
  if (xy[0] === 'A') return 'added';
  if (xy.includes('R')) return 'renamed';
  return 'modified';
}

/** Parses `git diff --numstat -z`; renames are keyed by their new path, binary counts as 0. */
export function parseNumstat(out: string): Map<string, { added: number; deleted: number }> {
  const res = new Map<string, { added: number; deleted: number }>();
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(fields[i] ?? '');
    if (!m) continue;
    const counts = { added: m[1] === '-' ? 0 : Number(m[1]), deleted: m[2] === '-' ? 0 : Number(m[2]) };
    if (m[3]) res.set(m[3], counts);
    else {
      // Rename: the old and the new path follow as their own fields.
      res.set(fields[i + 2] ?? '', counts);
      i += 2;
    }
  }
  return res;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', ...args], { cwd, timeout: GIT_TIMEOUT, maxBuffer: 32 * 1024 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

/** Branch, upstream and per-file status with line counts; `{ isRepo: false }` outside a repo or without git. */
export async function readGit(root: string): Promise<FileTreeGit> {
  let status: StatusV2;
  try {
    status = parseStatusV2(await runGit(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=matching']));
  } catch {
    return { isRepo: false };
  }
  // No commits yet: there is no HEAD to diff against.
  const numstat = parseNumstat(await runGit(root, ['diff', '--numstat', '-z', 'HEAD']).catch(() => ''));
  const files: GitFile[] = [...status.files].map(([p, st]) => ({ path: p, status: st, ...(numstat.get(p) ?? { added: 0, deleted: 0 }) }));
  return { isRepo: true, branch: status.branch, upstream: status.upstream, ahead: status.ahead, behind: status.behind, files };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/fileTree.test.ts && npm run typecheck:ci`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/fileTree.ts tests/orchestrator/fileTree.test.ts
git commit -m "feat(files): git status, line counts and branch for the file tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: File name search

**Files:**
- Modify: `orchestrator/services/fileTree.ts`
- Test: `tests/orchestrator/fileTree.test.ts` (append)

**Interfaces:**
- Produces:
```ts
export function rankMatches(paths: readonly string[], query: string, limit?: number): string[];
export async function searchFiles(root: string, query: string, limit?: number): Promise<string[]>;
```

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { rankMatches, searchFiles } from '../../orchestrator/services/fileTree.js';

describe('rankMatches', () => {
  it('ranks basename matches above path-only matches, then shorter paths, case-insensitively', () => {
    const paths = ['docs/panel/readme.md', 'src/SidePanel.tsx', 'src/side/panel.ts', 'lib/a.ts'];
    expect(rankMatches(paths, 'PANEL')).toEqual(['src/side/panel.ts', 'src/SidePanel.tsx', 'docs/panel/readme.md']);
  });

  it('an empty query matches nothing; results are capped', () => {
    expect(rankMatches(['a'], '  ')).toEqual([]);
    expect(rankMatches(['a1', 'a2', 'a3'], 'a', 2)).toHaveLength(2);
  });
});

describe('searchFiles', () => {
  it('in a repo: tracked and untracked files, ignored ones left out', async () => {
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(root, '.gitignore'), 'secret.txt\n');
    writeFileSync(path.join(root, 'secret.txt'), '');
    expect(await searchFiles(root, 'txt')).toEqual(['b.txt']);
  });

  it('outside a repo: walks the folder, skipping node_modules', async () => {
    mkdirSync(path.join(root, 'node_modules'));
    writeFileSync(path.join(root, 'node_modules', 'b.txt'), '');
    expect(await searchFiles(root, 'b.txt')).toEqual(['b.txt']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/fileTree.test.ts`
Expected: FAIL — `rankMatches` is not exported.

- [ ] **Step 3: Implement** (append)

```ts
const SEARCH_LIMIT = 200;
const WALK_LIMIT = 20_000;
const WALK_SKIP = new Set(['.git', 'node_modules']);

/** Case-insensitive name match: basename hits first, then shorter paths, then by name. */
export function rankMatches(paths: readonly string[], query: string, limit = SEARCH_LIMIT): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { p: string; rank: number }[] = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (!lower.includes(q)) continue;
    scored.push({ p, rank: path.posix.basename(lower).includes(q) ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.p.length - b.p.length || a.p.localeCompare(b.p));
  return scored.slice(0, limit).map((s) => s.p);
}

/** File paths under `root` matching `query`; git's file list in a repo, a capped walk elsewhere. */
export async function searchFiles(root: string, query: string, limit = SEARCH_LIMIT): Promise<string[]> {
  let paths: string[];
  try {
    const out = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    paths = out.split('\0').filter(Boolean);
  } catch {
    paths = await walk(root);
  }
  return rankMatches(paths, query, limit);
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [''];
  while (queue.length && out.length < WALK_LIMIT) {
    const rel = queue.shift() ?? '';
    const dirents = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const d of dirents) {
      const p = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!WALK_SKIP.has(d.name)) queue.push(p);
      } else out.push(p);
      if (out.length >= WALK_LIMIT) break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/fileTree.test.ts && npm run typecheck:ci`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/fileTree.ts tests/orchestrator/fileTree.test.ts
git commit -m "feat(files): file name search for the file tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Ref-counted folder watchers

**Files:**
- Create: `orchestrator/services/fileTreeWatchers.ts`
- Test: `tests/orchestrator/fileTreeWatchers.test.ts`

**Interfaces:**
- Produces:
```ts
export type WatchFn = (dir: string, onEvent: (filename: string | null) => void) => { close(): void };
export class FileTreeWatchers {
  constructor(watchFn: WatchFn, onChange: (instanceId: string) => void, debounceMs?: number);
  watch(cwd: string, instanceId: string): void;
  unwatch(instanceId: string): void;
}
export const nodeWatch: WatchFn; // fs.watch(dir, { recursive: true }, ...)
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTreeWatchers, type WatchFn } from '../../orchestrator/services/fileTreeWatchers.js';

let emitters: Map<string, (f: string | null) => void>;
let closed: string[];
const fakeWatch: WatchFn = (dir, onEvent) => {
  emitters.set(dir, onEvent);
  return { close: () => closed.push(dir) };
};

beforeEach(() => {
  vi.useFakeTimers();
  emitters = new Map();
  closed = [];
});
afterEach(() => vi.useRealTimers());

describe('FileTreeWatchers', () => {
  it('one watcher per folder, debounced, telling every watching pane', () => {
    const changed: string[] = [];
    const w = new FileTreeWatchers(fakeWatch, (id) => changed.push(id), 300);
    w.watch('/repo', 'a');
    w.watch('/repo', 'b');
    expect(emitters.size).toBe(1);
    emitters.get('/repo')?.('src/x.ts');
    emitters.get('/repo')?.('src/y.ts');
    vi.advanceTimersByTime(299);
    expect(changed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changed.sort()).toEqual(['a', 'b']);
  });

  it('ignores .git noise except index and HEAD', () => {
    const changed: string[] = [];
    const w = new FileTreeWatchers(fakeWatch, (id) => changed.push(id), 300);
    w.watch('/repo', 'a');
    emitters.get('/repo')?.('.git/objects/ab/cdef');
    vi.advanceTimersByTime(400);
    expect(changed).toEqual([]);
    emitters.get('/repo')?.('.git/index');
    vi.advanceTimersByTime(400);
    expect(changed).toEqual(['a']);
  });

  it('closing one pane keeps the folder watched for the other; the last one closes it', () => {
    const changed: string[] = [];
    const w = new FileTreeWatchers(fakeWatch, (id) => changed.push(id), 300);
    w.watch('/repo', 'a');
    w.watch('/repo', 'b');
    w.unwatch('a');
    expect(closed).toEqual([]);
    emitters.get('/repo')?.('x');
    vi.advanceTimersByTime(300);
    expect(changed).toEqual(['b']);
    w.unwatch('b');
    expect(closed).toEqual(['/repo']);
  });

  it('a pane switching folders moves its watch', () => {
    const w = new FileTreeWatchers(fakeWatch, () => {}, 300);
    w.watch('/one', 'a');
    w.watch('/two', 'a');
    expect(closed).toEqual(['/one']);
    expect([...emitters.keys()]).toEqual(['/one', '/two']);
  });

  it('a watcher that fails to start leaves nothing behind', () => {
    const w = new FileTreeWatchers(() => { throw new Error('EMFILE'); }, () => {}, 300);
    expect(() => w.watch('/repo', 'a')).not.toThrow();
    expect(() => w.unwatch('a')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/fileTreeWatchers.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```ts
import { watch } from 'node:fs';

export type WatchFn = (dir: string, onEvent: (filename: string | null) => void) => { close(): void };

/** Recursive fs.watch; macOS supports `recursive` natively. */
export const nodeWatch: WatchFn = (dir, onEvent) => watch(dir, { recursive: true }, (_ev, filename) => onEvent(filename ? String(filename) : null));

interface Entry {
  close(): void;
  ids: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** One recursive watcher per folder, shared by every pane showing it; tells each pane after a quiet spell. */
export class FileTreeWatchers {
  private byCwd = new Map<string, Entry>();
  private cwdOf = new Map<string, string>();

  constructor(
    private readonly watchFn: WatchFn,
    private readonly onChange: (instanceId: string) => void,
    private readonly debounceMs = 300,
  ) {}

  watch(cwd: string, instanceId: string): void {
    if (this.cwdOf.get(instanceId) === cwd) return;
    this.unwatch(instanceId);
    let entry = this.byCwd.get(cwd);
    if (!entry) {
      const fresh: Entry = { close: () => {}, ids: new Set(), timer: null };
      try {
        fresh.close = this.watchFn(cwd, (f) => this.onEvent(fresh, f)).close;
      } catch {
        return; // No live refresh for this folder; the tab still lists on demand.
      }
      entry = fresh;
      this.byCwd.set(cwd, entry);
    }
    entry.ids.add(instanceId);
    this.cwdOf.set(instanceId, cwd);
  }

  unwatch(instanceId: string): void {
    const cwd = this.cwdOf.get(instanceId);
    if (cwd === undefined) return;
    this.cwdOf.delete(instanceId);
    const entry = this.byCwd.get(cwd);
    if (!entry) return;
    entry.ids.delete(instanceId);
    if (entry.ids.size > 0) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.close();
    this.byCwd.delete(cwd);
  }

  private onEvent(entry: Entry, filename: string | null): void {
    const f = filename?.split('\\').join('/') ?? '';
    if ((f === '.git' || f.startsWith('.git/')) && f !== '.git/index' && f !== '.git/HEAD') return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      for (const id of entry.ids) this.onChange(id);
    }, this.debounceMs);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/fileTreeWatchers.test.ts && npm run typecheck:ci`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/fileTreeWatchers.ts tests/orchestrator/fileTreeWatchers.test.ts
git commit -m "feat(files): shared folder watchers that refresh the file tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: IPC wiring and the `useFileTree` hook

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (request union near line 87, response union near line 781, push union near line 1000)
- Modify: `packages/shared/src/messagePort.ts` (request near line 82, response near line 682, push near line 754)
- Modify: `orchestrator/index.ts` (imports near line 90, construction near line 226, `disposeInstance` near line 756, IPC switch near line 1571)
- Modify: `apps/desktop/src/state/ipc.ts` (`SILENT_KINDS`)
- Create: `apps/desktop/src/state/useFileTree.ts`
- Test: `tests/client/useFileTree.test.tsx`

**Interfaces:**
- Consumes: `listDir`, `readGit`, `searchFiles` (Tasks 4–6), `FileTreeWatchers`, `nodeWatch` (Task 7), shared shapes (Task 4).
- Produces (IPC):
  - `fileTree:list` `{ instanceId: string; dir: string }` → `FileListResult`
  - `fileTree:git` `{ instanceId: string }` → `FileTreeGit`
  - `fileTree:search` `{ instanceId: string; query: string }` → `string[]`
  - `fileTree:watch` / `fileTree:unwatch` `{ instanceId: string }` → `{ ok: true }`
  - push `fileTreeChanged` `{ instanceId: string }`
- Produces (hook):
```ts
export interface FileTreeState {
  listings: ReadonlyMap<string, FileListResult>;
  expanded: ReadonlySet<string>;
  git: FileTreeGit | null;
  error: string | null;
  toggle(dir: string): void;
  reveal(filePath: string): void;
  search(query: string): Promise<string[]>;
}
export function useFileTree(instanceId: string, enabled: boolean): FileTreeState;
```

- [ ] **Step 1: Add the IPC kinds**

`packages/shared/src/ipcContract.ts` — after the `savvyProgress:get` request line:
```ts
  | { kind: 'fileTree:list'; payload: { instanceId: string; dir: string } }
  | { kind: 'fileTree:git'; payload: { instanceId: string } }
  | { kind: 'fileTree:search'; payload: { instanceId: string; query: string } }
  | { kind: 'fileTree:watch'; payload: { instanceId: string } }
  | { kind: 'fileTree:unwatch'; payload: { instanceId: string } }
```
after the `savvyProgress:get` response line:
```ts
  | { kind: 'fileTree:list'; payload: import('./fileTree.js').FileListResult }
  | { kind: 'fileTree:git'; payload: import('./fileTree.js').FileTreeGit }
  | { kind: 'fileTree:search'; payload: string[] }
  | { kind: 'fileTree:watch'; payload: { ok: true } }
  | { kind: 'fileTree:unwatch'; payload: { ok: true } }
```
after the `savvyProgress` push line:
```ts
  | { kind: 'fileTreeChanged'; payload: { instanceId: string } }
```
`packages/shared/src/messagePort.ts` — the same three blocks next to their `savvyProgress` lines, request entries with the leading `id: string;` field, e.g. `| { id: string; kind: 'fileTree:list'; payload: { instanceId: string; dir: string } }`.

- [ ] **Step 2: Handle them in the orchestrator** (`orchestrator/index.ts`)

Imports:
```ts
import { listDir, readGit, searchFiles } from './services/fileTree.js';
import { FileTreeWatchers, nodeWatch } from './services/fileTreeWatchers.js';
```
After the `savvyProgress` store construction:
```ts
// Native Files tab: folder watchers shared by every pane on the same cwd.
const fileTreeWatchers = new FileTreeWatchers(nodeWatch, (instanceId) =>
  emitPush({ kind: 'fileTreeChanged', payload: { instanceId } }),
);

function cwdOfInstance(instanceId: string): string {
  const row = handle ? repo().get(instanceId) : null;
  if (!row) throw new Error('Unknown instance');
  return row.cwd;
}
```
In the instance disposal function, after `savvyProgress.dispose(id);`:
```ts
  fileTreeWatchers.unwatch(id);
```
In the IPC switch, after the `savvyProgress:get` case:
```ts
    case 'fileTree:list':
      return listDir(cwdOfInstance(req.payload.instanceId), req.payload.dir);

    case 'fileTree:git':
      return readGit(cwdOfInstance(req.payload.instanceId));

    case 'fileTree:search':
      return searchFiles(cwdOfInstance(req.payload.instanceId), req.payload.query);

    case 'fileTree:watch':
      fileTreeWatchers.watch(cwdOfInstance(req.payload.instanceId), req.payload.instanceId);
      return { ok: true };

    case 'fileTree:unwatch':
      fileTreeWatchers.unwatch(req.payload.instanceId);
      return { ok: true };
```

- [ ] **Step 3: Silence the background kinds** (`apps/desktop/src/state/ipc.ts`, inside `SILENT_KINDS`)

```ts
  'fileTree:git',     // file tree git status, re-read on every folder change
  'fileTree:search',  // search-as-you-type; the tab shows its own empty state
  'fileTree:watch',   // live refresh is best-effort
  'fileTree:unwatch',
```

- [ ] **Step 4: Write the failing hook test** `tests/client/useFileTree.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { FileListResult } from '@watchtower/shared/fileTree.js';

const calls: { kind: string; payload: unknown }[] = [];
let pushes: ((p: { instanceId: string }) => void)[] = [];
const listings: Record<string, FileListResult> = {
  '': { dir: '', entries: [{ name: 'src', isDir: true, size: 0, mtimeMs: 1 }, { name: 'a.ts', isDir: false, size: 1, mtimeMs: 1 }], truncated: 0 },
  src: { dir: 'src', entries: [{ name: 'deep', isDir: true, size: 0, mtimeMs: 1 }], truncated: 0 },
  'src/deep': { dir: 'src/deep', entries: [{ name: 'x.ts', isDir: false, size: 1, mtimeMs: 1 }], truncated: 0 },
};
vi.mock('../../apps/desktop/src/state/ipc', () => ({
  invoke: vi.fn(async (kind: string, payload: { dir?: string }) => {
    calls.push({ kind, payload });
    if (kind === 'fileTree:list') {
      const l = listings[payload.dir ?? ''];
      if (!l) throw new Error('ENOENT: no such file or directory');
      return l;
    }
    if (kind === 'fileTree:git') return { isRepo: false };
    if (kind === 'fileTree:search') return ['src/deep/x.ts'];
    return { ok: true };
  }),
}));

import { useFileTree } from '../../apps/desktop/src/state/useFileTree';

beforeEach(() => {
  calls.length = 0;
  pushes = [];
  (window as unknown as { watchtower: unknown }).watchtower = {
    on: (kind: string, cb: (p: { instanceId: string }) => void) => {
      if (kind === 'fileTreeChanged') pushes.push(cb);
      return () => {};
    },
  };
});

describe('useFileTree', () => {
  it('watches, lists the root and reads git when enabled; unwatches on unmount', async () => {
    const { result, unmount } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    expect(result.current.git).toEqual({ isRepo: false });
    expect(calls.map((c) => c.kind)).toEqual(expect.arrayContaining(['fileTree:watch', 'fileTree:list', 'fileTree:git']));
    unmount();
    expect(calls.at(-1)?.kind).toBe('fileTree:unwatch');
  });

  it('does nothing while disabled', () => {
    renderHook(() => useFileTree('i1', false));
    expect(calls).toEqual([]);
  });

  it('toggle expands and lists a folder, then collapses it', async () => {
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    act(() => result.current.toggle('src'));
    await waitFor(() => expect(result.current.listings.get('src')).toBeDefined());
    expect(result.current.expanded.has('src')).toBe(true);
    act(() => result.current.toggle('src'));
    expect(result.current.expanded.has('src')).toBe(false);
  });

  it('reveal expands every ancestor of a file', async () => {
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    act(() => result.current.reveal('src/deep/x.ts'));
    await waitFor(() => expect(result.current.listings.get('src/deep')).toBeDefined());
    expect([...result.current.expanded].sort()).toEqual(['src', 'src/deep']);
  });

  it('a change push re-lists open folders and git, silently', async () => {
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    calls.length = 0;
    act(() => pushes.forEach((p) => p({ instanceId: 'i1' })));
    await waitFor(() => expect(calls.some((c) => c.kind === 'fileTree:git')).toBe(true));
    expect(calls.filter((c) => c.kind === 'fileTree:list').map((c) => (c.payload as { dir: string }).dir)).toEqual(['']);
  });

  it('a missing folder becomes an inline error, not a retry loop', async () => {
    listings[''] = undefined as unknown as FileListResult;
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.error).toBe('Folder not found'));
    listings[''] = { dir: '', entries: [], truncated: 0 };
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run tests/client/useFileTree.test.tsx`
Expected: FAIL — cannot resolve `state/useFileTree`.

- [ ] **Step 6: Implement** `apps/desktop/src/state/useFileTree.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileListResult, FileTreeGit } from '@watchtower/shared/fileTree.js';
import { invoke } from './ipc';

export interface FileTreeState {
  listings: ReadonlyMap<string, FileListResult>;
  expanded: ReadonlySet<string>;
  git: FileTreeGit | null;
  /** Inline message when the root can't be listed. */
  error: string | null;
  toggle(dir: string): void;
  reveal(filePath: string): void;
  search(query: string): Promise<string[]>;
}

const ancestorsOf = (p: string): string[] => {
  const parts = p.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

/** One pane's file tree: folder listings, git status and live refresh while `enabled`. */
export function useFileTree(instanceId: string, enabled: boolean): FileTreeState {
  const [listings, setListings] = useState<Map<string, FileListResult>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<FileTreeGit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const load = useCallback(
    async (dir: string, silent: boolean) => {
      try {
        const res = await invoke('fileTree:list', { instanceId, dir }, { silent });
        setListings((prev) => new Map(prev).set(dir, res));
        if (dir === '') setError(null);
      } catch (err) {
        if (dir === '') setError(/ENOENT/.test(String(err)) ? 'Folder not found' : String((err as Error).message ?? err));
      }
    },
    [instanceId],
  );
  const loadGit = useCallback(() => {
    invoke('fileTree:git', { instanceId }).then(setGit, () => setGit({ isRepo: false }));
  }, [instanceId]);

  useEffect(() => {
    if (!enabled) return;
    setListings(new Map());
    setExpanded(new Set());
    setGit(null);
    void invoke('fileTree:watch', { instanceId }).catch(() => {});
    // The first root listing may toast; later refreshes stay quiet.
    void load('', false);
    loadGit();
    const off = window.watchtower.on('fileTreeChanged', (p) => {
      if (p.instanceId !== instanceId) return;
      for (const dir of ['', ...expandedRef.current]) void load(dir, true);
      loadGit();
    });
    return () => {
      off();
      void invoke('fileTree:unwatch', { instanceId }).catch(() => {});
    };
  }, [instanceId, enabled, load, loadGit]);

  const toggle = (dir: string) => {
    const isOpen = expanded.has(dir);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(dir);
      else next.add(dir);
      return next;
    });
    if (!isOpen) void load(dir, false);
  };

  const reveal = (filePath: string) => {
    const dirs = ancestorsOf(filePath);
    setExpanded((prev) => new Set([...prev, ...dirs]));
    for (const d of dirs) if (!listings.has(d)) void load(d, true);
  };

  const search = (query: string) => invoke('fileTree:search', { instanceId, query });

  return { listings, expanded, git, error, toggle, reveal, search };
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/client/useFileTree.test.tsx && npm run typecheck:ci`
Expected: PASS (6 tests); typecheck clean across all workspaces (the WS transport and iPad/iPhone apps share `ipcContract.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/index.ts apps/desktop/src/state/ipc.ts apps/desktop/src/state/useFileTree.ts tests/client/useFileTree.test.tsx
git commit -m "feat(files): file tree IPC and the useFileTree hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: `FilesTab` UI and the Files tab in `PaneCard`

**Files:**
- Create: `apps/desktop/src/components/instances/side/fileTreeModel.ts`
- Create: `apps/desktop/src/components/instances/side/FilesTab.tsx`
- Modify: `apps/desktop/src/components/instances/PaneCard.tsx`
- Test: `tests/client/instances/fileTreeModel.test.ts`, `tests/client/instances/filesTab.test.tsx`

**Interfaces:**
- Consumes: `FileTreeState` / `useFileTree` (Task 8); shared shapes (Task 4); `SideTab`, `useSidePanel` (Task 1).
- Produces:
```ts
// fileTreeModel.ts
export interface TreeRow { path: string; name: string; depth: number; isDir: boolean; size: number; mtimeMs: number; isOpen: boolean; isMore?: boolean }
export function buildRows(listings: ReadonlyMap<string, FileListResult>, expanded: ReadonlySet<string>): TreeRow[];
export interface GitIndex { files: Map<string, GitFile>; dirTotals: Map<string, { added: number; deleted: number; changed: number }>; ignored: Set<string> }
export function indexGit(git: FileTreeGit | null): GitIndex;
export function rowStatus(path: string, idx: GitIndex): GitFileStatus | null;
export function branchLabel(git: FileTreeGit | null): string;
// FilesTab.tsx
export function FilesTab(props: { tree: FileTreeState; flash?: ReadonlyMap<string, { kind: 'read' | 'write'; at: number }> }): JSX.Element;
```

- [ ] **Step 1: Write the failing model tests** `tests/client/instances/fileTreeModel.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { FileListResult, FileTreeGit } from '@watchtower/shared/fileTree.js';
import { buildRows, indexGit, rowStatus, branchLabel } from '../../../apps/desktop/src/components/instances/side/fileTreeModel';

const ls = (dir: string, names: [string, boolean][]): [string, FileListResult] => [
  dir,
  { dir, entries: names.map(([name, isDir]) => ({ name, isDir, size: 1, mtimeMs: 1 })), truncated: 0 },
];

describe('buildRows', () => {
  it('flattens only expanded folders, depth-first', () => {
    const listings = new Map([ls('', [['src', true], ['lib', true], ['a.ts', false]]), ls('src', [['b.ts', false]]), ls('lib', [['c.ts', false]])]);
    const rows = buildRows(listings, new Set(['src']));
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.path}`)).toEqual(['src', '  src/b.ts', 'lib', 'a.ts']);
    expect(rows[0]?.isOpen).toBe(true);
  });

  it('adds a "+N more" row after any capped folder', () => {
    const [, sub] = ls('src', [['b.ts', false]]);
    const listings = new Map([ls('', [['src', true]]), ['src', { ...sub, truncated: 7 }] as [string, FileListResult]]);
    const rows = buildRows(listings, new Set(['src']));
    expect(rows.at(-1)).toMatchObject({ name: '+7 more', depth: 1, isMore: true });
  });
});

const repo: FileTreeGit = {
  isRepo: true,
  branch: 'main',
  upstream: 'origin/main',
  ahead: 2,
  behind: 0,
  files: [
    { path: 'src/a.ts', status: 'modified', added: 3, deleted: 1 },
    { path: 'src/deep/b.ts', status: 'untracked', added: 0, deleted: 0 },
    { path: 'build', status: 'ignored', added: 0, deleted: 0 },
  ],
};

describe('indexGit / rowStatus', () => {
  it('sums changes into every ancestor folder; ignored files do not count', () => {
    const idx = indexGit(repo);
    expect(idx.dirTotals.get('src')).toEqual({ added: 3, deleted: 1, changed: 2 });
    expect(idx.dirTotals.get('src/deep')).toEqual({ added: 0, deleted: 0, changed: 1 });
    expect(idx.dirTotals.has('build')).toBe(false);
  });

  it('a file under an ignored folder reads as ignored', () => {
    const idx = indexGit(repo);
    expect(rowStatus('src/a.ts', idx)).toBe('modified');
    expect(rowStatus('build/out/x.js', idx)).toBe('ignored');
    expect(rowStatus('README.md', idx)).toBeNull();
  });

  it('no repo: empty index', () => {
    expect(indexGit({ isRepo: false }).files.size).toBe(0);
  });
});

describe('branchLabel', () => {
  it('branch, ahead/behind and totals; a plain note outside a repo', () => {
    expect(branchLabel(repo)).toBe('main ↑2 ↓0 · +3 −1 M:1');
    expect(branchLabel({ isRepo: false })).toBe('Not a git repository');
    expect(branchLabel(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client/instances/fileTreeModel.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement** `fileTreeModel.ts`

```ts
import type { FileListResult, FileTreeGit, GitFile, GitFileStatus } from '@watchtower/shared/fileTree.js';

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  isOpen: boolean;
  /** A "+N more" note after a capped folder. */
  isMore?: boolean;
}

/** Visible rows: the root listing plus every expanded folder's, depth-first. */
export function buildRows(listings: ReadonlyMap<string, FileListResult>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const add = (dir: string, depth: number) => {
    for (const e of listings.get(dir)?.entries ?? []) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      const isOpen = e.isDir && expanded.has(p);
      rows.push({ path: p, name: e.name, depth, isDir: e.isDir, size: e.size, mtimeMs: e.mtimeMs, isOpen });
      if (isOpen) add(p, depth + 1);
    }
    const more = listings.get(dir)?.truncated ?? 0;
    if (more > 0) rows.push({ path: `${dir}/+more`, name: `+${more} more`, depth, isDir: false, size: 0, mtimeMs: 0, isOpen: false, isMore: true });
  };
  add('', 0);
  return rows;
}

export interface GitIndex {
  files: Map<string, GitFile>;
  dirTotals: Map<string, { added: number; deleted: number; changed: number }>;
  ignored: Set<string>;
}

export function indexGit(git: FileTreeGit | null): GitIndex {
  const idx: GitIndex = { files: new Map(), dirTotals: new Map(), ignored: new Set() };
  if (!git?.isRepo) return idx;
  for (const f of git.files) {
    if (f.status === 'ignored') {
      idx.ignored.add(f.path);
      continue;
    }
    idx.files.set(f.path, f);
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const t = idx.dirTotals.get(dir) ?? { added: 0, deleted: 0, changed: 0 };
      idx.dirTotals.set(dir, { added: t.added + f.added, deleted: t.deleted + f.deleted, changed: t.changed + 1 });
    }
  }
  return idx;
}

/** A row's status: its own, or `ignored` when it or an ancestor is ignored. */
export function rowStatus(path: string, idx: GitIndex): GitFileStatus | null {
  const own = idx.files.get(path);
  if (own) return own.status;
  const parts = path.split('/');
  for (let i = parts.length; i > 0; i--) if (idx.ignored.has(parts.slice(0, i).join('/'))) return 'ignored';
  return null;
}

export function branchLabel(git: FileTreeGit | null): string {
  if (!git) return '';
  if (!git.isRepo) return 'Not a git repository';
  let added = 0;
  let deleted = 0;
  let modified = 0;
  for (const f of git.files) {
    added += f.added;
    deleted += f.deleted;
    if (f.status === 'modified') modified++;
  }
  return `${git.branch} ↑${git.ahead} ↓${git.behind} · +${added} −${deleted} M:${modified}`;
}
```

- [ ] **Step 4: Run the model tests**

Run: `npx vitest run tests/client/instances/fileTreeModel.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing UI test** `tests/client/instances/filesTab.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { FilesTab } from '../../../apps/desktop/src/components/instances/side/FilesTab';
import type { FileTreeState } from '../../../apps/desktop/src/state/useFileTree';

const tree = (over: Partial<FileTreeState> = {}): FileTreeState => ({
  listings: new Map([
    ['', { dir: '', entries: [{ name: 'src', isDir: true, size: 0, mtimeMs: 1 }, { name: 'gone.ts', isDir: false, size: 1, mtimeMs: 1 }], truncated: 2 }],
    ['src', { dir: 'src', entries: [{ name: 'a.ts', isDir: false, size: 10, mtimeMs: 1 }], truncated: 0 }],
  ]),
  expanded: new Set(['src']),
  git: {
    isRepo: true,
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [
      { path: 'src/a.ts', status: 'modified', added: 3, deleted: 1 },
      { path: 'gone.ts', status: 'deleted', added: 0, deleted: 5 },
    ],
  },
  error: null,
  toggle: vi.fn(),
  reveal: vi.fn(),
  search: vi.fn(async () => ['src/a.ts']),
  ...over,
});
const renderTab = (t: FileTreeState, flash?: Map<string, { kind: 'read' | 'write'; at: number }>) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <FilesTab tree={t} flash={flash} />
    </ThemeProvider>,
  );

describe('FilesTab', () => {
  it('shows the branch row, rows with git colours, folder totals and the cap note', () => {
    renderTab(tree());
    expect(screen.getByText('main ↑0 ↓0 · +3 −6 M:1')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toHaveAttribute('data-status', 'modified');
    expect(screen.getByText('gone.ts')).toHaveAttribute('data-status', 'deleted');
    expect(screen.getByTestId('totals-src')).toHaveTextContent('+3 −1');
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('a click on a folder toggles it; arrow keys move and expand', () => {
    const t = tree();
    renderTab(t);
    fireEvent.click(screen.getByText('src'));
    expect(t.toggle).toHaveBeenCalledWith('src');
    const list = screen.getByRole('tree');
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // onto src/a.ts
    fireEvent.keyDown(list, { key: 'ArrowLeft' }); // a file: back to its folder
    expect(t.toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(list, { key: 'ArrowLeft' }); // an open folder: collapse
    expect(t.toggle).toHaveBeenCalledTimes(2);
  });

  it('search lists matches; picking one reveals it in the tree', async () => {
    const t = tree();
    renderTab(t);
    fireEvent.change(screen.getByPlaceholderText('Search files'), { target: { value: 'a.ts' } });
    const hit = await screen.findByRole('button', { name: 'src/a.ts' });
    fireEvent.click(hit);
    expect(t.reveal).toHaveBeenCalledWith('src/a.ts');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'src/a.ts' })).toBeNull());
  });

  it('an inline note replaces the tree when the folder is gone', () => {
    renderTab(tree({ error: 'Folder not found', listings: new Map() }));
    expect(screen.getByText('Folder not found')).toBeInTheDocument();
  });

  it('flashes rows Claude just touched', () => {
    renderTab(tree(), new Map([['src/a.ts', { kind: 'write', at: 5 }]]));
    expect(screen.getByText('a.ts').closest('[data-flash]')).toHaveAttribute('data-flash', 'write');
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/client/instances/filesTab.test.tsx`
Expected: FAIL — cannot resolve `FilesTab`.

- [ ] **Step 7: Implement** `FilesTab.tsx`

```tsx
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/cs';
import { Box, ButtonBase, InputBase, Typography } from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { GitFileStatus } from '@watchtower/shared/fileTree.js';
import type { FileTreeState } from '../../../state/useFileTree.js';
import { CZ_DATE_FORMAT } from '../../../util/format.js';
import { branchLabel, buildRows, indexGit, rowStatus } from './fileTreeModel.js';

const STATUS_COLOR: Partial<Record<GitFileStatus, string>> = {
  modified: '#e0a43a',
  renamed: '#e0a43a',
  added: '#5fbf8f',
  untracked: '#5fbf8f',
  deleted: '#e5534b',
};
const FLASH_COLOR = { read: '#8f8cf4', write: '#d97757' } as const;
const ROW_H = 22;

// File-type tint for the icon; anything else stays neutral.
const EXT_COLOR: Record<string, string> = { ts: '#3178c6', tsx: '#3178c6', js: '#e8c547', json: '#c49a3a', md: '#8a8a86', css: '#5b8dd6', swift: '#f05138', cs: '#68217a' };

interface Props {
  tree: FileTreeState;
  /** Rows Claude just read or wrote, keyed by cwd-relative path. */
  flash?: ReadonlyMap<string, { kind: 'read' | 'write'; at: number }>;
}

/** The side panel's Files tab: git-aware tree, branch row and search. */
export function FilesTab({ tree, flash }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<string[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const idx = useMemo(() => indexGit(tree.git), [tree.git]);
  const rows = useMemo(() => buildRows(tree.listings, tree.expanded), [tree.listings, tree.expanded]);

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    let alive = true;
    tree.search(query).then((r) => alive && setHits(r), () => alive && setHits([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[cursor];
    if (e.key === 'ArrowDown') setCursor((c) => Math.min(rows.length - 1, c + 1));
    else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
    else if (!row) return;
    else if (e.key === 'ArrowRight' && row.isDir && !row.isOpen) tree.toggle(row.path);
    else if (e.key === 'ArrowLeft' && row.isDir && row.isOpen) tree.toggle(row.path);
    else if (e.key === 'ArrowLeft') {
      const parent = row.path.split('/').slice(0, -1).join('/');
      const i = rows.findIndex((r) => r.path === parent);
      if (i >= 0) setCursor(i);
    } else if (e.key === 'Enter' && row.isDir) tree.toggle(row.path);
    else return;
    e.preventDefault();
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1, pb: 1 }}>
      <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary', px: 0.5, pb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        {branchLabel(tree.git)}
      </Typography>
      <InputBase
        placeholder="Search files"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ fontSize: 12.5, px: 1, py: 0.25, mb: 0.5, borderRadius: '6px', backgroundColor: 'action.hover' }}
      />
      {tree.error ? (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', p: 1 }}>{tree.error}</Typography>
      ) : hits ? (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {hits.length === 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1 }}>No matches</Typography>}
          {hits.map((h) => (
            <ButtonBase
              key={h}
              aria-label={h}
              onClick={() => {
                tree.reveal(h);
                setQuery('');
              }}
              sx={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 12, px: 0.5, py: 0.25, borderRadius: '4px', ':hover': { backgroundColor: 'action.hover' } }}
            >
              {h}
            </ButtonBase>
          ))}
        </Box>
      ) : (
        <Box role="tree" tabIndex={0} onKeyDown={onKeyDown} sx={{ flex: 1, overflowY: 'auto', outline: 'none' }}>
          {rows.map((r, i) => {
            if (r.isMore)
              return (
                <Typography key={r.path} sx={{ fontSize: 11.5, color: 'text.secondary', height: ROW_H, pl: `${r.depth * 12 + 20}px` }}>
                  {r.name}
                </Typography>
              );
            const status = rowStatus(r.path, idx);
            const totals = r.isDir ? idx.dirTotals.get(r.path) : idx.files.get(r.path);
            const fl = flash?.get(r.path);
            const ext = r.name.split('.').pop() ?? '';
            return (
              <Box
                key={r.path}
                role="treeitem"
                aria-expanded={r.isDir ? r.isOpen : undefined}
                data-flash={fl?.kind}
                onClick={() => {
                  setCursor(i);
                  if (r.isDir) tree.toggle(r.path);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  height: ROW_H,
                  pl: `${r.depth * 12 + 2}px`,
                  pr: 0.5,
                  borderRadius: '4px',
                  cursor: 'default',
                  opacity: status === 'ignored' ? 0.45 : 1,
                  backgroundColor: i === cursor ? 'action.selected' : 'transparent',
                  ...(fl && {
                    // Keyed by `at`, so each new touch replays the fade once.
                    animation: `wt-flash-${fl.at} 4s ease-out forwards`,
                    [`@keyframes wt-flash-${fl.at}`]: {
                      from: { backgroundColor: `${FLASH_COLOR[fl.kind]}55` },
                      to: { backgroundColor: 'transparent' },
                    },
                  }),
                  ':hover': { backgroundColor: 'action.hover' },
                }}
              >
                {r.isDir ? (
                  r.isOpen ? <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.secondary' }} /> : <ChevronRightIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                ) : (
                  <Box sx={{ width: 14 }} />
                )}
                {r.isDir ? (
                  r.isOpen ? <FolderOpenOutlinedIcon sx={{ fontSize: 15, color: '#c9a35a' }} /> : <FolderOutlinedIcon sx={{ fontSize: 15, color: '#c9a35a' }} />
                ) : (
                  <InsertDriveFileOutlinedIcon sx={{ fontSize: 14, color: EXT_COLOR[ext] ?? 'text.secondary' }} />
                )}
                <Typography noWrap data-status={status ?? undefined} sx={{ fontSize: 12.5, flex: 1, minWidth: 0, color: (status && STATUS_COLOR[status]) ?? 'text.primary' }}>
                  {r.name}
                </Typography>
                <Typography
                  noWrap
                  data-testid={r.isDir ? `totals-${r.path}` : undefined}
                  sx={{ fontSize: 11, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                >
                  {totals && (totals.added || totals.deleted)
                    ? `+${totals.added} −${totals.deleted}`
                    : r.isDir
                      ? ''
                      : dayjs(r.mtimeMs).locale('cs').format(`${CZ_DATE_FORMAT} H:mm`)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 8: Run the UI test**

Run: `npx vitest run tests/client/instances/filesTab.test.tsx`
Expected: PASS (5 tests). If the `+3 −6` total in the branch row disagrees, check `branchLabel` sums `deleted` across all files (1 + 5 = 6).

- [ ] **Step 9: Add the Files tab to `PaneCard.tsx`**

Imports:
```tsx
import { FilesTab } from './side/FilesTab.js';
import { useFileTree } from '../../state/useFileTree.js';
```
Change the side panel block from Task 3:
```tsx
  const available: SideTab[] = [...(savvy.agents ? (['agents'] as const) : []), ...(cwd ? (['files'] as const) : [])];
  const side = useSidePanel({
    available,
    agentsAutoKey: savvy.agentsAutoKey,
    toggles: { agents: savvy.panelToggles },
  });
  sideToggle.current = side.toggle;
  // The tree loads and watches only while its tab is showing.
  const fileTree = useFileTree(instanceId, side.isOpen && side.tab === 'files');
```
Inside `<SidePanel>` after the agents body:
```tsx
            {side.tab === 'files' && <FilesTab tree={fileTree} />}
```

- [ ] **Step 10: Verify and commit (end of Phase 2)**

Run: `npx vitest run tests/client tests/orchestrator/fileTree*.test.ts && npm run typecheck:ci && npm test`
Expected: green except the 7 known env failures.
```bash
git add apps/desktop/src/components/instances/side/fileTreeModel.ts apps/desktop/src/components/instances/side/FilesTab.tsx apps/desktop/src/components/instances/PaneCard.tsx tests/client/instances/fileTreeModel.test.ts tests/client/instances/filesTab.test.tsx
git commit -m "feat(files): native Files tab in the pane side panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 3 — filetree bridge and activity flash

### Task 10: Activity shapes, store, IPC and flash

**Files:**
- Modify: `packages/shared/src/fileTree.ts` (append)
- Create: `orchestrator/services/fileTreeActivityStore.ts`
- Modify: `packages/shared/src/ipcContract.ts`, `packages/shared/src/messagePort.ts`, `orchestrator/index.ts`, `apps/desktop/src/state/ipc.ts`
- Create: `apps/desktop/src/state/useFileTreeActivity.ts`
- Modify: `apps/desktop/src/components/instances/PaneCard.tsx`
- Test: `tests/shared/fileTree.test.ts`, `tests/orchestrator/fileTreeActivityStore.test.ts`

**Interfaces:**
- Produces (shared):
```ts
export interface FileActivity { path: string; kind: 'read' | 'write'; at: number }
export interface FileTreeActivitySnapshot { activity: FileActivity[]; panelToggles: number; sentAt: number }
export interface FileTreeActivityState { instanceId: string; snapshot: FileTreeActivitySnapshot; receivedAt: number }
export function parseFileTreeActivity(body: unknown): FileTreeActivitySnapshot | null;
export function flashMap(snapshot: FileTreeActivitySnapshot | null, cwd: string, windowMs?: number): Map<string, { kind: 'read' | 'write'; at: number }>;
```
- Produces (IPC): `fileTreeActivity:get` `{ instanceId }` → `FileTreeActivityState | null`; push `fileTreeActivity` `FileTreeActivityState`.
- Produces (hook): `useFileTreeActivity(instanceId: string): FileTreeActivityState | null`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/fileTree.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseFileTreeActivity, flashMap } from '@watchtower/shared/fileTree.js';

describe('parseFileTreeActivity', () => {
  it('accepts a v1 body, dropping junk entries and capping at 50', () => {
    const activity = [
      ...Array.from({ length: 60 }, (_, i) => ({ path: `/r/f${i}`, kind: 'read', at: i })),
      { path: 7, kind: 'read', at: 1 },
      { path: '/r/x', kind: 'erase', at: 1 },
    ];
    const s = parseFileTreeActivity({ version: 1, panelToggles: 2, sentAt: 9, activity });
    expect(s?.activity).toHaveLength(50);
    expect(s?.activity.at(-1)?.path).toBe('/r/f59');
    expect(s).toMatchObject({ panelToggles: 2, sentAt: 9 });
  });

  it('rejects non-v1 bodies; missing numbers read as 0', () => {
    expect(parseFileTreeActivity({ version: 2, activity: [] })).toBeNull();
    expect(parseFileTreeActivity(null)).toBeNull();
    expect(parseFileTreeActivity({ version: 1, activity: [] })).toEqual({ activity: [], panelToggles: 0, sentAt: 0 });
  });
});

describe('flashMap', () => {
  it('keeps recent entries inside the cwd, relative, latest touch winning', () => {
    const snap = {
      panelToggles: 0,
      sentAt: 10_000,
      activity: [
        { path: '/repo/src/a.ts', kind: 'read' as const, at: 9_000 },
        { path: '/repo/src/a.ts', kind: 'write' as const, at: 9_500 },
        { path: '/repo/old.ts', kind: 'read' as const, at: 1_000 },
        { path: '/elsewhere/b.ts', kind: 'read' as const, at: 9_900 },
      ],
    };
    expect(Object.fromEntries(flashMap(snap, '/repo'))).toEqual({ 'src/a.ts': { kind: 'write', at: 9_500 } });
    expect(flashMap(null, '/repo').size).toBe(0);
  });
});
```

`tests/orchestrator/fileTreeActivityStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FileTreeActivityStore } from '../../orchestrator/services/fileTreeActivityStore.js';
import type { FileTreeActivityState } from '@watchtower/shared/fileTree.js';

const body = { version: 1, panelToggles: 1, sentAt: 900, activity: [{ path: '/r/a', kind: 'write', at: 800 }] };

describe('FileTreeActivityStore', () => {
  it('stores and pushes a valid body for a known instance; drops the rest', () => {
    const pushed: FileTreeActivityState[] = [];
    const store = new FileTreeActivityStore((s) => pushed.push(s), (id) => id === 'i1');
    expect(store.ingest(body, 'i1', 1_000)).toBe(true);
    expect(store.ingest(body, 'stranger', 1)).toBe(false);
    expect(store.ingest({ version: 9 }, 'i1', 1)).toBe(false);
    expect(pushed).toHaveLength(1);
    expect(store.get('i1')).toMatchObject({ instanceId: 'i1', receivedAt: 1_000, snapshot: { panelToggles: 1 } });
    store.dispose('i1');
    expect(store.get('i1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/shared/fileTree.test.ts tests/orchestrator/fileTreeActivityStore.test.ts`
Expected: FAIL — missing exports/module.

- [ ] **Step 3: Implement the shared part** (append to `packages/shared/src/fileTree.ts`)

```ts
/** One file Claude touched, as the filetree mod reports it (absolute path). */
export interface FileActivity {
  path: string;
  kind: 'read' | 'write';
  at: number;
}

/** What the filetree mod (plugins/filetree) POSTs to `/mods/filetree`. */
export interface FileTreeActivitySnapshot {
  activity: FileActivity[];
  /** Bumped by each `/filetree` run; a rise toggles the Files tab. */
  panelToggles: number;
  sentAt: number;
}

export interface FileTreeActivityState {
  instanceId: string;
  snapshot: FileTreeActivitySnapshot;
  receivedAt: number;
}

const MAX_ACTIVITY = 50;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Validates a POSTed body; lenient per field, strict on the shape. */
export function parseFileTreeActivity(body: unknown): FileTreeActivitySnapshot | null {
  if (!isObj(body) || body.version !== 1 || !Array.isArray(body.activity)) return null;
  const activity = body.activity
    .filter((a): a is Record<string, unknown> => isObj(a) && typeof a.path === 'string' && (a.kind === 'read' || a.kind === 'write'))
    .map((a) => ({ path: a.path as string, kind: a.kind as 'read' | 'write', at: num(a.at) }))
    .slice(-MAX_ACTIVITY);
  return { activity, panelToggles: num(body.panelToggles), sentAt: num(body.sentAt) };
}

/** cwd-relative paths touched within `windowMs` of the snapshot; the latest touch per path wins. */
export function flashMap(
  snapshot: FileTreeActivitySnapshot | null,
  cwd: string,
  windowMs = 4_000,
): Map<string, { kind: 'read' | 'write'; at: number }> {
  const res = new Map<string, { kind: 'read' | 'write'; at: number }>();
  if (!snapshot) return res;
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  for (const a of snapshot.activity) {
    if (!a.path.startsWith(prefix) || snapshot.sentAt - a.at > windowMs) continue;
    const rel = a.path.slice(prefix.length);
    const prev = res.get(rel);
    if (!prev || a.at >= prev.at) res.set(rel, { kind: a.kind, at: a.at });
  }
  return res;
}
```

- [ ] **Step 4: Implement the store** `orchestrator/services/fileTreeActivityStore.ts`

```ts
import { parseFileTreeActivity, type FileTreeActivityState } from '@watchtower/shared/fileTree.js';

/** Latest filetree-mod activity per instance, in memory; the mod re-posts on every change. */
export class FileTreeActivityStore {
  private byInstance = new Map<string, FileTreeActivityState>();

  constructor(
    private readonly emit: (state: FileTreeActivityState) => void,
    private readonly isKnownInstance: (instanceId: string) => boolean,
  ) {}

  /** Validate and store a POSTed body; false when it was dropped. */
  ingest(body: unknown, instanceId: string, now: number): boolean {
    if (!this.isKnownInstance(instanceId)) return false;
    const snapshot = parseFileTreeActivity(body);
    if (!snapshot) return false;
    const state: FileTreeActivityState = { instanceId, snapshot, receivedAt: now };
    this.byInstance.set(instanceId, state);
    this.emit(state);
    return true;
  }

  get(instanceId: string): FileTreeActivityState | null {
    return this.byInstance.get(instanceId) ?? null;
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }
}
```

- [ ] **Step 5: Wire IPC and the route**

`ipcContract.ts` / `messagePort.ts` next to the `fileTree:*` lines from Task 8:
```ts
  | { kind: 'fileTreeActivity:get'; payload: { instanceId: string } }                       // request (messagePort: add `id: string;`)
  | { kind: 'fileTreeActivity:get'; payload: import('./fileTree.js').FileTreeActivityState | null } // response
  | { kind: 'fileTreeActivity'; payload: import('./fileTree.js').FileTreeActivityState }        // push
```
`orchestrator/index.ts`:
```ts
import { FileTreeActivityStore } from './services/fileTreeActivityStore.js';
// after fileTreeWatchers:
// filetree mod activity (plugins/filetree → POST /mods/filetree): Claude's reads and writes, flashed on the Files tab.
const fileTreeActivity = new FileTreeActivityStore(
  (state) => emitPush({ kind: 'fileTreeActivity', payload: state }),
  (instanceId) => !!handle && repo().get(instanceId) != null,
);
// in disposal, after fileTreeWatchers.unwatch(id):
  fileTreeActivity.dispose(id);
// in the switch:
    case 'fileTreeActivity:get':
      return fileTreeActivity.get(req.payload.instanceId);
// in onModState, after the savvy-progress line:
        if (plugin === 'filetree') fileTreeActivity.ingest(body, instanceId, Date.now());
```
`apps/desktop/src/state/ipc.ts` `SILENT_KINDS`: add `'fileTreeActivity:get', // filetree mod activity; a miss only means no flash`.

Check the listener accepts `filetree` as a plugin name: run `grep -n "mods/" orchestrator/*.ts orchestrator/**/*.ts`; if the route allow-lists plugin names, add `'filetree'` there.

- [ ] **Step 6: Hook and flash in `PaneCard`**

`apps/desktop/src/state/useFileTreeActivity.ts`:
```ts
import { useEffect, useState } from 'react';
import type { FileTreeActivityState } from '@watchtower/shared/fileTree.js';
import { invoke } from './ipc';

/** The filetree mod's latest activity for one instance; null until the mod posts. */
export function useFileTreeActivity(instanceId: string): FileTreeActivityState | null {
  const [state, setState] = useState<FileTreeActivityState | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    invoke('fileTreeActivity:get', { instanceId })
      .then((s) => {
        if (alive) setState((prev) => prev ?? s);
      })
      .catch(() => {});
    const off = window.watchtower.on('fileTreeActivity', (payload) => {
      if (payload.instanceId === instanceId) setState(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);
  return state;
}
```
`PaneCard.tsx`:
```tsx
import { useMemo } from 'react'; // merge into the existing React import
import { flashMap } from '@watchtower/shared/fileTree.js';
import { useFileTreeActivity } from '../../state/useFileTreeActivity.js';
// in the component, before useSidePanel:
  const activity = useFileTreeActivity(instanceId);
// toggles becomes:
    toggles: { agents: savvy.panelToggles, files: activity?.snapshot.panelToggles },
// after useFileTree:
  const flash = useMemo(() => flashMap(activity?.snapshot ?? null, cwd), [activity, cwd]);
// FilesTab:
            {side.tab === 'files' && <FilesTab tree={fileTree} flash={flash} />}
```

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run tests/shared/fileTree.test.ts tests/orchestrator/fileTreeActivityStore.test.ts tests/client && npm run typecheck:ci`
Expected: PASS.
```bash
git add packages/shared/src/fileTree.ts orchestrator/services/fileTreeActivityStore.ts packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/index.ts apps/desktop/src/state/ipc.ts apps/desktop/src/state/useFileTreeActivity.ts apps/desktop/src/components/instances/PaneCard.tsx tests/shared/fileTree.test.ts tests/orchestrator/fileTreeActivityStore.test.ts
git commit -m "feat(files): flash files Claude reads and writes, from the filetree mod

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Vendor and patch the filetree mod

**Files:**
- Create: `plugins/filetree/**` (copied from `~/.claude/local-plugins/filetree-community/src/`, without `media/`)
- Modify: `plugins/filetree/hooks/register.tsx`, `plugins/filetree/.claude-plugin/plugin.json`, `plugins/filetree/README.md`
- Test: `plugins/filetree/tests/bridge.test.ts`

**Interfaces:**
- Consumes: the `/mods/filetree` body shape from Task 10: `{ version: 1, panelToggles: number, activity: { path, kind: 'read' | 'write', at }[], sentAt: number }`.

- [ ] **Step 1: Copy the mod**

```bash
mkdir -p plugins/filetree
rsync -a --exclude media --exclude node_modules ~/.claude/local-plugins/filetree-community/src/ plugins/filetree/
claude plugin test plugins/filetree
```
Expected: the upstream tests pass before any change (record the count).

- [ ] **Step 2: Write the failing bridge test** `plugins/filetree/tests/bridge.test.ts`

Reuse the `world()` helper from `plugins/filetree/tests/surfaces.test.tsx` — export it from there (`export function world`) together with its `World`/`Ran` types and import it. Tests (adapt only the `world` arguments to what that helper expects; keep every assertion):

```ts
import { expect, mock, test } from 'claude-code/testing'
import { world } from './surfaces.test'

const W = { os: 'darwin' as const, env: { HOME: '/home/u' }, cwd: '/repo', top: '/repo', dirs: { '/repo': [['a.ts', 'file']] as [string, 'file' | 'dir'][] }, status: '', numstat: '' }
const INSIDE = { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support' }
const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }

function bridge(on: any) {
  const bodies: any[] = []
  on('fs.read', async (_$: unknown, e: { path: string }, next: (e: unknown) => unknown) =>
    e.path === '/support/listener.json' ? { value: JSON.stringify({ port: 7531, token: 'tok' }) } : next(e))
  on('http.fetch', async (_$: unknown, e: { url: string; init: { body: string } }) => {
    bodies.push({ url: e.url, ...JSON.parse(e.init.body) })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  return bodies
}

test('inside Watchtower the pane never opens; /filetree toggles the tab', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const opens: unknown[] = []
  world(on, { ...W, env: { ...W.env, ...INSIDE } }, [])
  on('ui.open', async (_$: unknown, e: unknown) => { opens.push(e); return { value: undefined } })
  const bodies = bridge(on)
  await $.session.start(start)
  await clock.advance(1_000)
  const r = await $.command.run({ command: 'filetree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  await clock.advance(250)
  expect(opens).toEqual([])
  expect(r.text).toBe('File tree toggled in Watchtower.')
  expect(bodies.at(-1)).toMatchObject({ url: 'http://127.0.0.1:7531/mods/filetree', version: 1, panelToggles: 1 })
})

test('Claude reading and writing files posts activity', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  world(on, { ...W, env: { ...W.env, ...INSIDE } }, [])
  const bodies = bridge(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' } as never)
  await clock.advance(250)
  expect(bodies.at(-1)?.activity.map((a: { kind: string; path: string }) => `${a.kind} ${a.path}`)).toEqual(['read /repo/a.ts', 'write /repo/a.ts'])
})

test('outside Watchtower: the pane opens as upstream and nothing is posted', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const opens: unknown[] = []
  world(on, W, [])
  on('ui.open', async (_$: unknown, e: unknown) => { opens.push(e); return { value: undefined } })
  const bodies = bridge(on)
  await $.session.start(start)
  await clock.advance(1_000)
  expect(opens.length).toBeGreaterThan(0)
  expect(bodies).toEqual([])
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `claude plugin test plugins/filetree`
Expected: the three new tests FAIL (pane opens, no posts); upstream tests still pass.

- [ ] **Step 4: Patch `plugins/filetree/hooks/register.tsx`**

After `let noDock = false` (line ~92) add:
```ts
// Watchtower bridge. Inside a Watchtower terminal (WATCHTOWER_INSTANCE_ID set)
// Watchtower draws the tree natively, so this mod only reports Claude's file
// activity to Watchtower's listener and never docks its own pane.
type Bridge = { url: string; token: string; instanceId: string }
let bridge: Bridge | null | undefined
let isPublishQueued = false
let panelToggles = 0
let recent: { path: string; kind: 'read' | 'write'; at: number }[] = []

async function discoverBridge($: EngineInterface): Promise<Bridge | null> {
  const instanceId = await $.env.get('WATCHTOWER_INSTANCE_ID')
  if (!instanceId) return null
  const home = (await $.env.get('HOME')) ?? ''
  const dir = (await $.env.get('WATCHTOWER_SUPPORT_DIR')) || `${home}/Library/Application Support/Watchtower`
  try {
    const sidecar = JSON.parse(await $.fs.read(`${dir}/listener.json`)) as { port?: number; token?: string }
    const port = Number(sidecar.port)
    const token = String(sidecar.token ?? '')
    if (!port || !token) return null
    return { url: `http://127.0.0.1:${port}/mods/filetree`, token, instanceId }
  } catch {
    return null
  }
}

const isBridged = (): boolean => !!bridge

async function sendSnapshot($: EngineInterface): Promise<void> {
  const b = bridge
  if (!b) return
  const body = JSON.stringify({ version: 1, panelToggles, activity: recent, sentAt: await $.clock.now() })
  try {
    const res = await $.http.fetch(b.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${b.token}`, 'x-watchtower-instance': b.instanceId },
      body,
    })
    // Watchtower restarted on another port or token: look again next time.
    if (res.status === 401 || res.status === 404) bridge = undefined
  } catch {
    bridge = undefined
  }
}

// Coalesces a burst of reads and writes into one post.
function publish($: EngineInterface): void {
  if (bridge === null || isPublishQueued) return
  isPublishQueued = true
  $.clock.after(200, () => {
    isPublishQueued = false
    void (async () => {
      if (bridge === undefined) bridge = await discoverBridge($)
      await sendSnapshot($)
    })()
  })
}

async function reportActivity($: EngineInterface, paths: string[], kind: 'read' | 'write'): Promise<void> {
  const at = await $.clock.now()
  recent = [...recent, ...paths.map(p => ({ path: posix(p), kind, at }))].slice(-50)
  publish($)
}

async function closeOwnPane($: EngineInterface): Promise<void> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.close({ id: PANE })
}
```
(`posix` is already defined in this file; confirm with `grep -n "const posix\|function posix" plugins/filetree/hooks/*.ts*` and import it if it lives in another module.)

In `reset()` (line ~279), replace the two open lines with:
```ts
  if (isBridged()) void closeOwnPane($)
  else if (focus) await $.ui.open({ id: PANE, title, focus: true })
  else if (!noDock) await $.ui.open({ id: PANE, title })
```
In `session.start`, first line inside the handler:
```ts
    bridge = await discoverBridge($)
```
and replace `else if (!noDock) await $.ui.open({ id: PANE, title: … })` with:
```ts
      else if (isBridged()) await closeOwnPane($)
      else if (!noDock) await $.ui.open({ id: PANE, title: `Files: ${t.root.split('/').pop() || t.root}` })
```
At the top of `on('command.run', { command: 'filetree' }, …)`:
```ts
    if (bridge === undefined) bridge = await discoverBridge($)
    if (isBridged()) {
      await closeOwnPane($)
      panelToggles++
      publish($)
      return { text: 'File tree toggled in Watchtower.' }
    }
```
At the top of `touched()`:
```ts
  if (isBridged() && show) void reportActivity($, paths, tone === 'purple' ? 'read' : 'write')
```

- [ ] **Step 5: Manifest and README**

`plugins/filetree/.claude-plugin/plugin.json`: `"version": "0.2.24-watchtower.1"`, append to `description`: ` Watchtower fork: inside a Watchtower terminal, reports Claude's file activity so Watchtower's native Files tab can flash it.`
Prepend to `plugins/filetree/README.md`:
```markdown
> **Watchtower fork** of [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree)
> (MIT, see `LICENSE`), vendored at 0.2.24. The only change is the *Watchtower
> bridge* in `hooks/register.tsx`: inside a Watchtower terminal
> (`WATCHTOWER_INSTANCE_ID` set) the mod never docks its pane, `/filetree`
> toggles Watchtower's Files tab (it counts up `panelToggles`), and every file
> Claude reads or writes is POSTed to `/mods/filetree` on Watchtower's listener
> so the native tree can flash it. Outside Watchtower it behaves as upstream.
> `media/` (demo GIFs) is left out of the vendored copy.
```

- [ ] **Step 6: Run to verify**

Run: `claude plugin test plugins/filetree`
Expected: all upstream tests plus the 3 bridge tests PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/filetree
git commit -m "feat(filetree): vendor the filetree mod with a Watchtower bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Install switch, docs, live review

**Files:**
- Modify: `CLAUDE.md` (new section after "savvy-progress mod bridge")
- Modify (user config, needs the user's OK at execution time): `~/.claude/settings.json`

- [ ] **Step 1: Find how to load two local plugin folders**

Ask the user before touching `~/.claude/settings.json` (shared config). With approval, back it up (`cp ~/.claude/settings.json ~/.claude/settings.json.bak.$(date +%Y%m%d-%H%M%S)`), set `"filetree@claude-code-filetree": false`, and set
```json
"CLAUDE_CODE_PLUGIN_DIRS": "/Users/jan/Projects/Watchtower/plugins/savvy-progress:/Users/jan/Projects/Watchtower/plugins/filetree"
```
Run: `claude plugin list 2>&1 | grep -A3 -E "savvy-progress|filetree"`
Expected: `savvy-progress@inline … 1.2.0-watchtower.1 ✔ loaded` and `filetree@inline … 0.2.24-watchtower.1 ✔ loaded`.
If only one loads, try `,` as the separator. If neither works, revert the variable to the savvy path alone and add a local-directory marketplace entry instead: `extraKnownMarketplaces["watchtower-plugins"] = { "source": { "source": "directory", "path": "/Users/jan/Projects/Watchtower/plugins" } }` is NOT valid unless `plugins/` has a marketplace manifest — in that case stop and report to the user with the options.
Re-check `statusLine.command` still wraps `watchtower-statusline.mjs` (memory: statusline capture wrap).

- [ ] **Step 2: CLAUDE.md section**

Insert after the savvy-progress section:
```markdown
## filetree mod bridge and the side panel (`plugins/filetree/`)

Each pane has one right-side panel with tabs (`components/instances/side/`:
`useSidePanel`, `SidePanel`). **Agents** draws the savvy-progress snapshot;
**Files** is a native tree from `orchestrator/services/fileTree.ts`
(`fileTree:list|git|search|watch|unwatch`, push `fileTreeChanged`; watchers in
`fileTreeWatchers.ts`, shared per cwd).

`plugins/filetree/` is a vendored, patched copy of the third-party filetree mod
(MIT). Inside a Watchtower pty it never docks its pane, `/filetree` bumps
`panelToggles`, and Claude's reads/writes POST to `/mods/filetree` →
`fileTreeActivityStore.ts` → push `fileTreeActivity` → the Files tab flashes the
row. Shapes in `packages/shared/src/fileTree.ts` — **change the mod's body and
`parseFileTreeActivity` together.**
```

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck:ci && claude plugin test plugins/savvy-progress && claude plugin test plugins/filetree`
Expected: green except the 7 known env failures.

- [ ] **Step 4: Live review in the dev app**

From the worktree: `npm run electron:rebuild` (once), then `WATCHTOWER_WS_HOST=127.0.0.1 WATCHTOWER_WS_PORT=7455 npm run dev`. In a new Claude instance check: the terminal shows no filetree pane; the title-bar sidebar button opens the panel on Files; folders expand; a modified file is amber with `+/−`; search finds and reveals a file; `/filetree` and `/agents-info` toggle their tabs; asking Claude to read then edit a file flashes purple then orange; resizing persists. Hand over to the user for review.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the side panel and the filetree mod bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
