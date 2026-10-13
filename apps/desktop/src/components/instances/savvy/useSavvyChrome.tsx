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
