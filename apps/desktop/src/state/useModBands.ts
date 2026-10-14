import { useEffect, useState } from 'react';
import { EMPTY_BANDS, type ModBands, type ReflectAction } from '@watchtower/shared/modBands.js';
import { invoke } from './ipc';

export interface ModBandsControls {
  bands: ModBands;
  /** Queues a reflect rule action; the mod runs it on its next poll. */
  click(itemId: string, action: ReflectAction): Promise<void>;
}

/** What cache-tax, collision-guard and reflect-mod would draw above this instance's prompt. */
export function useModBands(instanceId: string): ModBandsControls {
  const [bands, setBands] = useState<ModBands>(EMPTY_BANDS);
  useEffect(() => {
    let alive = true;
    setBands(EMPTY_BANDS);
    let pushed = false;
    invoke('modBands:get', { instanceId })
      .then((s) => {
        if (alive && !pushed) setBands(s.bands);
      })
      .catch(() => {});
    const off = window.watchtower.on('modBands', (payload) => {
      if (payload.instanceId !== instanceId) return;
      pushed = true;
      setBands(payload.bands);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);

  const click = async (itemId: string, action: ReflectAction) => {
    await invoke('modBands:click', { instanceId, itemId, action }).catch(() => {});
  };
  return { bands, click };
}

/** The Mods tab has something to show. */
export const hasModBands = (b: ModBands): boolean => b.cacheTax !== null || b.peers.length > 0 || b.reflect.length > 0;

/** Things waiting on the user: rules to decide and other sessions in this repo. */
export const modBandsCount = (b: ModBands): number => b.reflect.length + b.peers.length;
