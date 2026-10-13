// State snapshot the savvy-progress mod (plugins/savvy-progress) POSTs to the
// hook listener's `/mods/savvy-progress` route. Watchtower draws the mod's
// agents panel and progress band natively from it (the terminal CLI can only
// draw the mod's crabs as a `▣` glyph — they are SVG, desktop-surface only).
//
// Mirrors plugins/savvy-progress/types/index.d.ts — change both together.

export type SavvyPhase = 'plan' | 'design' | 'delegate' | 'review' | 'close';

export interface SavvyPlannedTask {
  title: string;
  tier: string;
  after: number[];
}

export interface SavvyFlow {
  title: string;
  total: number;
  done: number;
  running: number;
  phase: SavvyPhase;
  isFinished: boolean;
  tasks: SavvyPlannedTask[];
}

export type SavvyAgentStatus = 'running' | 'done' | 'failed';

export interface SavvyAgentRun {
  id: string;
  agentId?: string;
  type: string;
  description: string;
  model: string;
  effort?: string;
  status: SavvyAgentStatus;
  startedAt: number;
  endedAt?: number;
  contextTokens: number;
  contextMax: number;
  tokens: number;
  costUsd: number;
  steps: number;
  round: number;
  stepDone?: number;
  stepTotal?: number;
  stepNote?: string;
}

export interface SavvyProgressSnapshot {
  lang: 'en' | 'ru';
  flow: SavvyFlow | null;
  agents: SavvyAgentRun[];
  /** The mod's clock (epoch ms) when it sent the snapshot. */
  sentAt: number;
  /** Bumped by each `/agents-info` run; a rise asks Watchtower to toggle its panel. */
  panelToggles: number;
}

/** Payload of the `savvyProgress` push and the `savvyProgress:get` response. */
export interface SavvyProgressState {
  instanceId: string;
  snapshot: SavvyProgressSnapshot;
  /** Orchestrator clock when the snapshot arrived — `receivedAt - sentAt` is the clock skew. */
  receivedAt: number;
}

const PHASES: readonly SavvyPhase[] = ['plan', 'design', 'delegate', 'review', 'close'];
const STATUSES: readonly SavvyAgentStatus[] = ['running', 'done', 'failed'];
const MAX_AGENTS = 200;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function parseFlow(v: unknown): SavvyFlow | null {
  if (!isObj(v)) return null;
  const phase = PHASES.includes(v.phase as SavvyPhase) ? (v.phase as SavvyPhase) : 'plan';
  const tasks = Array.isArray(v.tasks)
    ? v.tasks.filter(isObj).map((t) => ({
        title: str(t.title),
        tier: str(t.tier),
        after: Array.isArray(t.after) ? t.after.filter((n): n is number => Number.isInteger(n)) : [],
      }))
    : [];
  return {
    title: str(v.title, 'savvy-flow'),
    total: num(v.total),
    done: num(v.done),
    running: num(v.running),
    phase,
    isFinished: v.isFinished === true,
    tasks,
  };
}

function parseAgent(v: unknown): SavvyAgentRun | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const status = STATUSES.includes(v.status as SavvyAgentStatus) ? (v.status as SavvyAgentStatus) : 'running';
  return {
    id: v.id,
    agentId: optStr(v.agentId),
    type: str(v.type),
    description: str(v.description),
    model: str(v.model),
    effort: optStr(v.effort),
    status,
    startedAt: num(v.startedAt),
    endedAt: optNum(v.endedAt),
    contextTokens: num(v.contextTokens),
    contextMax: num(v.contextMax),
    tokens: num(v.tokens),
    costUsd: num(v.costUsd),
    steps: num(v.steps),
    round: num(v.round, 1),
    stepDone: optNum(v.stepDone),
    stepTotal: optNum(v.stepTotal),
    stepNote: optStr(v.stepNote),
  };
}

/**
 * Validates a POSTed body into a snapshot, or null when it is not one. Lenient
 * per field (a missing number reads as 0) so a newer mod's extra or absent
 * fields never blank the panel; strict only on the shape.
 */
export function parseSavvySnapshot(body: unknown): SavvyProgressSnapshot | null {
  if (!isObj(body) || body.version !== 1 || !Array.isArray(body.agents)) return null;
  return {
    lang: body.lang === 'ru' ? 'ru' : 'en',
    flow: parseFlow(body.flow),
    agents: body.agents
      .map(parseAgent)
      .filter((a): a is SavvyAgentRun => a !== null)
      .slice(-MAX_AGENTS),
    sentAt: num(body.sentAt),
    panelToggles: num(body.panelToggles),
  };
}

/** True when there is nothing to draw: no flow and no subagents. */
export function isEmptySnapshot(s: SavvyProgressSnapshot): boolean {
  return s.flow === null && s.agents.length === 0;
}
