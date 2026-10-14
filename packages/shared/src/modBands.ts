// Shapes for the mods whose band above the prompt Watchtower draws on the Mods tab instead:
// plugins/cache-tax, plugins/collision-guard and plugins/reflect-mod → POST /mods/<name>.
// Each mod posts its whole state on every change; `null` means "nothing to show".

export const BAND_MODS = ['cache-tax', 'collision-guard', 'reflect-mod'] as const;
export type BandMod = (typeof BAND_MODS)[number];

export type CacheTaxState = 'warm' | 'cold' | 'stopped' | 'unknown';

/** cache-tax: is the prompt cache warm, and the band's own text after the state. */
export interface CacheTaxBand {
  state: CacheTaxState;
  text: string;
}

export type PeerTaskStatus = 'in progress' | 'done' | 'interrupted';

/** collision-guard: another live Claude session in the same repo. `where` is its folder when it differs (a worktree). */
export interface CollisionPeer {
  id: string;
  where: string | null;
  tasks: { text: string; status: PeerTaskStatus; at: number }[];
}

/** reflect-mod: a rule learned from the user's prompts, waiting for Save or Skip. */
export interface ReflectItem {
  id: string;
  rule: string;
  scope: 'global' | 'project';
  count: number;
}

export interface ModBands {
  cacheTax: CacheTaxBand | null;
  peers: CollisionPeer[];
  reflect: ReflectItem[];
}

export interface ModBandsState {
  instanceId: string;
  bands: ModBands;
}

/** What a click on a reflect rule asks the mod to do; `other` saves to the other CLAUDE.md. */
export type ReflectAction = 'save' | 'other' | 'edit' | 'skip';
export const REFLECT_ACTIONS: readonly ReflectAction[] = ['save', 'other', 'edit', 'skip'];

export const EMPTY_BANDS: ModBands = { cacheTax: null, peers: [], reflect: [] };

const MAX_PEERS = 10;
const MAX_TASKS = 5;
const MAX_ITEMS = 20;
const MAX_TEXT = 300;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null => (all.includes(v as T) ? (v as T) : null);

/** cache-tax body `{ version: 1, band: { state, text } | null }`; undefined when the shape is wrong. */
export function parseCacheTax(body: unknown): CacheTaxBand | null | undefined {
  if (!isObj(body) || body.version !== 1 || !('band' in body)) return undefined;
  if (body.band === null) return null;
  if (!isObj(body.band)) return undefined;
  const state = oneOf(body.band.state, ['warm', 'cold', 'stopped', 'unknown'] as const);
  return state ? { state, text: str(body.band.text) } : undefined;
}

/** collision-guard body `{ version: 1, peers: Peer[] }`. */
export function parseCollisionGuard(body: unknown): CollisionPeer[] | undefined {
  if (!isObj(body) || body.version !== 1 || !Array.isArray(body.peers)) return undefined;
  return body.peers
    .filter((p): p is Record<string, unknown> => isObj(p) && typeof p.id === 'string' && p.id !== '')
    .slice(0, MAX_PEERS)
    .map((p) => ({
      id: str(p.id),
      where: typeof p.where === 'string' ? str(p.where) : null,
      tasks: (Array.isArray(p.tasks) ? p.tasks : [])
        .filter(isObj)
        .map((t) => ({ text: str(t.text), status: oneOf(t.status, ['in progress', 'done', 'interrupted'] as const) ?? 'done', at: num(t.at) }))
        .slice(-MAX_TASKS),
    }));
}

/** reflect-mod body `{ version: 1, items: ReflectItem[] }`, newest decision first as the mod sorts them. */
export function parseReflect(body: unknown): ReflectItem[] | undefined {
  if (!isObj(body) || body.version !== 1 || !Array.isArray(body.items)) return undefined;
  return body.items
    .filter((i): i is Record<string, unknown> => isObj(i) && typeof i.id === 'string' && i.id !== '' && typeof i.rule === 'string')
    .slice(0, MAX_ITEMS)
    .map((i) => ({ id: str(i.id), rule: str(i.rule), scope: i.scope === 'project' ? 'project' : 'global', count: Math.max(1, num(i.count)) }));
}
