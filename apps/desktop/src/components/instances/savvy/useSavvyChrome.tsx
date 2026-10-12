import { useEffect, useState, type ReactNode } from 'react';
import { useSavvyProgress } from '../../../state/useSavvyProgress.js';
import { SavvyAgentsPanel, PANEL_W } from './SavvyAgentsPanel.js';
import { SavvyProgressBand, BAND_BOX_H } from './SavvyProgressBand.js';
import { plannedOf } from './savvyDraw.js';

const GAP = 8;

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

  // The panel opens by itself once there's something in it, as the mod's pane
  // does; closing it holds until the next flow starts.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [dismissedFlow, setDismissedFlow] = useState<string | null>(null);
  const flowKey = flow ? flow.title : '';
  useEffect(() => {
    setClosedFor((prev) => (prev !== null && prev !== flowKey ? null : prev));
  }, [flowKey]);

  const crew = agents.length + plannedOf(flow, agents).length;
  const hasContent = crew > 0;
  const isPanelOpen = hasContent && closedFor !== flowKey;
  const isBandShown = flow != null && dismissedFlow !== flow.title;

  return {
    bottomInset: isBandShown ? BAND_BOX_H + GAP : 0,
    rightInset: isPanelOpen ? PANEL_W + GAP : 0,
    band:
      isBandShown && snapshot && flow ? (
        <SavvyProgressBand
          flow={flow}
          lang={snapshot.lang}
          crew={crew}
          isWorking={isWorking}
          onToggleAgents={() => setClosedFor(isPanelOpen ? flowKey : null)}
          onDismiss={() => setDismissedFlow(flow.title)}
        />
      ) : null,
    panel:
      isPanelOpen && snapshot ? (
        <SavvyAgentsPanel snapshot={snapshot} at={at} onClose={() => setClosedFor(flowKey)} />
      ) : null,
    isPanelClosed: hasContent && !isPanelOpen,
    openPanel: () => setClosedFor(null),
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

export { GAP as SAVVY_GAP };
