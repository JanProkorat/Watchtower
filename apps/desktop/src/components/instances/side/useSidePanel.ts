import { useEffect, useRef, useState } from 'react';
import { PANEL_W, clampPanelWidth } from '../savvy/SavvyAgentsPanel.js';

export type SideTab = 'agents' | 'files' | 'replay' | 'mods' | 'run';

export interface SidePanelOptions {
  /** Tabs with something to show, in strip order. */
  available: readonly SideTab[];
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

/**
 * A pane's tabs: Agents and Replay wherever Claude runs (empty until their mods post), Files wherever there is a
 * folder, Mods once a band mod has posted, Run when the repo has a run.json.
 */
export function sideTabsFor(kind: 'claude' | 'shell' | 'chat', cwd: string, hasRun = false, hasMods = false): SideTab[] {
  const claude = kind !== 'shell';
  return [
    ...(claude ? (['agents'] as const) : []),
    ...(cwd ? (['files'] as const) : []),
    ...(claude ? (['replay'] as const) : []),
    ...(hasMods ? (['mods'] as const) : []),
    ...(hasRun ? (['run'] as const) : []),
  ];
}

/** One pane's right-side panel: which tab shows, whether it is open, and how wide. Opens only when the user asks. */
export function useSidePanel({ available, toggles }: SidePanelOptions): SidePanel {
  const [isOpenRaw, setIsOpen] = useState(false);
  const [picked, setPicked] = useState<SideTab | null>(null);
  const [width, setWidthState] = useState(readWidth);

  const tab = picked && available.includes(picked) ? picked : available[0] ?? null;
  const isOpen = isOpenRaw && tab !== null;

  const open = (t?: SideTab) => {
    // A tab with nothing to show is ignored, so it can't be picked behind the user's back.
    if (t && !available.includes(t)) return;
    const next = t ?? (picked && available.includes(picked) ? picked : available[0]);
    if (!next) return;
    setPicked(next);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);
  const toggle = (t: SideTab) => (isOpen && tab === t ? close() : open(t));

  useToggleRise(toggles.agents, () => toggle('agents'));
  useToggleRise(toggles.files, () => toggle('files'));
  useToggleRise(toggles.replay, () => toggle('replay'));

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
