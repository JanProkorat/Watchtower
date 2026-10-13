import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSavvyProgress } from '../../../state/useSavvyProgress.js';
import { SavvyAgentsPanel, PANEL_W, clampPanelWidth } from './SavvyAgentsPanel.js';
import { SavvyProgressBand, BAND_BOX_H } from './SavvyProgressBand.js';
import { plannedOf } from './savvyDraw.js';

const GAP = 8;
const WIDTH_KEY = 'watchtower.savvyPanelWidth';

export interface SavvyChrome {
  /** Space to keep free below the terminal for the band (0 when hidden). */
  bottomInset: number;
  /** Space to keep free right of the terminal for the panel (0 when hidden). */
  rightInset: number;
  band: ReactNode;
  panel: ReactNode;
  /** The panel has content but the user closed it: offer a way back. */
  isPanelClosed: boolean;
  openPanel(): void;
}

/**
 * Lays the savvy-progress mod's band and agents panel around an instance's
 * terminal, from the snapshot the mod posts. Nothing shows (and no space is
 * taken) until the mod has posted something worth drawing.
 */
export function useSavvyChrome(instanceId: string, enabled: boolean): SavvyChrome {
  const state = useSavvyProgress(instanceId);
  const snapshot = enabled ? state?.snapshot ?? null : null;
  const flow = snapshot?.flow ?? null;
  const agents = snapshot?.agents ?? [];
  const isWorking = agents.some((a) => a.status === 'running');
  const now = useTicker(isWorking);
  // Times in the snapshot are on the mod's clock; carry them onto ours.
  const at = now - (state ? state.receivedAt - state.snapshot.sentAt : 0);
  const [width, setWidth] = usePanelWidth();

  // The panel opens by itself once there's something in it, as the mod's pane
  // does. Closing or opening it by hand holds until the next flow starts.
  const [choice, setChoice] = useState<{ isOpen: boolean; flowKey: string } | null>(null);
  const [dismissedFlow, setDismissedFlow] = useState<string | null>(null);
  const flowKey = flow ? flow.title : '';

  const crew = agents.length + plannedOf(flow, agents).length;
  const hasContent = crew > 0;
  const isPanelOpen = snapshot != null && (choice?.flowKey === flowKey ? choice.isOpen : hasContent);
  const isBandShown = flow != null && dismissedFlow !== flow.title;
  const setOpen = (isOpen: boolean) => setChoice({ isOpen, flowKey });

  // `/agents-info` in the terminal bumps the mod's counter: each rise toggles
  // the panel. A drop means the mod reloaded; just resync.
  const toggles = snapshot?.panelToggles;
  const lastToggles = useRef(toggles);
  useEffect(() => {
    const prev = lastToggles.current;
    lastToggles.current = toggles;
    if (prev !== undefined && toggles !== undefined && toggles > prev) setOpen(!isPanelOpen);
    // Only a new count should toggle; the other values are read as of that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggles]);

  return {
    bottomInset: isBandShown ? BAND_BOX_H + GAP : 0,
    rightInset: isPanelOpen ? width : 0,
    band:
      isBandShown && snapshot && flow ? (
        <SavvyProgressBand
          flow={flow}
          lang={snapshot.lang}
          crew={crew}
          isWorking={isWorking}
          onToggleAgents={() => setOpen(!isPanelOpen)}
          onDismiss={() => setDismissedFlow(flow.title)}
        />
      ) : null,
    panel:
      isPanelOpen && snapshot ? (
        <SavvyAgentsPanel snapshot={snapshot} at={at} width={width} onResize={setWidth} onClose={() => setOpen(false)} />
      ) : null,
    isPanelClosed: hasContent && !isPanelOpen,
    openPanel: () => setOpen(true),
  };
}

/** The panel's width, shared by every pane and remembered across launches. */
function usePanelWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return saved ? clampPanelWidth(saved) : PANEL_W;
    } catch {
      return PANEL_W;
    }
  });
  const set = (w: number) => {
    const next = clampPanelWidth(w);
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Not remembered; the width still applies for this session.
    }
  };
  return [width, set];
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
