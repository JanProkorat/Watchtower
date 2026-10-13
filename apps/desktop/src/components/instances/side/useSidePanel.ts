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

/** A pane's tabs: Agents wherever Claude runs (empty until subagents start), Files wherever there is a folder. */
export function sideTabsFor(kind: 'claude' | 'shell' | 'chat', cwd: string): SideTab[] {
  return [...(kind !== 'shell' ? (['agents'] as const) : []), ...(cwd ? (['files'] as const) : [])];
}

/** One pane's right-side panel: which tab shows, whether it is open, and how wide. */
export function useSidePanel({ available, agentsAutoKey, toggles }: SidePanelOptions): SidePanel {
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
