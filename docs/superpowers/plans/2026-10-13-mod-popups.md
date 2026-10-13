# Blast-radius Popup and Replay Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the blast-radius mod's hold into a blocking Watchtower popup (answer sent back to the mod by polling) with an app toast for the outcome, and replay-theater's diff viewer into a third side-panel tab.

**Architecture:** Each mod gets a vendored, patched copy in `plugins/` that — inside Watchtower (`WATCHTOWER_INSTANCE_ID` set) — POSTs its state to the hook listener instead of drawing in the terminal. blast-radius also GETs a new authenticated `/mods/blast-radius/decision` route each wait-loop iteration. Watchtower keeps per-instance stores (twins of `fileTreeActivityStore`), pushes them to the renderer, and draws a `BlastRadiusDialog` over the pane and a `ReplayTab` in the side panel.

**Tech Stack:** TypeScript, React 18 + MUI v5, Node orchestrator (Fastify hook listener), vitest + @testing-library/react 16, Claude Code mod engine (`claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-13-mod-popups-design.md` (builds on `2026-10-13-side-panel-tabs-design.md`, same branch).

## Global Constraints

- Work only in the worktree `/Users/jan/Projects/Watchtower/.claude/worktrees/side-panel-tabs`, branch `feat/side-panel-tabs`.
- UI text English; no i18n. Renderer/orchestrator/shared files use semicolons; the vendored `.mjs` mods keep their own style (they use semicolons).
- All renderer IPC through `invoke()` in `apps/desktop/src/state/ipc.ts`. New kinds: `ipcContract.ts` (request + response + push) → `messagePort.ts` → `orchestrator/index.ts` → thin hook in `apps/desktop/src/state/`.
- `SILENT_KINDS` gains `blastRadius:get` and `replay:get`. `blastRadius:decide` stays loud.
- "Inside Watchtower" = `WATCHTOWER_INSTANCE_ID` is set (never "the bridge works"). The bridge (listener.json → port + token) is transport only and is rediscovered after a 401/404/network error.
- Only an explicit `proceed` for the currently pending hold id runs a held command. Anything else (cancel, timeout 10 min, interrupt, error, unknown) denies.
- Store hold expiry: 11 minutes after the store received the hold.
- Replay caps (mod and parser): 50 steps, 200 lines per step, 500 chars per line. Blast caps (parser): command 2,000 chars, 50 lines, 500 chars per line, note/summary 1,000 chars.
- Toast text: command shortened to 60 chars with `…`. proceed → info "Blast Radius: running `<cmd>`"; cancel → info "Blast Radius: cancelled `<cmd>`"; timeout → warning "Blast Radius: didn't run `<cmd>` (no answer within 10 minutes)"; interrupted → warning "… (turn interrupted)"; error → warning "… (error)".
- Vendored mods: Apache-2.0. Copy the playground repo root `LICENSE` into each mod folder, keep the per-file SPDX headers, add a "Watchtower fork" note at the top of each README listing every change, leave out `screenshots/`.
- Every task ends green on its focused tests and `npm --prefix <worktree> run typecheck:ci`. Run the full `npm --prefix <worktree> test` before the last commit of each phase (known env failures only: `sync/{pull,purge,service}.test.ts`, `taskGridStickyOpaque.test.tsx`, and sometimes `bootstrap*.test.ts`). Mod tests: `claude plugin test <worktree>/plugins/<mod>`.
- Commit per task, attribution `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage only the task's files (never `package-lock.json`); never `--no-verify`.

## Review Focus

1. The user clicks into the pane while a hold is pending (fires `tabFocused` → status `working`): the amber ⚠ must come back on the mod's next poll — pinned in Task 2 (store re-asserts on `decisionFor`).
2. Two holds back to back: a late `proceed` meant for the first must not release the second — pinned in Task 2 (stale id ignored).
3. Watchtower restarts during a hold: the next poll gets 404 and the mod re-posts, so the popup returns — pinned in Task 3 (route 404 on unknown id) and Task 6 (mod re-posts on 404).
4. Reopening the app (or remounting a pane) must not replay an old outcome toast — pinned in Task 4 (outcome seen at load is not toasted).
5. A new replay turn while the user is on step 4 resets to step 1 — pinned in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/blastRadius.ts` (new) | Hold/outcome shapes, `parseBlastRadiusPost`, `outcomeToast` |
| `orchestrator/services/blastRadiusStore.ts` (new) | Pending hold + decision + last outcome per instance; attention callbacks; expiry |
| `orchestrator/hookListener.ts` (modify) | `KNOWN_MODS` += `blast-radius`, `replay-theater`; `GET /mods/:plugin/decision` |
| `orchestrator/bootstrap.ts` (modify) | Pass `onModDecision` through |
| `apps/desktop/src/state/useBlastRadius.ts` (new) | State, `decide()`, outcome toasts once |
| `apps/desktop/src/components/instances/BlastRadiusDialog.tsx` (new) | The popup over a pane |
| `packages/shared/src/replay.ts` (new) | Replay shapes, `parseReplay` |
| `orchestrator/services/replayStore.ts` (new) | Latest replay turn per instance |
| `apps/desktop/src/state/useReplay.ts` (new) | State + unseen-count hook |
| `apps/desktop/src/components/instances/side/ReplayTab.tsx` (new) | Step chips, diff, prev/next |
| `plugins/blast-radius/**`, `plugins/replay-theater/**` (new, vendored) | Patched mods |

---

## Phase 1 — Blast-radius popup

### Task 1: Shared blast-radius shapes, parser and toast text

**Files:**
- Create: `packages/shared/src/blastRadius.ts`
- Test: `tests/shared/blastRadius.test.ts`

**Interfaces — Produces:**
```ts
export type BlastDecision = 'proceed' | 'cancel';
export type BlastOutcomeDecision = BlastDecision | 'timeout' | 'interrupted' | 'error';
export interface BlastHold { id: string; command: string; riskLabel: string; summary: string; lines: string[]; more: number; note: string; startedAt: number }
export interface BlastOutcome { id: string; command: string; decision: BlastOutcomeDecision }
export interface BlastRadiusPost { hold: BlastHold | null; outcome: BlastOutcome | null }
export interface BlastRadiusState { instanceId: string; hold: BlastHold | null; decided: BlastDecision | null; outcome: BlastOutcome | null; receivedAt: number }
export function parseBlastRadiusPost(body: unknown): BlastRadiusPost | null;
export function outcomeToast(o: BlastOutcome): { severity: 'info' | 'warning'; text: string };
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseBlastRadiusPost, outcomeToast } from '@watchtower/shared/blastRadius.js';

const hold = { id: 'h1', command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 'delete 3 files', lines: ['dist/a', 'dist/b'], more: 1, note: 'Paths: dist', startedAt: 5 };

describe('parseBlastRadiusPost', () => {
  it('accepts a hold and a release with an outcome', () => {
    expect(parseBlastRadiusPost({ version: 1, hold })).toEqual({ hold, outcome: null });
    expect(parseBlastRadiusPost({ version: 1, hold: null, outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' } })).toEqual({
      hold: null,
      outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' },
    });
  });

  it('rejects non-v1 bodies, a hold without an id, and an unknown outcome decision', () => {
    expect(parseBlastRadiusPost({ version: 2, hold })).toBeNull();
    expect(parseBlastRadiusPost(null)).toBeNull();
    expect(parseBlastRadiusPost({ version: 1, hold: { ...hold, id: '' } })).toBeNull();
    expect(parseBlastRadiusPost({ version: 1, hold: null, outcome: { id: 'h1', command: 'x', decision: 'maybe' } })).toEqual({ hold: null, outcome: null });
  });

  it('caps long fields and is lenient per field', () => {
    const p = parseBlastRadiusPost({ version: 1, hold: { ...hold, command: 'x'.repeat(5000), lines: Array.from({ length: 80 }, () => 'y'.repeat(900)), more: 'lots' } });
    expect(p?.hold?.command).toHaveLength(2000);
    expect(p?.hold?.lines).toHaveLength(50);
    expect(p?.hold?.lines[0]).toHaveLength(500);
    expect(p?.hold?.more).toBe(0);
  });
});

describe('outcomeToast', () => {
  it('words each outcome with the right severity and a shortened command', () => {
    expect(outcomeToast({ id: 'a', command: 'rm -rf dist', decision: 'proceed' })).toEqual({ severity: 'info', text: 'Blast Radius: running `rm -rf dist`' });
    expect(outcomeToast({ id: 'a', command: 'rm -rf dist', decision: 'cancel' })).toEqual({ severity: 'info', text: 'Blast Radius: cancelled `rm -rf dist`' });
    expect(outcomeToast({ id: 'a', command: 'git clean -fd', decision: 'timeout' }).text).toBe("Blast Radius: didn't run `git clean -fd` (no answer within 10 minutes)");
    expect(outcomeToast({ id: 'a', command: 'x', decision: 'interrupted' })).toEqual({ severity: 'warning', text: "Blast Radius: didn't run `x` (turn interrupted)" });
    expect(outcomeToast({ id: 'a', command: 'x', decision: 'error' }).text).toBe("Blast Radius: didn't run `x` (error)");
    const long = outcomeToast({ id: 'a', command: 'rm -rf ' + 'a'.repeat(100), decision: 'proceed' }).text;
    expect(long).toContain('…`');
    expect(long.length).toBeLessThan(90);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `<worktree>/node_modules/.bin/vitest run --root <worktree> tests/shared/blastRadius.test.ts` → FAIL (module missing; run `npm --prefix <worktree> run typecheck:ci` once after Step 3 so `@watchtower/shared` dist rebuilds).

- [ ] **Step 3: Implement** `packages/shared/src/blastRadius.ts`

```ts
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
```

- [ ] **Step 4: Verify** — typecheck:ci then the test file → PASS.
- [ ] **Step 5: Commit** `feat(blast-radius): shared hold shapes, parser and outcome toast text`.

### Task 2: `BlastRadiusStore`

**Files:**
- Create: `orchestrator/services/blastRadiusStore.ts`
- Test: `tests/orchestrator/blastRadiusStore.test.ts`

**Interfaces:**
- Consumes: Task 1 shapes and `parseBlastRadiusPost`.
- Produces:
```ts
export interface BlastRadiusHooks {
  emit(state: BlastRadiusState): void;
  isKnownInstance(instanceId: string): boolean;
  /** Flag the instance as waiting on the user (idempotent). */
  hold(instanceId: string): void;
  /** Clear that flag (idempotent). */
  release(instanceId: string): void;
}
export const HOLD_EXPIRY_MS = 11 * 60 * 1000;
export class BlastRadiusStore {
  constructor(hooks: BlastRadiusHooks);
  ingest(body: unknown, instanceId: string, now: number): boolean;
  decide(instanceId: string, holdId: string, decision: BlastDecision, now: number): boolean;
  /** undefined = no such pending hold (route answers 404); null = still waiting. Re-asserts the attention flag while waiting. */
  decisionFor(instanceId: string, holdId: string, now: number): BlastDecision | null | undefined;
  get(instanceId: string, now: number): BlastRadiusState | null;
  /** Drops holds older than HOLD_EXPIRY_MS; call on a timer. */
  sweep(now: number): void;
  dispose(instanceId: string): void;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { BlastRadiusStore, HOLD_EXPIRY_MS, type BlastRadiusHooks } from '../../orchestrator/services/blastRadiusStore.js';
import type { BlastRadiusState } from '@watchtower/shared/blastRadius.js';

const hold = (id: string) => ({ version: 1, hold: { id, command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 's', lines: [], more: 0, note: '', startedAt: 1 } });
const release = (id: string, decision = 'proceed') => ({ version: 1, hold: null, outcome: { id, command: 'rm -rf dist', decision } });

function make() {
  const log: string[] = [];
  const pushed: BlastRadiusState[] = [];
  const hooks: BlastRadiusHooks = {
    emit: (s) => pushed.push(s),
    isKnownInstance: (id) => id === 'i1',
    hold: (id) => log.push(`hold ${id}`),
    release: (id) => log.push(`release ${id}`),
  };
  return { store: new BlastRadiusStore(hooks), log, pushed };
}

describe('BlastRadiusStore', () => {
  it('a hold flags attention and pushes; a release clears it and records the outcome', () => {
    const { store, log, pushed } = make();
    expect(store.ingest(hold('h1'), 'i1', 100)).toBe(true);
    expect(store.get('i1', 100)).toMatchObject({ hold: { id: 'h1' }, decided: null });
    expect(store.ingest(release('h1'), 'i1', 200)).toBe(true);
    expect(store.get('i1', 200)).toMatchObject({ hold: null, outcome: { id: 'h1', decision: 'proceed' } });
    expect(log).toEqual(['hold i1', 'release i1']);
    expect(pushed).toHaveLength(2);
  });

  it('drops unknown instances and invalid bodies', () => {
    const { store, pushed } = make();
    expect(store.ingest(hold('h1'), 'stranger', 1)).toBe(false);
    expect(store.ingest({ version: 9 }, 'i1', 1)).toBe(false);
    expect(pushed).toEqual([]);
  });

  it('a decision is collected only for the pending hold id; stale ids are ignored', () => {
    const { store } = make();
    store.ingest(hold('h1'), 'i1', 1);
    expect(store.decide('i1', 'old', 'proceed', 2)).toBe(false);
    expect(store.decisionFor('i1', 'h1', 3)).toBeNull();
    expect(store.decide('i1', 'h1', 'cancel', 4)).toBe(true);
    expect(store.decisionFor('i1', 'h1', 5)).toBe('cancel');
    expect(store.decisionFor('i1', 'other', 6)).toBeUndefined();
    // A second hold starts undecided even if the first one's answer arrives late.
    store.ingest(release('h1', 'cancel'), 'i1', 7);
    store.ingest(hold('h2'), 'i1', 8);
    expect(store.decide('i1', 'h1', 'proceed', 9)).toBe(false);
    expect(store.decisionFor('i1', 'h2', 10)).toBeNull();
  });

  it('a poll while still waiting re-asserts the attention flag (focus clears it)', () => {
    const { store, log } = make();
    store.ingest(hold('h1'), 'i1', 1);
    store.decisionFor('i1', 'h1', 2);
    store.decisionFor('i1', 'h1', 3);
    expect(log).toEqual(['hold i1', 'hold i1', 'hold i1']);
    store.decide('i1', 'h1', 'proceed', 4);
    store.decisionFor('i1', 'h1', 5);
    expect(log).toHaveLength(3); // answered: no re-assert
  });

  it('expires a hold after 11 minutes and on dispose', () => {
    const { store, log } = make();
    store.ingest(hold('h1'), 'i1', 0);
    store.sweep(HOLD_EXPIRY_MS - 1);
    expect(store.get('i1', HOLD_EXPIRY_MS - 1)?.hold).not.toBeNull();
    store.sweep(HOLD_EXPIRY_MS + 1);
    expect(store.get('i1', HOLD_EXPIRY_MS + 1)?.hold).toBeNull();
    expect(log.at(-1)).toBe('release i1');
    store.ingest(hold('h2'), 'i1', 0);
    store.dispose('i1');
    expect(store.get('i1', 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement**

```ts
import {
  parseBlastRadiusPost,
  type BlastDecision,
  type BlastRadiusState,
} from '@watchtower/shared/blastRadius.js';

export const HOLD_EXPIRY_MS = 11 * 60 * 1000;

export interface BlastRadiusHooks {
  emit(state: BlastRadiusState): void;
  isKnownInstance(instanceId: string): boolean;
  /** Flag the instance as waiting on the user (idempotent). */
  hold(instanceId: string): void;
  /** Clear that flag (idempotent). */
  release(instanceId: string): void;
}

/** The blast-radius mod's pending hold, the user's answer and the last outcome, per instance, in memory. */
export class BlastRadiusStore {
  private byInstance = new Map<string, BlastRadiusState>();

  constructor(private readonly hooks: BlastRadiusHooks) {}

  ingest(body: unknown, instanceId: string, now: number): boolean {
    if (!this.hooks.isKnownInstance(instanceId)) return false;
    const post = parseBlastRadiusPost(body);
    if (!post) return false;
    const prev = this.byInstance.get(instanceId);
    const state: BlastRadiusState = post.hold
      ? { instanceId, hold: post.hold, decided: prev?.hold?.id === post.hold.id ? prev.decided : null, outcome: prev?.outcome ?? null, receivedAt: now }
      : { instanceId, hold: null, decided: null, outcome: post.outcome ?? prev?.outcome ?? null, receivedAt: now };
    this.byInstance.set(instanceId, state);
    if (state.hold) this.hooks.hold(instanceId);
    else this.hooks.release(instanceId);
    this.hooks.emit(state);
    return true;
  }

  decide(instanceId: string, holdId: string, decision: BlastDecision, now: number): boolean {
    const s = this.live(instanceId, now);
    if (!s?.hold || s.hold.id !== holdId || s.decided) return false;
    const next = { ...s, decided: decision };
    this.byInstance.set(instanceId, next);
    this.hooks.emit(next);
    return true;
  }

  decisionFor(instanceId: string, holdId: string, now: number): BlastDecision | null | undefined {
    const s = this.live(instanceId, now);
    if (!s?.hold || s.hold.id !== holdId) return undefined;
    // A click into the pane resets its status; keep it flagged while the user still owes an answer.
    if (!s.decided) this.hooks.hold(instanceId);
    return s.decided;
  }

  get(instanceId: string, now: number): BlastRadiusState | null {
    return this.live(instanceId, now) ?? null;
  }

  sweep(now: number): void {
    for (const id of [...this.byInstance.keys()]) this.live(id, now);
  }

  dispose(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }

  /** The state with an expired hold dropped (and announced). */
  private live(instanceId: string, now: number): BlastRadiusState | undefined {
    const s = this.byInstance.get(instanceId);
    if (!s?.hold || now - s.receivedAt <= HOLD_EXPIRY_MS) return s;
    const next: BlastRadiusState = { ...s, hold: null, decided: null, receivedAt: now };
    this.byInstance.set(instanceId, next);
    this.hooks.release(instanceId);
    this.hooks.emit(next);
    return next;
  }
}
```
Note `receivedAt` for a hold is refreshed by every re-post of the same hold; expiry counts from the latest post. The mod re-posts only after a 404 (Task 6), so in practice it counts from the first post.

- [ ] **Step 4: Verify** — test file PASS, typecheck:ci clean.
- [ ] **Step 5: Commit** `feat(blast-radius): store for pending holds, answers and outcomes`.

### Task 3: Decision route on the hook listener

**Files:**
- Modify: `orchestrator/hookListener.ts` (`KNOWN_MODS` at :16, options at :19-25, POST route at :73-92)
- Modify: `orchestrator/bootstrap.ts` (option type ~:36, passthrough ~:180-190)
- Test: `tests/orchestrator/hookListener.test.ts` (new `describe` with its own port range `17441-17450`)

**Interfaces — Produces:** listener option `onModDecision?: (plugin: string, holdId: string, instanceId: string) => unknown | Promise<unknown>` — return `undefined` for "no such hold" (404), otherwise the value is sent as `{ decision: value }` with 200. `KNOWN_MODS = new Set(['savvy-progress', 'filetree', 'blast-radius', 'replay-theater'])`.

- [ ] **Step 1: Write the failing tests** (append; reuse the file's existing `import`s and `startHookListener`)

```ts
describe('GET /mods/:plugin/decision', () => {
  let handle: Awaited<ReturnType<typeof startHookListener>>;
  const asked: { plugin: string; id: string; instanceId: string }[] = [];
  beforeAll(async () => {
    handle = await startHookListener({
      token: 'test-token',
      portRange: [17441, 17450],
      onEvent: async () => {},
      onModDecision: (plugin, id, instanceId) => {
        asked.push({ plugin, id, instanceId });
        return id === 'h1' ? 'proceed' : id === 'h2' ? null : undefined;
      },
    });
  });
  afterAll(async () => handle.close());

  const get = (path: string, headers: Record<string, string>) => fetch(`http://127.0.0.1:${handle.port}${path}`, { headers });
  const auth = { authorization: 'Bearer test-token', 'x-watchtower-instance': 'inst-1' };

  it('returns the recorded decision, null while waiting, 404 for an unknown hold', async () => {
    const a = await get('/mods/blast-radius/decision?id=h1', auth);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ decision: 'proceed' });
    expect(await (await get('/mods/blast-radius/decision?id=h2', auth)).json()).toEqual({ decision: null });
    expect((await get('/mods/blast-radius/decision?id=nope', auth)).status).toBe(404);
    expect(asked[0]).toEqual({ plugin: 'blast-radius', id: 'h1', instanceId: 'inst-1' });
  });

  it('needs the token, a known mod and the instance header', async () => {
    expect((await get('/mods/blast-radius/decision?id=h1', { 'x-watchtower-instance': 'inst-1' })).status).toBe(401);
    expect((await get('/mods/other/decision?id=h1', auth)).status).toBe(404);
    expect((await get('/mods/blast-radius/decision?id=h1', { authorization: 'Bearer test-token' })).status).toBe(400);
  });
});
```
If the 401 case hits the file's known undici ECONNRESET quirk (see the first `describe`'s `node:http` helper), use that helper for the 401 request instead.

- [ ] **Step 2: Run to verify it fails** — the GET returns 404 for every case.

- [ ] **Step 3: Implement**
  - `KNOWN_MODS` as above.
  - Add to the options interface: `onModDecision?: (plugin: string, holdId: string, instanceId: string) => unknown | Promise<unknown>;` with a one-line comment.
  - After the POST route:
```ts
  app.get<{ Params: { plugin: string }; Querystring: { id?: string } }>('/mods/:plugin/decision', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const plugin = req.params.plugin;
    if (!KNOWN_MODS.has(plugin)) {
      await reply.code(404).send({ error: 'unknown mod' });
      return;
    }
    const instanceId = String(req.headers['x-watchtower-instance'] ?? '');
    if (!instanceId) {
      await reply.code(400).send({ error: 'missing X-Watchtower-Instance header' });
      return;
    }
    const decision = opts.onModDecision ? await opts.onModDecision(plugin, String(req.query.id ?? ''), instanceId) : undefined;
    if (decision === undefined) {
      await reply.code(404).send({ error: 'unknown hold' });
      return;
    }
    await reply.code(200).send({ decision });
  });
```
  Match the POST route's exact style (inline checks, `await reply…; return;`).
  - `bootstrap.ts`: add `onModDecision` to its options type next to `onModState` and pass it to `startHookListener`.

- [ ] **Step 4: Verify** — `tests/orchestrator/hookListener.test.ts` PASS (all old tests too), typecheck:ci clean.
- [ ] **Step 5: Commit** `feat(blast-radius): authenticated decision route on the hook listener`.

### Task 4: Wire the store, IPC and the renderer hook

**Files:**
- Modify: `packages/shared/src/ipcContract.ts`, `packages/shared/src/messagePort.ts` (next to the `fileTreeActivity` lines)
- Modify: `orchestrator/index.ts` (store construction near `fileTreeActivity` ~:239-243; `disposeInstanceRow` ~:778; IPC switch ~:1596; `onModState` ~:1993; bootstrap options for `onModDecision`; a sweep interval)
- Modify: `apps/desktop/src/state/ipc.ts` (`SILENT_KINDS`)
- Create: `apps/desktop/src/state/useBlastRadius.ts`
- Test: `tests/client/useBlastRadius.test.tsx`

**Interfaces:**
- IPC: `blastRadius:get` `{ instanceId }` → `BlastRadiusState | null`; `blastRadius:decide` `{ instanceId, holdId, decision: BlastDecision }` → `{ ok: boolean }`; push `blastRadius` `BlastRadiusState`.
- Hook: `useBlastRadius(instanceId: string): { state: BlastRadiusState | null; decide(decision: BlastDecision): void }` — shows each outcome toast once via the module `toast` bridge (`toast.showInfo` / `toast.showWarning` from `apps/desktop/src/state/useToast.tsx`), never for an outcome already present in the first `blastRadius:get` answer.

- [ ] **Step 1: IPC kinds** — add the request/response/push lines in both `ipcContract.ts` and `messagePort.ts` (request lines in `messagePort.ts` carry `id: string;`), importing types from `./blastRadius.js` the way the `fileTreeActivity` lines import from `./fileTree.js`.

- [ ] **Step 2: Orchestrator wiring** (`orchestrator/index.ts`)
```ts
import { BlastRadiusStore } from './services/blastRadiusStore.js';

// blast-radius mod holds (plugins/blast-radius → POST /mods/blast-radius): a popup over the pane,
// flagged like a permission prompt until the mod collects the user's answer.
const blastRadius = new BlastRadiusStore({
  emit: (state) => emitPush({ kind: 'blastRadius', payload: state }),
  isKnownInstance: (instanceId) => !!handle && repo().get(instanceId) != null,
  hold: (instanceId) => {
    if (statusOf(instanceId) !== 'waiting-permission') applyTransition(instanceId, { kind: 'notificationHook' });
  },
  release: (instanceId) => {
    if (statusOf(instanceId) === 'waiting-permission') applyTransition(instanceId, { kind: 'userPromptSubmit' });
  },
});
setInterval(() => blastRadius.sweep(Date.now()), 60_000).unref();
```
  Check `statusOf`'s exact name/signature (~:693) and that `applyTransition` is declared before use (function declarations hoist; a `const` arrow would not — move the store construction below if needed). In `disposeInstanceRow` add `blastRadius.dispose(id);`. Switch cases:
```ts
    case 'blastRadius:get':
      return blastRadius.get(req.payload.instanceId, Date.now());

    case 'blastRadius:decide':
      return { ok: blastRadius.decide(req.payload.instanceId, req.payload.holdId, req.payload.decision, Date.now()) };
```
  `onModState`: `if (plugin === 'blast-radius') blastRadius.ingest(body, instanceId, Date.now());`. Bootstrap options: `onModDecision: (plugin, holdId, instanceId) => (plugin === 'blast-radius' ? blastRadius.decisionFor(instanceId, holdId, Date.now()) : undefined),`.

- [ ] **Step 3: SILENT_KINDS** — add `'blastRadius:get', // blast-radius hold fetch; a miss only means no popup`.

- [ ] **Step 4: Write the failing hook test** `tests/client/useBlastRadius.test.tsx`
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { BlastRadiusState } from '@watchtower/shared/blastRadius.js';

const ipc = vi.hoisted(() => ({ calls: [] as { kind: string; payload: unknown }[], initial: null as unknown }));
vi.mock('../../apps/desktop/src/state/ipc', () => ({
  invoke: vi.fn(async (kind: string, payload: unknown) => {
    ipc.calls.push({ kind, payload });
    return kind === 'blastRadius:get' ? ipc.initial : { ok: true };
  }),
}));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../../apps/desktop/src/state/useToast', () => ({
  toast: { showInfo: (m: string) => toasts.push(`info ${m}`), showWarning: (m: string) => toasts.push(`warning ${m}`), showError: () => {}, showSuccess: () => {} },
}));

import { useBlastRadius } from '../../apps/desktop/src/state/useBlastRadius';

let push: ((s: BlastRadiusState) => void) | undefined;
beforeEach(() => {
  ipc.calls.length = 0;
  toasts.length = 0;
  ipc.initial = null;
  (window as unknown as { watchtower: unknown }).watchtower = {
    on: (kind: string, cb: (s: BlastRadiusState) => void) => {
      if (kind === 'blastRadius') push = cb;
      return () => {};
    },
  };
});

const hold = { id: 'h1', command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 's', lines: [], more: 0, note: '', startedAt: 1 };
const st = (over: Partial<BlastRadiusState>): BlastRadiusState => ({ instanceId: 'i1', hold: null, decided: null, outcome: null, receivedAt: 1, ...over });

describe('useBlastRadius', () => {
  it('follows pushes for its instance and sends the answer for the pending hold', async () => {
    const { result } = renderHook(() => useBlastRadius('i1'));
    act(() => push?.(st({ hold })));
    expect(result.current.state?.hold?.id).toBe('h1');
    act(() => push?.(st({ instanceId: 'other', hold: null })));
    expect(result.current.state?.hold?.id).toBe('h1');
    act(() => result.current.decide('proceed'));
    expect(ipc.calls.at(-1)).toEqual({ kind: 'blastRadius:decide', payload: { instanceId: 'i1', holdId: 'h1', decision: 'proceed' } });
  });

  it('toasts each new outcome once, with its severity', () => {
    renderHook(() => useBlastRadius('i1'));
    act(() => push?.(st({ outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' } })));
    act(() => push?.(st({ outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' } })));
    act(() => push?.(st({ outcome: { id: 'h2', command: 'git clean -fd', decision: 'timeout' } })));
    expect(toasts).toEqual(['info Blast Radius: running `rm -rf dist`', "warning Blast Radius: didn't run `git clean -fd` (no answer within 10 minutes)"]);
  });

  it('never toasts an outcome that was already there when the pane loaded', async () => {
    ipc.initial = st({ outcome: { id: 'old', command: 'rm x', decision: 'cancel' } });
    const { result } = renderHook(() => useBlastRadius('i1'));
    await waitFor(() => expect(result.current.state?.outcome?.id).toBe('old'));
    act(() => push?.(st({ outcome: { id: 'old', command: 'rm x', decision: 'cancel' } })));
    expect(toasts).toEqual([]);
  });
});
```

- [ ] **Step 5: Implement** `apps/desktop/src/state/useBlastRadius.ts`
```ts
import { useEffect, useRef, useState } from 'react';
import { outcomeToast, type BlastDecision, type BlastRadiusState } from '@watchtower/shared/blastRadius.js';
import { invoke } from './ipc';
import { toast } from './useToast';

/** One pane's blast-radius hold: the popup's state, the answer, and a toast per outcome. */
export function useBlastRadius(instanceId: string): { state: BlastRadiusState | null; decide(decision: BlastDecision): void } {
  const [state, setState] = useState<BlastRadiusState | null>(null);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    setState(null);
    const toastOnce = (s: BlastRadiusState) => {
      const o = s.outcome;
      if (!o || shown.current.has(o.id)) return;
      shown.current.add(o.id);
      const t = outcomeToast(o);
      if (t.severity === 'warning') toast.showWarning(t.text);
      else toast.showInfo(t.text);
    };
    invoke('blastRadius:get', { instanceId })
      .then((s) => {
        if (!alive) return;
        // An outcome already there at load happened before this pane was watching: no toast.
        if (s?.outcome) shown.current.add(s.outcome.id);
        setState((prev) => prev ?? s);
      })
      .catch(() => {});
    const off = window.watchtower.on('blastRadius', (payload) => {
      if (payload.instanceId !== instanceId) return;
      toastOnce(payload);
      setState(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);

  const decide = (decision: BlastDecision) => {
    const holdId = state?.hold?.id;
    if (holdId) void invoke('blastRadius:decide', { instanceId, holdId, decision }).catch(() => {});
  };

  return { state, decide };
}
```
  Confirm the module `toast` bridge's import path/name in `apps/desktop/src/state/useToast.tsx` (`export const toast`).

- [ ] **Step 6: Verify** — `tests/client/useBlastRadius.test.tsx` PASS, typecheck:ci clean.
- [ ] **Step 7: Commit** `feat(blast-radius): store wiring, IPC and the renderer hook with outcome toasts`.

### Task 5: `BlastRadiusDialog` over the pane

**Files:**
- Create: `apps/desktop/src/components/instances/BlastRadiusDialog.tsx`
- Modify: `apps/desktop/src/components/instances/PaneCard.tsx`
- Test: `tests/client/instances/blastRadiusDialog.test.tsx`

**Interfaces:**
- Consumes: `useBlastRadius` (Task 4), `BlastHold`, `BlastDecision`.
- Produces: `BlastRadiusDialog(props: { hold: BlastHold; decided: BlastDecision | null; onDecide(d: BlastDecision): void })`.

- [ ] **Step 1: Write the failing tests**
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { BlastRadiusDialog } from '../../../apps/desktop/src/components/instances/BlastRadiusDialog';

const hold = { id: 'h1', command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 'delete 3 files (about 2 kB)', lines: ['dist/a.js', 'dist/b.js'], more: 1, note: 'Paths: dist', startedAt: 1 };
const renderIt = (decided: 'proceed' | 'cancel' | null = null) => {
  const onDecide = vi.fn();
  render(
    <ThemeProvider theme={darkTheme}>
      <BlastRadiusDialog hold={hold} decided={decided} onDecide={onDecide} />
    </ThemeProvider>,
  );
  return onDecide;
};

describe('BlastRadiusDialog', () => {
  it('shows the risk, command, summary, paths and note', () => {
    renderIt();
    expect(screen.getByRole('dialog', { name: /Blast Radius · rm -rf/ })).toBeInTheDocument();
    expect(screen.getByText('rm -rf dist')).toBeInTheDocument();
    expect(screen.getByText(/Would delete 3 files/)).toBeInTheDocument();
    expect(screen.getByText('dist/a.js')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    expect(screen.getByText('Paths: dist')).toBeInTheDocument();
  });

  it('Cancel has focus; Proceed, Cancel and Esc answer', () => {
    const onDecide = renderIt();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDecide.mock.calls.map((c) => c[0])).toEqual(['proceed', 'cancel', 'cancel']);
  });

  it('after answering it waits for Claude and stops taking answers', () => {
    const onDecide = renderIt('proceed');
    expect(screen.getByText('Waiting for Claude…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDecide).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** `BlastRadiusDialog.tsx`
```tsx
import { useEffect, useRef } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { BlastDecision, BlastHold } from '@watchtower/shared/blastRadius.js';

interface Props {
  hold: BlastHold;
  decided: BlastDecision | null;
  onDecide(decision: BlastDecision): void;
}

/** The blast-radius mod's hold, drawn over its pane: Claude waits until the user answers. */
export function BlastRadiusDialog({ hold, decided, onDecide }: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, [hold.id]);
  const title = `⚠ Blast Radius · ${hold.riskLabel}`;

  return (
    <Box sx={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: '12px' }}>
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !decided) {
            e.preventDefault();
            onDecide('cancel');
          }
        }}
        sx={{ width: 'min(560px, 92%)', maxHeight: '80%', overflowY: 'auto', p: 2, borderRadius: '12px', border: '1px solid #e0a43a', backgroundColor: 'background.paper', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
      >
        <Typography sx={{ fontWeight: 700, color: '#e0a43a', mb: 1 }}>{title}</Typography>
        <Typography component="pre" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0, mb: 1, fontWeight: 600 }}>
          {hold.command}
        </Typography>
        <Typography sx={{ color: '#e5534b', fontSize: 13, mb: 0.5 }}>{`Would ${hold.summary}`}</Typography>
        {hold.lines.map((l) => (
          <Typography key={l} sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: 'text.secondary' }}>
            {l}
          </Typography>
        ))}
        {hold.more > 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{`+${hold.more} more`}</Typography>}
        {hold.note && <Typography sx={{ fontSize: 12, fontStyle: 'italic', color: 'text.secondary', mt: 1 }}>{hold.note}</Typography>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>{decided ? 'Waiting for Claude…' : 'Claude is waiting on your answer'}</Typography>
          <Button variant="outlined" color="warning" disabled={!!decided} onClick={() => onDecide('proceed')}>
            Proceed
          </Button>
          <Button ref={cancelRef} variant="contained" disabled={!!decided} onClick={() => onDecide('cancel')}>
            Cancel
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
```
  The summary from the mod reads like "delete 3 files (about 2 kB)"; if the vendored mod's summaries already start with "Would", drop the prefix here and in the test (check `measure()` in Task 6's copy — Task 6 runs after this, so prefer: the mod sends the summary verbatim and this component adds "Would "; the test above pins that).

- [ ] **Step 4: Mount in `PaneCard.tsx`**
```tsx
import { BlastRadiusDialog } from './BlastRadiusDialog.js';
import { useBlastRadius } from '../../state/useBlastRadius.js';
// in the component:
  const blast = useBlastRadius(instanceId);
// last child of the outer Box (after the side panel / band):
      {blast.state?.hold && (
        <BlastRadiusDialog hold={blast.state.hold} decided={blast.state.decided} onDecide={blast.decide} />
      )}
```

- [ ] **Step 5: Verify, full suite, commit (end of Phase 1)** — dialog test PASS, `tests/client` PASS, typecheck:ci clean, full `npm test` only known env failures. Commit `feat(blast-radius): popup over the pane for held commands`.

### Task 6: Vendor and patch the blast-radius mod

**Files:**
- Create: `plugins/blast-radius/**` from `~/.claude/local-plugins/playground/claude-code-playground/claude-code/mods/blast-radius/` (read-only source) without `screenshots/`; add `LICENSE` copied from `~/.claude/local-plugins/playground/claude-code-playground/LICENSE`
- Modify: `plugins/blast-radius/hooks/blast-radius.mjs`, `plugins/blast-radius/.claude-plugin/plugin.json`, `plugins/blast-radius/README.md`
- Test: `plugins/blast-radius/tests/bridge.test.ts`

**Interfaces — Consumes:** POST `/mods/blast-radius` bodies `{ version: 1, hold: {...} }` and `{ version: 1, hold: null, outcome: { id, command, decision } }` (Task 1 shapes); GET `/mods/blast-radius/decision?id=` → 200 `{ decision }` / 404 (Task 3). Headers `authorization: Bearer <token>`, `x-watchtower-instance`.

- [ ] **Step 1: Copy and smoke-test the harness.** Copy the folder; add a trivial `tests/smoke.test.ts` (`import { test, expect } from 'claude-code/testing'; test('loads', async ($) => { expect(typeof $.session.start).toBe('function') })`) and run `claude plugin test <worktree>/plugins/blast-radius`. If the kit cannot load the `.mjs` hooks module, stop and report BLOCKED with the error. Delete the smoke test once the real tests exist.

- [ ] **Step 2: Write the failing bridge tests** `tests/bridge.test.ts`. Use the patterns from `plugins/filetree/tests/world.ts` and `plugins/savvy-progress/tests/bridge.test.ts` (`mock.env`, `mock.clock`, `on('fs.read')` for `/support/listener.json` → `{ port: 7531, token: 'tok' }`, `on('http.fetch')` routing by `e.url` and `e.init?.method`, `on('process.run')` returning `{ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }` so `measure()` takes its "could not measure" path, `on('ui.open')`, `on('ui.toast')`, `on('session.cwd', () => ({ value: '/repo' }))`, and a base `on('tool.call', …)` that records the call and returns `{ result: { stdout: '', stderr: '' } }`). Drive with `await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' } as never)`. Tests:
  1. Inside Watchtower (`WATCHTOWER_INSTANCE_ID`, `WATCHTOWER_SUPPORT_DIR=/support`), decision GET answers `{decision:null}` once then `{decision:'proceed'}`: the call reaches the base handler (not denied); POSTs are `[hold with id/command 'rm -rf dist', {hold:null, outcome:{decision:'proceed'}}]`; no `ui.open`; no `ui.toast`.
  2. Same but `{decision:'cancel'}`: the result is a `deny` containing "the user pressed Cancel"; the release POST carries `decision:'cancel'`.
  3. First GET answers 404, later ones `{decision:'proceed'}`: the hold is POSTed twice (re-post after 404) and the call runs.
  4. Every fetch throws (Watchtower unreachable) and the mock clock advances past 10 minutes inside `process.run('sleep')`: the result is a deny containing "no answer within 10 minutes" (advance the clock in the `process.run` stub when `e.argv[0] === 'sleep'`).
  5. Outside Watchtower (no env var): `ui.open` is called with `id: 'blast-radius'`, no `http.fetch` at all; pressing proceed is not reachable from the harness, so assert only the open and the absence of posts, then interrupt (or let the clock run out) to end the hold.

- [ ] **Step 3: Patch `hooks/blast-radius.mjs`** (keep `on(...)` / `$.noun.method(...)` calls literal — the host reads them from source, see the file header)
  Add after the constants:
```js
// Watchtower bridge. Inside a Watchtower terminal (WATCHTOWER_INSTANCE_ID set) the hold
// is shown as a popup by Watchtower: post it to the listener and poll for the answer.
let bridge; // undefined: not looked yet; null: no listener found

async function discoverBridge($) {
  const instanceId = await $.env.get("WATCHTOWER_INSTANCE_ID");
  if (!instanceId) return null;
  const home = (await $.env.get("HOME")) ?? "";
  const dir = (await $.env.get("WATCHTOWER_SUPPORT_DIR")) || `${home}/Library/Application Support/Watchtower`;
  try {
    const sidecar = JSON.parse(await $.fs.read(`${dir}/listener.json`));
    const port = Number(sidecar.port);
    const token = String(sidecar.token ?? "");
    if (!port || !token) return null;
    return { url: `http://127.0.0.1:${port}/mods/blast-radius`, token, instanceId };
  } catch {
    return null;
  }
}

const bridgeHeaders = (b) => ({ authorization: `Bearer ${b.token}`, "x-watchtower-instance": b.instanceId });

async function postToWatchtower($, payload) {
  if (!bridge) bridge = await discoverBridge($);
  const b = bridge;
  if (!b) return;
  try {
    const res = await $.http.fetch(b.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...bridgeHeaders(b) },
      body: JSON.stringify({ version: 1, ...payload }),
    });
    if (res.status === 401 || res.status === 404) bridge = undefined;
  } catch {
    bridge = undefined;
  }
}

// The user's answer from Watchtower, or null while there is none yet.
async function pollWatchtower($, hold) {
  if (!bridge) bridge = await discoverBridge($);
  const b = bridge;
  if (!b) return null;
  try {
    const res = await $.http.fetch(`${b.url}/decision?id=${encodeURIComponent(hold.id)}`, { headers: bridgeHeaders(b) });
    if (res.status === 404) {
      // Watchtower restarted (or never saw the hold): announce it again.
      await postToWatchtower($, { hold });
      return null;
    }
    if (res.status === 401) bridge = undefined;
    if (!res.ok) return null;
    const d = JSON.parse(res.text).decision;
    return d === "proceed" || d === "cancel" ? d : null;
  } catch {
    bridge = undefined;
    return null;
  }
}
```
  In the `tool.call` handler:
  - right after `held = mine;`: `const inWatchtower = Boolean(await $.env.get("WATCHTOWER_INSTANCE_ID")); let wire = null;`
  - replace the `$.ui.open(...)` + band fallback with:
```js
      if (inWatchtower) {
        mine.where = "watchtower";
        wire = {
          id: `${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}`,
          command: mine.command,
          riskLabel: risk.label,
          summary,
          lines: mine.report.lines,
          more: mine.report.more ?? 0,
          note: mine.report.note ?? "",
          startedAt: await $.clock.now(),
        };
        await postToWatchtower($, { hold: wire });
      } else {
        opened = await $.ui.open({ id: PANE_ID, title: "Blast Radius", focus: true, rows: paneRows(mine.report) });
        if (!opened.isPlaced) {
          mine.where = "band";
        }
      }
```
  (Check that `mine.report.lines` are strings; if they are objects, map them to their display text the same way `draw()` renders them.)
  - inside the wait loop, before the `sleep`: `if (wire) { const answer = await pollWatchtower($, wire); if (answer) { mine.decision = answer; break; } }`
  - in `finally`, after `decision = mine.decision;`: `if (wire) await postToWatchtower($, { hold: null, outcome: { id: wire.id, command: wire.command, decision: decision ?? "error" } });`
  - the proceed branch: `if (mine.where !== "watchtower") $.ui.toast("Blast Radius: running it");` (capture `const where = mine.where` before `held` is cleared if needed).
  - The band (`AbovePrompt`) and pane renderers already skip when `where` is not `"band"` / the pane isn't open; confirm.

- [ ] **Step 4: Manifest, README, LICENSE** — `plugin.json` version `0.1.0-watchtower.1`, description suffix " Watchtower fork: inside a Watchtower terminal the hold is a Watchtower popup." README top note (Watchtower fork of the Claude Code playground mod, Apache-2.0, vendored from `claude-code-playground/claude-code/mods/blast-radius`; changes: the bridge in `hooks/blast-radius.mjs`, `plugin.json`, new `tests/`, added `LICENSE`, `screenshots/` left out).

- [ ] **Step 5: Verify and commit** — `claude plugin test <worktree>/plugins/blast-radius` all pass. Commit `plugins/blast-radius` only: `feat(blast-radius): vendor the mod with a Watchtower popup bridge`.

---

## Phase 2 — Replay tab

### Task 7: Replay shapes, store, IPC and hook

**Files:**
- Create: `packages/shared/src/replay.ts`, `orchestrator/services/replayStore.ts`, `apps/desktop/src/state/useReplay.ts`
- Modify: `ipcContract.ts`, `messagePort.ts`, `orchestrator/index.ts` (construct next to `fileTreeActivity`, dispose, `replay:get` case, `onModState` line), `apps/desktop/src/state/ipc.ts` (`SILENT_KINDS` += `'replay:get', // replay-theater turn; a miss only means an empty tab`)
- Test: `tests/shared/replay.test.ts`, `tests/orchestrator/replayStore.test.ts`, `tests/client/useReplay.test.tsx`

**Interfaces — Produces:**
```ts
// packages/shared/src/replay.ts
export type ReplayLineKind = 'add' | 'del' | 'ctx' | 'gap';
export interface ReplayLine { kind: ReplayLineKind; text: string }
export interface ReplayStep { file: string; tool: string; note: string; added: number; deleted: number; lines: ReplayLine[] }
export interface ReplayTurn { at: number; steps: ReplayStep[] }
export interface ReplaySnapshot { turn: ReplayTurn | null; panelToggles: number; sentAt: number }
export interface ReplayState { instanceId: string; snapshot: ReplaySnapshot; receivedAt: number }
export function parseReplay(body: unknown): ReplaySnapshot | null; // v1; caps 50 steps / 200 lines / 500 chars
// orchestrator: class ReplayStore — same API as FileTreeActivityStore (constructor(emit, isKnownInstance), ingest, get, dispose)
// IPC: replay:get { instanceId } → ReplayState | null; push replay: ReplayState
// renderer: useReplay(instanceId): ReplayState | null
//           useUnseenSteps(turn: ReplayTurn | null | undefined, isShowing: boolean): number
```

- [ ] **Step 1: Failing tests**
`tests/shared/replay.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseReplay } from '@watchtower/shared/replay.js';

const step = { file: 'src/a.ts', tool: 'Edit', note: '', added: 1, deleted: 1, lines: [{ kind: 'del', text: 'old' }, { kind: 'add', text: 'new' }] };

describe('parseReplay', () => {
  it('accepts a v1 turn, a baseline with no turn, and drops junk lines', () => {
    expect(parseReplay({ version: 1, panelToggles: 2, sentAt: 9, turn: { at: 5, steps: [step] } })).toEqual({ panelToggles: 2, sentAt: 9, turn: { at: 5, steps: [step] } });
    expect(parseReplay({ version: 1, turn: null })).toEqual({ panelToggles: 0, sentAt: 0, turn: null });
    const s = parseReplay({ version: 1, turn: { at: 1, steps: [{ ...step, lines: [{ kind: 'weird', text: 'x' }, { kind: 'ctx', text: 7 }, { kind: 'ctx', text: 'ok' }] }] } });
    expect(s?.turn?.steps[0]?.lines).toEqual([{ kind: 'ctx', text: 'ok' }]);
    expect(parseReplay({ version: 2, turn: null })).toBeNull();
  });

  it('caps steps, lines per step and line length', () => {
    const big = { ...step, lines: Array.from({ length: 300 }, () => ({ kind: 'add', text: 'z'.repeat(900) })) };
    const s = parseReplay({ version: 1, turn: { at: 1, steps: Array.from({ length: 70 }, () => big) } });
    expect(s?.turn?.steps).toHaveLength(50);
    expect(s?.turn?.steps[0]?.lines).toHaveLength(200);
    expect(s?.turn?.steps[0]?.lines[0]?.text).toHaveLength(500);
  });
});
```
`tests/orchestrator/replayStore.test.ts`: copy `tests/orchestrator/fileTreeActivityStore.test.ts` with `ReplayStore`, body `{ version: 1, panelToggles: 1, sentAt: 900, turn: { at: 800, steps: [] } }`, asserting store/push/get/dispose and drops for unknown instance + `{ version: 9 }`.
`tests/client/useReplay.test.tsx`: copy the get/push test shape from `tests/client/useBlastRadius.test.tsx` for `useReplay` (initial get, push for own instance, other instance ignored) and add:
```tsx
import { useUnseenSteps } from '../../apps/desktop/src/state/useReplay';
it('counts an unseen turn until the tab shows it', () => {
  const t1 = { at: 1, steps: [step, step, step] };
  const { result, rerender } = renderHook(({ turn, showing }) => useUnseenSteps(turn, showing), { initialProps: { turn: t1 as ReplayTurn | null, showing: false } });
  expect(result.current).toBe(3);
  rerender({ turn: t1, showing: true });
  expect(result.current).toBe(0);
  rerender({ turn: t1, showing: false });
  expect(result.current).toBe(0);
  rerender({ turn: { at: 2, steps: [step] }, showing: false });
  expect(result.current).toBe(1);
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** `packages/shared/src/replay.ts` with the lenient-per-field parser pattern of `parseFileTreeActivity` (`isObj`, `num`, kinds filtered to the four values, text must be a string, then the caps via `.slice`); `ReplayStore` as a copy of `FileTreeActivityStore` using `parseReplay`; the IPC lines; index.ts wiring (`const replay = new ReplayStore((state) => emitPush({ kind: 'replay', payload: state }), (id) => !!handle && repo().get(id) != null);`, `replay.dispose(id)`, `case 'replay:get': return replay.get(req.payload.instanceId);`, `if (plugin === 'replay-theater') replay.ingest(body, instanceId, Date.now());`); `useReplay` as a copy of `useFileTreeActivity` for `replay:get` / `replay`; and:
```ts
/** Steps of a turn the user hasn't looked at yet; 0 once the Replay tab has shown it. */
export function useUnseenSteps(turn: ReplayTurn | null | undefined, isShowing: boolean): number {
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    if (isShowing && turn) setSeenAt(turn.at);
  }, [isShowing, turn?.at]);
  return turn && turn.at > seenAt && !isShowing ? turn.steps.length : 0;
}
```
- [ ] **Step 4: Verify** — the three test files PASS, typecheck:ci clean.
- [ ] **Step 5: Commit** `feat(replay): shapes, store, IPC and renderer hook for replay-theater turns`.

### Task 8: Replay tab in the side panel

**Files:**
- Create: `apps/desktop/src/components/instances/side/ReplayTab.tsx`
- Modify: `side/useSidePanel.ts` (`SideTab`, `sideTabsFor`, third `useToggleRise`), `side/SidePanel.tsx` (`SIDE_TAB_LABEL`, optional `counts` prop), `PaneCard.tsx`
- Test: `tests/client/instances/replayTab.test.tsx`, `tests/client/instances/sidePanel.test.tsx` (update)

**Interfaces:**
- `SideTab = 'agents' | 'files' | 'replay'`; `sideTabsFor(kind, cwd)` → Claude/chat: `['agents', 'files'?, 'replay']`, shell: `['files'?]` (order Agents | Files | Replay; `files` only with a cwd).
- `SidePanel` gains `counts?: Partial<Record<SideTab, number>>`; a tab label renders `Replay · 3` when the count is > 0.
- `ReplayTab(props: { turn: ReplayTurn | null })`.

- [ ] **Step 1: Failing tests**
Update `sideTabsFor` expectations in `sidePanel.test.tsx`:
```ts
    expect(sideTabsFor('claude', '/repo')).toEqual(['agents', 'files', 'replay']);
    expect(sideTabsFor('chat', '/repo')).toEqual(['agents', 'files', 'replay']);
    expect(sideTabsFor('shell', '/repo')).toEqual(['files']);
    expect(sideTabsFor('claude', '')).toEqual(['agents', 'replay']);
```
Add to the `SidePanel` describe: render with `tabs={['agents','files','replay']}` and `counts={{ replay: 3 }}` → `getByRole('tab', { name: 'Replay · 3' })`; with `counts={{ replay: 0 }}` → name `'Replay'`. Add to the `useSidePanel` describe: a `toggles.replay` rise opens Replay (with `available: ['agents','files','replay']`).
`tests/client/instances/replayTab.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { ReplayTab } from '../../../apps/desktop/src/components/instances/side/ReplayTab';
import type { ReplayTurn } from '@watchtower/shared/replay.js';

const step = (file: string) => ({ file, tool: 'Edit', note: 'replace all', added: 1, deleted: 1, lines: [{ kind: 'ctx' as const, text: 'keep' }, { kind: 'del' as const, text: 'old' }, { kind: 'add' as const, text: 'new' }, { kind: 'gap' as const, text: '' }] });
const turn = (at: number, n: number): ReplayTurn => ({ at, steps: Array.from({ length: n }, (_, i) => step(`src/f${i + 1}.ts`)) });
const renderIt = (t: ReplayTurn | null) =>
  render(<ThemeProvider theme={darkTheme}><ReplayTab turn={t} /></ThemeProvider>);

describe('ReplayTab', () => {
  it('shows an empty note before any edits', () => {
    renderIt(null);
    expect(screen.getByText('No edits in the last turn yet.')).toBeInTheDocument();
  });

  it('shows the current step: file, tool line, diff kinds', () => {
    renderIt(turn(1, 3));
    expect(screen.getByText('src/f1.ts')).toBeInTheDocument();
    expect(screen.getByText('Edit · replace all +1 −1')).toBeInTheDocument();
    expect(screen.getByText('new').closest('[data-kind]')).toHaveAttribute('data-kind', 'add');
    expect(screen.getByText('old').closest('[data-kind]')).toHaveAttribute('data-kind', 'del');
    expect(screen.getByText('⋯')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 1' })).toHaveAttribute('aria-current', 'step');
  });

  it('moves with Prev/Next, the chips and the arrow keys, clamped at the ends', () => {
    renderIt(turn(1, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('src/f2.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Step 3' }));
    fireEvent.keyDown(screen.getByTestId('replay'), { key: 'ArrowRight' });
    expect(screen.getByText('src/f3.ts')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('replay'), { key: 'ArrowLeft' });
    expect(screen.getByText('src/f2.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).not.toBeDisabled();
  });

  it('a new turn resets to step 1', () => {
    const { rerender } = renderIt(turn(1, 5));
    fireEvent.click(screen.getByRole('button', { name: 'Step 4' }));
    rerender(<ThemeProvider theme={darkTheme}><ReplayTab turn={turn(2, 2)} /></ThemeProvider>);
    expect(screen.getByText('src/f1.ts')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**
  - `useSidePanel.ts`: `export type SideTab = 'agents' | 'files' | 'replay';`, `sideTabsFor` returns `[...(claude ? ['agents'] : []), ...(cwd ? ['files'] : []), ...(claude ? ['replay'] : [])]` (update its one-line doc), add `useToggleRise(toggles.replay, () => toggle('replay'));`.
  - `SidePanel.tsx`: `SIDE_TAB_LABEL` gains `replay: 'Replay'`; prop `counts?: Partial<Record<SideTab, number>>`; label `{SIDE_TAB_LABEL[t]}{counts?.[t] ? ` · ${counts[t]}` : ''}`.
  - `ReplayTab.tsx`:
```tsx
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import type { ReplayLineKind, ReplayTurn } from '@watchtower/shared/replay.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LINE_STYLE: Record<ReplayLineKind, { color: string; sign: string }> = {
  add: { color: '#5fbf8f', sign: '+' },
  del: { color: '#e5534b', sign: '-' },
  ctx: { color: 'text.secondary', sign: ' ' },
  gap: { color: 'text.secondary', sign: '' },
};

/** The replay-theater mod's last turn: one edit at a time, as a diff. */
export function ReplayTab({ turn }: { turn: ReplayTurn | null }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [turn?.at]);
  if (!turn || turn.steps.length === 0) {
    return <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 1.5, py: 1 }}>No edits in the last turn yet.</Typography>;
  }
  const last = turn.steps.length - 1;
  const i = Math.min(index, last);
  const step = turn.steps[i]!;
  const go = (n: number) => setIndex(Math.max(0, Math.min(last, n)));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else return;
    e.preventDefault();
  };

  return (
    <Box data-testid="replay" tabIndex={0} onKeyDown={onKeyDown} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1, pb: 1, outline: 'none' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {turn.steps.map((_, n) => (
          <ButtonBase
            key={n}
            aria-label={`Step ${n + 1}`}
            aria-current={n === i ? 'step' : undefined}
            onClick={() => go(n)}
            sx={{ minWidth: 22, height: 22, px: 0.5, borderRadius: '6px', fontSize: 11.5, backgroundColor: n === i ? 'primary.main' : 'action.hover', color: n === i ? 'primary.contrastText' : 'text.secondary' }}
          >
            {n + 1}
          </ButtonBase>
        ))}
      </Box>
      <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>{step.file}</Typography>
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.5 }}>
        {`${step.tool}${step.note ? ` · ${step.note}` : ''} +${step.added} −${step.deleted}`}
      </Typography>
      <Box sx={{ flex: 1, overflow: 'auto', fontFamily: MONO, fontSize: 12, borderRadius: '6px', backgroundColor: 'action.hover', p: 1 }}>
        {step.lines.map((l, n) => (
          <Box key={n} data-kind={l.kind} sx={{ color: LINE_STYLE[l.kind].color, whiteSpace: 'pre', opacity: l.kind === 'ctx' ? 0.7 : 1 }}>
            {l.kind === 'gap' ? '⋯' : `${LINE_STYLE[l.kind].sign} ${l.text}`}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Button size="small" disabled={i === 0} onClick={() => go(i - 1)}>Prev</Button>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', alignSelf: 'center' }}>{`${i + 1} of ${turn.steps.length}`}</Typography>
        <Button size="small" disabled={i === last} onClick={() => go(i + 1)}>Next</Button>
      </Box>
    </Box>
  );
}
```
  Note the diff-line text node: the test queries `getByText('new')`, so render the sign in a separate `<span>` if `getByText` can't match `"+ new"` — e.g. `<Box …><span>{sign} </span>{text}</Box>` and keep `data-kind` on the Box.
  - `PaneCard.tsx`: `const replay = useReplay(instanceId);`, toggles gain `replay: replay?.snapshot.panelToggles`, `const unseen = useUnseenSteps(replay?.snapshot.turn, side.isOpen && side.tab === 'replay');`, pass `counts={{ replay: unseen }}` to `SidePanel`, body `{side.tab === 'replay' && <ReplayTab turn={replay?.snapshot.turn ?? null} />}`.

- [ ] **Step 4: Verify** — the instances tests and `useReplay` tests PASS, typecheck:ci clean, full `npm test` only known env failures (end of the Watchtower side of Phase 2).
- [ ] **Step 5: Commit** `feat(replay): Replay tab in the pane side panel`.

### Task 9: Vendor and patch the replay-theater mod

**Files:**
- Create: `plugins/replay-theater/**` from `~/.claude/local-plugins/playground/claude-code-playground/claude-code/mods/replay-theater/` without `screenshots/`, plus the repo root `LICENSE`
- Modify: `hooks/replay-theater.mjs`, `.claude-plugin/plugin.json`, `README.md`
- Test: `plugins/replay-theater/tests/bridge.test.ts`

**Interfaces — Consumes:** POST `/mods/replay-theater` body `{ version: 1, panelToggles, turn: { at, steps: [{ file, tool, note, added, deleted, lines: [{ kind, text }] }] } | null, sentAt }` (Task 7 shapes; caps 50 / 200 / 500).

- [ ] **Step 1: Copy; smoke-test the harness** as in Task 6 Step 1.

- [ ] **Step 2: Failing tests** `tests/bridge.test.ts` (harness as in Task 6; check `index.d.ts` under `plugins/filetree/.claude-plugin/types/claude-code/` for the exact `$.turn.start` / `$.turn.complete` and `$.tool.call` shapes):
  1. Inside Watchtower: `session.start` POSTs a baseline `{ version: 1, panelToggles: 0, turn: null }`.
  2. A turn with one `Edit` (`file_path: '/repo/src/a.ts'`, `old_string: 'a'`, `new_string: 'b'`) → after `turn.complete` a POST carries `turn.steps[0]` `{ file: 'src/a.ts', tool: 'Edit', added: 1, deleted: 1 }` with lines including `{ kind: 'del', text: 'a' }` and `{ kind: 'add', text: 'b' }`; no `ui.open`; the `AbovePrompt` band renders nothing from this mod (mount it like filetree's `surfaces` tests do and assert no "Replay" text).
  3. `/replay` inside Watchtower returns text `Replay Theater: toggled in Watchtower.`, POSTs `panelToggles: 1` with the same turn, and calls no `ui.open`.
  4. 60 edits in one turn → the POSTed turn has 50 steps.
  5. Outside Watchtower: no `http.fetch`; `/replay` after a turn with edits calls `ui.open` with `id: 'replay-theater'`.

- [ ] **Step 3: Patch `hooks/replay-theater.mjs`** — add the same `bridge`/`discoverBridge`/`postToWatchtower` helpers as Task 6 (URL `/mods/replay-theater`) plus:
```js
let inWatchtower = false;
let panelToggles = 0;
let wireTurn = null;

const KIND = { "+": "add", "-": "del", " ": "ctx", "~": "gap" };
const toWire = (s) => {
  const { add, del } = countChanges(s.diff);
  return {
    file: s.file,
    tool: s.tool,
    note: s.note ?? "",
    added: add,
    deleted: del,
    lines: s.diff.slice(0, 200).map((l) => ({ kind: KIND[l.op] ?? "ctx", text: String(l.t ?? "").slice(0, 500) })),
  };
};
const publishReplay = ($) => postToWatchtower($, { panelToggles, turn: wireTurn, sentAt: Date.now() });
```
  (Use the engine clock instead of `Date.now()` if the file avoids `Date`; check `countChanges`' exact name/return.)
  - `session.start`: `inWatchtower = Boolean(await $.env.get("WATCHTOWER_INSTANCE_ID")); if (inWatchtower) await publishReplay($);`
  - `turn.complete`, after `state.replay = state.pending; …`: `if (inWatchtower) { wireTurn = { at: await $.clock.now(), steps: state.replay.slice(0, 50).map(toWire) }; await publishReplay($); }`
  - `command.run` `replay`: at the top, `if (inWatchtower) { panelToggles++; await publishReplay($); return { text: "Replay Theater: toggled in Watchtower." }; }`
  - `ui.render` `AbovePrompt`: at the top, `if (inWatchtower) return next(e);`
  - Manifest version `0.1.0-watchtower.1` + description suffix; README fork note (same list as Task 6); `LICENSE`.

- [ ] **Step 4: Verify and commit** — `claude plugin test <worktree>/plugins/replay-theater` all pass; commit `plugins/replay-theater` only: `feat(replay): vendor replay-theater with a Watchtower bridge`.

---

## Phase 3 — Install and docs

### Task 10: Install switch, CLAUDE.md, verification

**Files:** `CLAUDE.md` (worktree); `~/.claude/settings.json` (user config — the controller does this step with the user's explicit OK, not a subagent).

- [ ] **Step 1 (controller, with the user's OK):** back up `~/.claude/settings.json` (`settings.json.bak.<YYYYMMDD-HHMMSS>`), set `blast-radius@claude-code-playground-mods` and `replay-theater@claude-code-playground-mods` to `false`, append `:<worktree>/plugins/blast-radius:<worktree>/plugins/replay-theater` to `CLAUDE_CODE_PLUGIN_DIRS`; verify with `claude plugin list` (all four forks `@inline ✔ loaded`, upstreams disabled) and that `statusLine.command` still wraps `watchtower-statusline.mjs`.
- [ ] **Step 2:** extend the CLAUDE.md side-panel section: the Replay tab (`replayStore`, `replay:get`, push `replay`), the blast-radius popup (`blastRadiusStore`, `blastRadius:get|decide`, push `blastRadius`, `GET /mods/blast-radius/decision`, attention via `notificationHook`/`userPromptSubmit` and the re-assert on poll), outcome toasts, and "change together" rules for each mod body and its shared parser (`packages/shared/src/blastRadius.ts`, `replay.ts`). Update the install line to list all four absolute plugin paths.
- [ ] **Step 3:** run full `npm test`, `typecheck:ci`, and `claude plugin test` for all four plugins.
- [ ] **Step 4:** commit `CLAUDE.md`: `docs: blast-radius popup and Replay tab`.
- [ ] **Step 5:** live review in the dev app with the user (renderer on 5174 if 5173 is taken: `npx vite --config apps/desktop/vite.config.ts --port 5174` + `WATCHTOWER_DEV_URL=http://localhost:5174 … electron .`). Ask Claude in a new instance to `rm -rf` a throwaway folder → popup, ⚠, toast; make an edit → "Replay · N", step through it.
