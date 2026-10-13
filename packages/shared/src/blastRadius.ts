// State the blast-radius mod (plugins/blast-radius) POSTs to `/mods/blast-radius`
// while it holds a risky Bash command. Mirrors the mod's post body — change both together.

export type BlastDecision = 'proceed' | 'cancel';
export type BlastOutcomeDecision = BlastDecision | 'timeout' | 'interrupted' | 'error';

export interface BlastHold {
  id: string;
  command: string;
  riskLabel: string;
  summary: string;
  lines: string[];
  /** Affected entries left out of `lines`. */
  more: number;
  note: string;
  startedAt: number;
}

export interface BlastOutcome {
  id: string;
  command: string;
  decision: BlastOutcomeDecision;
}

export interface BlastRadiusPost {
  hold: BlastHold | null;
  outcome: BlastOutcome | null;
}

export interface BlastRadiusState {
  instanceId: string;
  hold: BlastHold | null;
  /** The user's answer for `hold`, waiting for the mod to collect it. */
  decided: BlastDecision | null;
  /** How the last hold ended. */
  outcome: BlastOutcome | null;
  receivedAt: number;
}

const OUTCOMES: readonly BlastOutcomeDecision[] = ['proceed', 'cancel', 'timeout', 'interrupted', 'error'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseHold(v: unknown): BlastHold | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null;
  return {
    id: v.id.slice(0, 200),
    command: str(v.command, 2000),
    riskLabel: str(v.riskLabel, 200),
    summary: str(v.summary, 1000),
    lines: Array.isArray(v.lines) ? v.lines.filter((l): l is string => typeof l === 'string').slice(0, 50).map((l) => l.slice(0, 500)) : [],
    more: num(v.more),
    note: str(v.note, 1000),
    startedAt: num(v.startedAt),
  };
}

function parseOutcome(v: unknown): BlastOutcome | null {
  if (!isObj(v) || typeof v.id !== 'string' || !OUTCOMES.includes(v.decision as BlastOutcomeDecision)) return null;
  return { id: v.id.slice(0, 200), command: str(v.command, 2000), decision: v.decision as BlastOutcomeDecision };
}

/** Validates a POSTed body; null when it is not a v1 body or announces a hold without an id. */
export function parseBlastRadiusPost(body: unknown): BlastRadiusPost | null {
  if (!isObj(body) || body.version !== 1) return null;
  if (body.hold === null || body.hold === undefined) return { hold: null, outcome: parseOutcome(body.outcome) };
  const hold = parseHold(body.hold);
  return hold ? { hold, outcome: null } : null;
}

const short = (cmd: string): string => (cmd.length > 60 ? `${cmd.slice(0, 59)}…` : cmd);

/** The app toast for how a hold ended. */
export function outcomeToast(o: BlastOutcome): { severity: 'info' | 'warning'; text: string } {
  const cmd = `\`${short(o.command)}\``;
  if (o.decision === 'proceed') return { severity: 'info', text: `Blast Radius: running ${cmd}` };
  if (o.decision === 'cancel') return { severity: 'info', text: `Blast Radius: cancelled ${cmd}` };
  const why = { timeout: 'no answer within 10 minutes', interrupted: 'turn interrupted', error: 'error' }[o.decision];
  return { severity: 'warning', text: `Blast Radius: didn't run ${cmd} (${why})` };
}
