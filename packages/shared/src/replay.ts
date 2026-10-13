// Shapes for the replay-theater mod's diff replay (plugins/replay-theater → POST /mods/replay-theater).

export type ReplayLineKind = 'add' | 'del' | 'ctx' | 'gap';

export interface ReplayLine {
  kind: ReplayLineKind;
  text: string;
}

export interface ReplayStep {
  file: string;
  tool: string;
  note: string;
  added: number;
  deleted: number;
  lines: ReplayLine[];
}

export interface ReplayTurn {
  at: number;
  steps: ReplayStep[];
}

export interface ReplaySnapshot {
  turn: ReplayTurn | null;
  /** Bumped by each `/replay` run; a rise toggles the Replay tab. */
  panelToggles: number;
  sentAt: number;
}

export interface ReplayState {
  instanceId: string;
  snapshot: ReplaySnapshot;
  receivedAt: number;
}

const MAX_STEPS = 50;
const MAX_LINES = 200;
const MAX_LINE_CHARS = 500;
const KINDS: readonly string[] = ['add', 'del', 'ctx', 'gap'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function parseStep(raw: unknown): ReplayStep | null {
  if (!isObj(raw) || !Array.isArray(raw.lines)) return null;
  const lines = raw.lines
    .filter((l): l is Record<string, unknown> => isObj(l) && typeof l.kind === 'string' && KINDS.includes(l.kind) && typeof l.text === 'string')
    .slice(0, MAX_LINES)
    .map((l) => ({ kind: l.kind as ReplayLineKind, text: (l.text as string).slice(0, MAX_LINE_CHARS) }));
  return { file: str(raw.file), tool: str(raw.tool), note: str(raw.note), added: num(raw.added), deleted: num(raw.deleted), lines };
}

/** Validates a POSTed body; lenient per field, strict on the shape. */
export function parseReplay(body: unknown): ReplaySnapshot | null {
  if (!isObj(body) || body.version !== 1) return null;
  let turn: ReplayTurn | null = null;
  if (isObj(body.turn) && Array.isArray(body.turn.steps)) {
    const steps = body.turn.steps
      .map(parseStep)
      .filter((s): s is ReplayStep => s !== null)
      .slice(0, MAX_STEPS);
    turn = { at: num(body.turn.at), steps };
  }
  return { turn, panelToggles: num(body.panelToggles), sentAt: num(body.sentAt) };
}
