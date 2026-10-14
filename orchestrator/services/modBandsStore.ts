import {
  EMPTY_BANDS,
  parseCacheTax,
  parseCollisionGuard,
  parseReflect,
  type BandMod,
  type ModBands,
  type ModBandsState,
  type ReflectAction,
} from '@watchtower/shared/modBands.js';

export interface ReflectDecision {
  itemId: string;
  action: ReflectAction;
}

/**
 * Latest state per instance of the mods drawn on the Mods tab, in memory; each
 * mod re-posts on every change. Also queues reflect-mod clicks until the mod polls.
 */
export class ModBandsStore {
  private byInstance = new Map<string, ModBands>();
  private clicks = new Map<string, ReflectDecision[]>();

  constructor(
    private readonly emit: (state: ModBandsState) => void,
    private readonly isKnownInstance: (instanceId: string) => boolean,
  ) {}

  /** Validate and store a POSTed body; false when it was dropped. */
  ingest(mod: BandMod, body: unknown, instanceId: string): boolean {
    if (!this.isKnownInstance(instanceId)) return false;
    const prev = this.byInstance.get(instanceId) ?? EMPTY_BANDS;
    let next: ModBands;
    if (mod === 'cache-tax') {
      const band = parseCacheTax(body);
      if (band === undefined) return false;
      next = { ...prev, cacheTax: band };
    } else if (mod === 'collision-guard') {
      const peers = parseCollisionGuard(body);
      if (!peers) return false;
      next = { ...prev, peers };
    } else {
      const reflect = parseReflect(body);
      if (!reflect) return false;
      next = { ...prev, reflect };
      // A click on a rule the mod no longer lists would act on nothing; drop it.
      const live = new Set(reflect.map((i) => i.id));
      this.clicks.set(instanceId, (this.clicks.get(instanceId) ?? []).filter((c) => live.has(c.itemId)));
    }
    this.byInstance.set(instanceId, next);
    this.emit({ instanceId, bands: next });
    return true;
  }

  get(instanceId: string): ModBandsState {
    return { instanceId, bands: this.byInstance.get(instanceId) ?? EMPTY_BANDS };
  }

  /** Queues a click on a listed rule, one per rule; false when the rule isn't listed. */
  click(instanceId: string, itemId: string, action: ReflectAction): boolean {
    if (!this.get(instanceId).bands.reflect.some((i) => i.id === itemId)) return false;
    const queue = (this.clicks.get(instanceId) ?? []).filter((c) => c.itemId !== itemId);
    this.clicks.set(instanceId, [...queue, { itemId, action }]);
    return true;
  }

  /** The mod's poll: the oldest queued click, or null. */
  nextClick(instanceId: string): ReflectDecision | null {
    const queue = this.clicks.get(instanceId);
    const first = queue?.shift() ?? null;
    return first;
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
    this.clicks.delete(instanceId);
  }
}
