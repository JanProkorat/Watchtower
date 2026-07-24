# One-Click Meeting Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Sync meetings" (TaskGrid) and "Refresh" (Teams popover) buttons *do the work* on click by driving a short-lived hidden Claude instance that runs the existing slash command, instead of copying a command to the clipboard.

**Architecture:** A new `meetingDriver` orchestrator service spawns a hidden ("background") interactive `claude` instance in the Watchtower repo with a scoped `--allowedTools` allowlist, injects `/sync-meetings …` or `/teams-refresh …` into its pty, waits for a deterministic result file the writer scripts emit, refreshes the UI, and tears the instance down. Two new IPC kinds (`meetings:sync`, `teams:refresh`) round-trip renderer → main → orchestrator.

**Tech Stack:** TypeScript, Node `utilityProcess` orchestrator, node-pty, node:sqlite/better-sqlite3, React + MUI v5, vitest.

## Global Constraints

- UI text is **English**; date/number formatting stays `cs-CZ`. Do NOT add i18n.
- Never edit `.env*`, `appsettings.*.json`, `secrets.json`, `*.pfx`, `*.key`.
- Renderer never touches SQLite directly — all data via the IPC contract.
- All renderer IPC goes through `invoke()` in `apps/desktop/src/state/ipc.ts` (never `window.watchtower.invoke` directly).
- Migrations current version is **v24**; the new migration is **v25**. Migration `ADD COLUMN` defaults MUST be constant literals (node:sqlite vs better-sqlite3 divergence).
- `npm test` must stay green (219+); run `npm run typecheck:ci` (raw `tsc` in a worktree gives false results — symlinked `@watchtower/*` resolves to the main tree; see memory `worktree-shared-resolution-false-green`).
- Hardcoded machine paths (consistent with the existing hardcoded `WATCHTOWER_DB_PATH`):
  - `MEETING_SYNC_CWD = '/Users/jan/Projects/Watchtower'`
  - `WATCHTOWER_DB_PATH = '/Users/jan/Library/Application Support/Watchtower/data.db'`
  - `MEETING_RESULT_FILE = '/tmp/watchtower-meeting-result.json'`
- Permission spawn args (spike-validated — default mode + scoped allowlist, NO bypass mode):
  `['--allowedTools', 'mcp__claude_ai_Microsoft_365', 'Write', 'Bash']`

---

## Result-file contract (shared by Tasks 2, 3, 4)

Both writer scripts emit `MEETING_RESULT_FILE` as their final side effect, in this exact shape:

```json
{ "ok": true, "count": 2, "detail": "human-readable summary line" }
```
On error (script catch block): `{ "ok": false, "error": "message" }`.

`count` is `logged` for sync-meetings and `written` for teams-refresh. The driver reads this file verbatim and returns it as the IPC result.

---

### Task 1: `instances.background` column — hidden transient instances

**Files:**
- Modify: `packages/shared/src/stateModel.ts:30-44` (add `background` to `InstanceRow`)
- Modify: `orchestrator/db/migrations.ts:504` (append migration v25)
- Modify: `orchestrator/db/repositories/instances.ts` (DbInstanceRow, toRow, insert)
- Modify: `packages/shared/src/ipcContract.ts:5` and `packages/shared/src/messagePort.ts:5` (`background?` on `spawnInstance` payload)
- Modify: `orchestrator/index.ts:804-833` (spawnInstance handler — persist `background`), `:913-925` (listInstances filter), `:1633` (boot loop skip)
- Test: `tests/orchestrator/migrations.test.ts` (or the existing migration test file), `tests/orchestrator/instancesRepo.test.ts` (create if absent)

**Interfaces:**
- Produces: `InstanceRow.background: boolean`; `spawnInstance` payload accepts optional `background?: boolean`; `listInstances` never returns background rows.

- [ ] **Step 1: Write the failing migration test**

In the orchestrator migration test file (mirror the existing pattern — a `DatabaseSync` in-memory/temp db + `runMigrations`), add:

```ts
it('v25 adds instances.background defaulting to 0', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  const cols = (db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string; dflt_value: string | null }>);
  const bg = cols.find((c) => c.name === 'background');
  expect(bg).toBeDefined();
  expect(bg!.dflt_value).toBe('0');
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t 'background'`
Expected: FAIL — column `background` not found.

- [ ] **Step 3: Add migration v25**

In `orchestrator/db/migrations.ts`, append after the v24 object (before the closing `];` at line 505):

```ts
  {
    version: 25,
    up: (db) => {
      // Hidden, orchestrator-driven instances (e.g. the meeting-sync driver's
      // short-lived worker). Filtered out of listInstances so they never enter
      // the tab strip. Constant default 0 (node:sqlite vs better-sqlite3
      // ADD COLUMN divergence — see memory sqlite-add-column-engine-divergence).
      addColumnIfMissing(db, 'instances', 'background', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
```

- [ ] **Step 4: Run migration test, verify pass**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t 'background'`
Expected: PASS.

- [ ] **Step 5: Thread `background` through the type + repo**

In `packages/shared/src/stateModel.ts`, add to `InstanceRow` (after `taskId` line 43):

```ts
  taskId: number | null;
  background: boolean;
```

In `orchestrator/db/repositories/instances.ts`: add `background: number;` to `DbInstanceRow` (after `task_id`), add `background: r.background === 1,` to `toRow`'s return (after `taskId`), and update `insert` to include the column:

```ts
    this.db
      .prepare(
        `INSERT INTO instances (id, cwd, status, claude_session_id, spawned_at, last_activity_at, exit_code, termination_reason, resumed_from_instance_id, jira_key_hint, args_json, kind, display_order, background)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id, row.cwd, row.status, row.claudeSessionId, row.spawnedAt,
        row.lastActivityAt, row.exitCode, row.terminationReason,
        row.resumedFromInstanceId, row.jiraKeyHint, row.argsJson, row.kind,
        displayOrder, row.background ? 1 : 0,
      );
```

- [ ] **Step 6: Persist `background` in spawnInstance + filter it out of listInstances + boot**

In `orchestrator/index.ts` spawnInstance handler (`repo().insert({...})` at ~814), add `background: req.payload.background ?? false,` to the inserted object.

In the `listInstances` handler (`:914`), filter:

```ts
    case 'listInstances': {
      const rows = repo().listAll().filter((r) => !r.background);
```

In the boot loop (`:1633`, immediately inside `for (const row of allRows) {`), add before `planBootAction`:

```ts
    // Background rows are transient (meeting-sync workers). If one survived a
    // crash mid-job, it's stale — purge it rather than resume it.
    if (row.background) {
      disposeInstanceRow(row.id);
      continue;
    }
```

- [ ] **Step 7: Add `background?` to the IPC + messageport spawnInstance payloads**

`packages/shared/src/ipcContract.ts:5` and `packages/shared/src/messagePort.ts:5` — change the `spawnInstance` request payload to:

```ts
{ cwd: string; args?: string[]; instanceKind?: import('./stateModel.js').InstanceKind; background?: boolean }
```

- [ ] **Step 8: Write the listInstances-excludes-background test**

Add an orchestrator test (reuse the harness that builds a real orchestrator DB / `InstancesRepo`):

```ts
it('listInstances excludes background rows', () => {
  const repo = new InstancesRepo(db);
  const base = { cwd: '/x', status: 'idle-notify' as const, claudeSessionId: null, spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null, resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'claude' as const, taskId: null };
  repo.insert({ ...base, id: 'visible', background: false });
  repo.insert({ ...base, id: 'hidden', background: true });
  const ids = repo.listAll().filter((r) => !r.background).map((r) => r.id);
  expect(ids).toEqual(['visible']);
});
```

- [ ] **Step 9: Run full orchestrator suite + typecheck**

Run: `npx vitest run tests/orchestrator` then `npm run typecheck:ci`
Expected: PASS (fix every new `background`-required compile error the field introduces — any object literal building an `InstanceRow` now needs `background`).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(instances): add background column for hidden orchestrator-driven instances"
```

---

### Task 2: Writer scripts emit the deterministic result file

**Files:**
- Modify: `~/.claude/commands/log-meetings.mjs:256-265` (and the catch at `:267-272`)
- Modify: `/Users/jan/Projects/Watchtower/.claude/commands/write-meetings-cache.mjs:118-129`
- Test: `tests/commands/meetingResultFile.test.ts` (create)

> NOTE: `log-meetings.mjs` lives OUTSIDE the repo (user-global `~/.claude/commands/`). Edit it in place. `write-meetings-cache.mjs` is repo-scoped. Both are plain ESM Node scripts using `node:sqlite`.

**Interfaces:**
- Produces: `MEETING_RESULT_FILE` (`/tmp/watchtower-meeting-result.json`) containing `{ ok, count, detail } | { ok:false, error }`.

- [ ] **Step 1: Write the failing test**

Create `tests/commands/meetingResultFile.test.ts`. It builds a temp DB via `runMigrations`, seeds the `teams.meetings_today` path for the cache writer, spawns the script with `execFileSync('node', [script, input, dbPath])`, and asserts the result file:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../orchestrator/db/migrations.js';

const RESULT = '/tmp/watchtower-meeting-result.json';

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-mr-'));
  const dbPath = join(dir, 'data.db');
  const db = new DatabaseSync(dbPath);
  runMigrations(db);
  db.close();
  return dbPath;
}

it('write-meetings-cache emits {ok,count} result file', () => {
  if (existsSync(RESULT)) rmSync(RESULT);
  const dbPath = tmpDb();
  const input = join(mkdtempSync(join(tmpdir(), 'wt-in-')), 'm.json');
  writeFileSync(input, JSON.stringify({ meetings: [
    { id: 'a', subject: 'Standup', subtitle: '', startsAt: '2026-07-23T07:15:00Z', endsAt: '2026-07-23T07:30:00Z', joinUrl: null },
  ] }));
  const script = join(process.cwd(), '.claude/commands/write-meetings-cache.mjs');
  execFileSync('node', [script, input, dbPath]);
  const res = JSON.parse(readFileSync(RESULT, 'utf8'));
  expect(res.ok).toBe(true);
  expect(res.count).toBe(1);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/commands/meetingResultFile.test.ts`
Expected: FAIL — result file absent / no `count`.

- [ ] **Step 3: Emit the result file in `write-meetings-cache.mjs`**

Add near the top (after `const SETTINGS_KEY` line 26):

```js
import { writeFileSync } from 'node:fs';
const RESULT_FILE = '/tmp/watchtower-meeting-result.json';
```
(Merge the `writeFileSync` import into the existing `node:fs` import line 23 instead of a second import.)

At the end of `main()` (after the `console.log(...)` at line 118-121):

```js
  writeFileSync(
    RESULT_FILE,
    JSON.stringify({
      ok: true,
      count: meetings.length,
      detail: `${meetings.length} written${dropped > 0 ? `, ${dropped} dropped` : ''}`,
    }),
  );
```

In the catch block (line 126-128), before `process.exit(1)`:

```js
  try { writeFileSync(RESULT_FILE, JSON.stringify({ ok: false, error: err.message ?? String(err) })); } catch { /* best effort */ }
```

- [ ] **Step 4: Emit the result file in `log-meetings.mjs`**

Merge `writeFileSync` into the `node:fs` import (line 23) and add the `RESULT_FILE` const near the top. At the end of `main()` (after the `Summary` `console.log` at line 257-261, before `db.close()`):

```js
  writeFileSync(
    RESULT_FILE,
    JSON.stringify({
      ok: true,
      count: logged,
      detail: `${logged} logged, ${duplicate} duplicate, ${skipped} skipped, ${unresolved} unresolved`,
    }),
  );
```

In the catch (line 269-271), before `process.exit(1)`:

```js
  try { writeFileSync(RESULT_FILE, JSON.stringify({ ok: false, error: err.message ?? String(err) })); } catch { /* best effort */ }
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run tests/commands/meetingResultFile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(meetings): writer scripts emit deterministic result file"
```

---

### Task 3: `meetingDriver` service

**Files:**
- Create: `orchestrator/services/meetingDriver.ts`
- Test: `tests/orchestrator/meetingDriver.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks (pure logic + injected deps).
- Produces:
  ```ts
  export interface MeetingResult { ok: boolean; count?: number; detail?: string; error?: string }
  export interface MeetingJobSpec { key: string; command: string; startupTimeoutMs: number; jobTimeoutMs: number }
  export interface MeetingDriverDeps {
    spawn(cwd: string, extraArgs: string[]): string;
    getStatus(id: string): string | null;
    write(id: string, data: string): void;
    dispose(id: string): void;
    readResult(): MeetingResult | null;
    clearResult(): void;
    sleep(ms: number): Promise<void>;
    now(): number;
  }
  export const MEETING_SYNC_CWD: string;
  export const MEETING_ALLOWLIST_ARGS: string[];
  export class MeetingDriver { constructor(deps: MeetingDriverDeps); run(spec: MeetingJobSpec): Promise<MeetingResult> }
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/orchestrator/meetingDriver.test.ts`. A `makeDeps` helper drives a scripted status sequence (advanced by `sleep`) and a scripted result-file value:

```ts
import { MeetingDriver, type MeetingDriverDeps, type MeetingResult } from '../../orchestrator/services/meetingDriver.js';

function makeDeps(over: Partial<MeetingDriverDeps> & { statuses: string[]; result: MeetingResult | null; resultAfterTicks?: number }) {
  let tick = 0;
  const writes: string[] = [];
  let disposed = 0;
  const deps: MeetingDriverDeps = {
    spawn: () => 'inst-1',
    getStatus: () => over.statuses[Math.min(tick, over.statuses.length - 1)] ?? null,
    write: (_id, d) => { writes.push(d); },
    dispose: () => { disposed++; },
    readResult: () => (over.resultAfterTicks == null || tick >= over.resultAfterTicks ? over.result : null),
    clearResult: () => {},
    sleep: async () => { tick++; },
    now: () => tick * 100,
    ...over,
  };
  return { deps, writes: () => writes, disposed: () => disposed };
}

const spec = { key: 'teams', command: '/teams-refresh "db"', startupTimeoutMs: 10_000, jobTimeoutMs: 60_000 };

it('injects the command once working, returns the result file, and disposes', async () => {
  const h = makeDeps({ statuses: ['spawning', 'working', 'working'], result: { ok: true, count: 2 }, resultAfterTicks: 3 });
  const res = await new MeetingDriver(h.deps).run(spec);
  expect(res).toEqual({ ok: true, count: 2 });
  expect(h.writes()).toEqual(['/teams-refresh "db"\r']);
  expect(h.disposed()).toBe(1);
});

it('fails when the turn ends (waiting-input) with no result file', async () => {
  const h = makeDeps({ statuses: ['working', 'working', 'waiting-input'], result: null });
  const res = await new MeetingDriver(h.deps).run(spec);
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/without producing a result/i);
  expect(h.disposed()).toBe(1);
});

it('times out when nothing ever completes', async () => {
  const h = makeDeps({ statuses: ['working'], result: null });
  const res = await new MeetingDriver(h.deps).run({ ...spec, jobTimeoutMs: 500 });
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/timed out/i);
  expect(h.disposed()).toBe(1);
});

it('rejects a concurrent job of the same key', async () => {
  const driver = new MeetingDriver(makeDeps({ statuses: ['working'], result: null }).deps);
  const p1 = driver.run({ ...spec, jobTimeoutMs: 300 });
  const p2 = await driver.run(spec);
  expect(p2.ok).toBe(false);
  expect(p2.error).toMatch(/already running/i);
  await p1;
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/orchestrator/meetingDriver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `meetingDriver.ts`**

```ts
// Drives a short-lived hidden `claude` instance to run a meeting slash command
// (/sync-meetings or /teams-refresh) and reports a deterministic result. See
// docs/superpowers/specs/2026-07-23-one-click-meeting-sync-design.md.
//
// The M365 MCP only exists inside a Claude session, and headless `claude -p`
// hangs on MCP init in this environment — so we drive an INTERACTIVE managed
// instance (which loads the MCP fine, spike-validated) and inject the command.

export interface MeetingResult {
  ok: boolean;
  count?: number;
  detail?: string;
  error?: string;
}

export interface MeetingJobSpec {
  /** Single-flight key; a second run with the same key is rejected while in-flight. */
  key: string;
  /** The slash command to inject (without trailing CR). */
  command: string;
  /** Max wait for the session to reach 'working' before injecting anyway. */
  startupTimeoutMs: number;
  /** Max wait, post-inject, for a result. */
  jobTimeoutMs: number;
}

export interface MeetingDriverDeps {
  /** Spawn a hidden background claude instance; returns its id. */
  spawn(cwd: string, extraArgs: string[]): string;
  getStatus(id: string): string | null;
  write(id: string, data: string): void;
  dispose(id: string): void;
  /** Parse the result file; null if absent/unparseable. */
  readResult(): MeetingResult | null;
  clearResult(): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const MEETING_SYNC_CWD = '/Users/jan/Projects/Watchtower';
export const MEETING_ALLOWLIST_ARGS = ['--allowedTools', 'mcp__claude_ai_Microsoft_365', 'Write', 'Bash'];

const POLL_MS = 500;
const SETTLE_MS = 1500;
// Terminal / turn-complete statuses (from packages/shared/src/stateModel.ts).
const DONE_STATUSES = new Set(['waiting-input', 'idle-notify', 'finished', 'crashed']);
const EXITED_STATUSES = new Set(['finished', 'crashed']);

export class MeetingDriver {
  private inFlight = new Set<string>();
  constructor(private deps: MeetingDriverDeps) {}

  async run(spec: MeetingJobSpec): Promise<MeetingResult> {
    if (this.inFlight.has(spec.key)) {
      return { ok: false, error: 'A meeting sync is already running.' };
    }
    this.inFlight.add(spec.key);
    let id: string | null = null;
    try {
      this.deps.clearResult();
      id = this.deps.spawn(MEETING_SYNC_CWD, MEETING_ALLOWLIST_ARGS);

      // Phase 1 — wait for the session to come up, then inject. SessionStart
      // drives the row to 'working'; if it never leaves 'spawning' within the
      // startup budget we inject anyway (claude queues typed input until ready).
      const startAt = this.deps.now();
      while (this.deps.now() - startAt < spec.startupTimeoutMs) {
        const s = this.deps.getStatus(id);
        if (s == null) return { ok: false, error: 'The meeting session failed to start.' };
        if (EXITED_STATUSES.has(s)) return { ok: false, error: 'The meeting session exited during startup.' };
        if (s === 'working' || s === 'waiting-input' || s === 'idle-notify') break;
        await this.deps.sleep(POLL_MS);
      }
      await this.deps.sleep(SETTLE_MS);
      this.deps.write(id, spec.command + '\r');

      // Phase 2 — a result file appearing is success. A turn that ends with no
      // file (Stop → waiting-input, or process exit) is a failure. 'waiting-input'
      // cannot occur before our inject (no Stop hook fires without a turn), so
      // seeing it here reliably means the injected turn finished.
      const injectedAt = this.deps.now();
      while (this.deps.now() - injectedAt < spec.jobTimeoutMs) {
        const r = this.deps.readResult();
        if (r) return r;
        const s = this.deps.getStatus(id);
        if (s != null && DONE_STATUSES.has(s)) {
          const r2 = this.deps.readResult();
          return r2 ?? { ok: false, error: 'The meeting session finished without producing a result (possible Microsoft 365 authentication error).' };
        }
        await this.deps.sleep(POLL_MS);
      }
      return { ok: false, error: 'Meeting sync timed out — the Microsoft 365 MCP may not have initialized. Try again, or re-authenticate Microsoft 365.' };
    } finally {
      if (id) this.deps.dispose(id);
      this.inFlight.delete(spec.key);
    }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/orchestrator/meetingDriver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(meetings): add meetingDriver service"
```

---

### Task 4: Wire `meetings:sync` + `teams:refresh` IPC to the driver

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (request union ~line 92 area + response union ~line 773 area)
- Modify: `packages/shared/src/messagePort.ts` (OrchRequest + OrchResponse)
- Modify: `orchestrator/index.ts` (spawn-background helper, driver deps wiring, two handlers)
- Test: `tests/orchestrator/meetingHandlers.test.ts` (create) — command-string construction

**Interfaces:**
- Consumes: `MeetingDriver`, `MEETING_SYNC_CWD` (Task 3); `spawnPtyForInstance`, `disposeInstanceRow`, `pty`, `repo()` (existing in index.ts).
- Produces: IPC kinds `meetings:sync` (payload `{ from: string; to: string }`) and `teams:refresh` (payload `Record<string, never>`), both resolving `{ ok: boolean; count?: number; error?: string }`.

- [ ] **Step 1: Add the contract entries (request + response) in both files**

In `packages/shared/src/ipcContract.ts` request union (add near the `meetings:listToday` request, line ~92 area — search for `meetings:listToday`):

```ts
  | { kind: 'meetings:sync'; payload: { from: string; to: string } }
  | { kind: 'teams:refresh'; payload: Record<string, never> }
```

In its response union (near the `meetings:listToday` response ~line 773):

```ts
  | { kind: 'meetings:sync'; payload: { ok: boolean; count?: number; error?: string } }
  | { kind: 'teams:refresh'; payload: { ok: boolean; count?: number; error?: string } }
```

Mirror BOTH into `packages/shared/src/messagePort.ts` `OrchRequest` (with the `id: string;` prefix each entry uses) and `OrchResponse`.

- [ ] **Step 2: Write the failing handler test**

Create `tests/orchestrator/meetingHandlers.test.ts`. It asserts the command strings the handlers hand to a stubbed driver. Structure it so the handlers call a module-level `meetingDriver.run` you can spy on — export a small pure builder from index (or test the builder directly). Prefer extracting pure builders:

```ts
import { buildSyncCommand, buildTeamsCommand } from '../../orchestrator/services/meetingCommands.js';

it('builds the sync-meetings command with range + db path', () => {
  expect(buildSyncCommand('2026-07-01', '2026-07-23'))
    .toBe('/sync-meetings 2026-07-01 2026-07-23 "/Users/jan/Library/Application Support/Watchtower/data.db"');
});
it('builds the teams-refresh command with db path', () => {
  expect(buildTeamsCommand())
    .toBe('/teams-refresh "/Users/jan/Library/Application Support/Watchtower/data.db"');
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npx vitest run tests/orchestrator/meetingHandlers.test.ts`
Expected: FAIL — module `meetingCommands` not found.

- [ ] **Step 4: Add `meetingCommands.ts` (pure builders)**

Create `orchestrator/services/meetingCommands.ts`:

```ts
export const WATCHTOWER_DB_PATH = '/Users/jan/Library/Application Support/Watchtower/data.db';

export function buildSyncCommand(from: string, to: string): string {
  return `/sync-meetings ${from} ${to} "${WATCHTOWER_DB_PATH}"`;
}

export function buildTeamsCommand(): string {
  return `/teams-refresh "${WATCHTOWER_DB_PATH}"`;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run tests/orchestrator/meetingHandlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the spawn-background helper + driver wiring in `orchestrator/index.ts`**

Add imports near the other service imports:

```ts
import { MeetingDriver } from './services/meetingDriver.js';
import { buildSyncCommand, buildTeamsCommand } from './services/meetingCommands.js';
import { readFileSync, unlinkSync } from 'node:fs';
```
(Merge into existing `node:fs` import if present.)

Add a spawn-background helper next to `spawnPtyForInstance` (after `disposeInstanceRow`, ~line 708):

```ts
const MEETING_RESULT_FILE = '/tmp/watchtower-meeting-result.json';

/** Insert a hidden background claude row and spawn its pty. Returns the id. */
function spawnBackgroundInstance(cwd: string, extraArgs: string[]): string {
  const id = randomUUID();
  const now = Date.now();
  repo().insert({
    id, cwd, status: 'spawning', claudeSessionId: id, spawnedAt: now,
    lastActivityAt: now, exitCode: null, terminationReason: null,
    resumedFromInstanceId: null, jiraKeyHint: null,
    argsJson: JSON.stringify(extraArgs), kind: 'claude', taskId: null, background: true,
  });
  spawnPtyForInstance({ id, cwd, extraArgs, kind: 'claude' });
  return id;
}

const meetingDriver = new MeetingDriver({
  spawn: spawnBackgroundInstance,
  getStatus: (id) => repo().get(id)?.status ?? null,
  write: (id, data) => { pty.get(id)?.write(data); },
  dispose: disposeInstanceRow,
  readResult: () => {
    try { return JSON.parse(readFileSync(MEETING_RESULT_FILE, 'utf8')); }
    catch { return null; }
  },
  clearResult: () => { try { unlinkSync(MEETING_RESULT_FILE); } catch { /* absent */ } },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
});
```

- [ ] **Step 7: Add the two request handlers**

In `handleRequest`'s switch, after the `meetings:listToday` case (~line 935):

```ts
    case 'meetings:sync': {
      const r = await meetingDriver.run({
        key: 'meetings:sync',
        command: buildSyncCommand(req.payload.from, req.payload.to),
        startupTimeoutMs: 30_000,
        jobTimeoutMs: 300_000,
      });
      return { ok: r.ok, count: r.count, error: r.error };
    }

    case 'teams:refresh': {
      const r = await meetingDriver.run({
        key: 'teams:refresh',
        command: buildTeamsCommand(),
        startupTimeoutMs: 30_000,
        jobTimeoutMs: 180_000,
      });
      return { ok: r.ok, count: r.count, error: r.error };
    }
```

- [ ] **Step 8: Typecheck + full orchestrator suite**

Run: `npm run typecheck:ci` then `npx vitest run tests/orchestrator`
Expected: PASS. (New kinds are NOT electron-only — they pass through main→orch automatically; no `electron/ipc.ts` change.)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(meetings): meetings:sync + teams:refresh IPC wired to driver"
```

---

### Task 5: TaskGrid "Sync meetings" button runs the sync

**Files:**
- Modify: `apps/desktop/src/components/timetracker/TaskGridView.tsx:212-262` (state + submit), `:487-494` (button unchanged), `:631-680` (popover copy + submit button)
- Test: `tests/client/taskGridSyncMeetings.test.tsx` (create) OR extend an existing TaskGridView test

**Interfaces:**
- Consumes: `invoke('meetings:sync', { from, to })` → `{ ok, count?, error? }` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `tests/client/taskGridSyncMeetings.test.tsx`. Mock `invoke` and assert clicking the popover's submit calls `meetings:sync` with the formatted range and toasts on success. (Follow the render/mocks pattern in `tests/client/meetingsPopover.test.tsx`.)

```tsx
// Assert: opening the Sync-meetings popover and clicking the primary button
// invokes 'meetings:sync' with { from:'YYYY-MM-DD', to:'YYYY-MM-DD' } and shows
// a success toast with the returned count.
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/client/taskGridSyncMeetings.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Replace the clipboard submit with the IPC call**

In `TaskGridView.tsx`, add a pending state near the sync state (line ~221):

```ts
  const [syncMeetingsPending, setSyncMeetingsPending] = useState(false);
```

Replace `submitSyncMeetings` (lines 250-262) with:

```ts
  const submitSyncMeetings = async () => {
    if (!syncRangeValid || !syncMeetingsFrom || !syncMeetingsTo) return;
    setSyncMeetingsPending(true);
    try {
      const res = await invoke('meetings:sync', {
        from: syncMeetingsFrom.format('YYYY-MM-DD'),
        to: syncMeetingsTo.format('YYYY-MM-DD'),
      });
      if (res.ok) {
        setSyncMeetingsAnchor(null);
        showSuccess(`Logged ${res.count ?? 0} meeting${res.count === 1 ? '' : 's'} as worklogs.`);
        void grid.refresh();
      } else {
        showError(res.error ?? 'Meeting sync failed.');
      }
    } finally {
      setSyncMeetingsPending(false);
    }
  };
```
Add the `invoke` import if not present (`import { invoke } from '../../state/ipc';`). Confirm `grid.refresh` exists (the file already calls `grid.refresh()` at line 627).

- [ ] **Step 4: Update the popover copy + submit button**

Replace the caption (lines 645-649) with:

```tsx
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Clicking runs <code>/sync-meetings</code> in a background Claude
            session and logs the resulting worklogs — this can take up to a
            minute.
          </Typography>
```

Replace the primary button (lines 670-677) with a spinner-aware run button:

```tsx
            <Button
              variant="contained"
              startIcon={syncMeetingsPending ? <CircularProgress size={16} color="inherit" /> : <EventRepeatIcon />}
              disabled={!syncRangeValid || syncMeetingsPending}
              onClick={() => void submitSyncMeetings()}
            >
              {syncMeetingsPending ? 'Syncing…' : 'Sync'}
            </Button>
```
Add `import CircularProgress from '@mui/material/CircularProgress';` if missing. `EventRepeatIcon` is already imported (used by the toolbar button). The `ContentCopyIcon` import may now be unused — remove it if so (typecheck will flag).

- [ ] **Step 5: Run test + client typecheck**

Run: `npx vitest run tests/client/taskGridSyncMeetings.test.tsx` then `npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(meetings): Sync-meetings button runs the sync in-app"
```

---

### Task 6: Teams popover "Refresh" runs the refresh

**Files:**
- Modify: `apps/desktop/src/components/teams/TeamsPill.tsx:13-57,130` (drop clipboard, call IPC, pending state)
- Modify: `apps/desktop/src/components/teams/MeetingsPopover.tsx:10-35,58-73` (loading prop, empty-state copy)
- Test: `tests/client/meetingsPopover.test.tsx` (extend)

**Interfaces:**
- Consumes: `invoke('teams:refresh', {})` → `{ ok, count?, error? }` (Task 4); `refreshMeetings()` from `useTeams` (existing).

- [ ] **Step 1: Write the failing test**

Extend `tests/client/meetingsPopover.test.tsx`: assert `MeetingsPopover` shows a spinner + disabled Refresh button when `refreshing` is true, and that the empty-state no longer mentions pasting a command.

```tsx
it('disables Refresh and shows progress while refreshing', () => {
  render(<MeetingsPopover meetings={[]} syncedAt={null} inCall={false} refreshing onJoin={()=>{}} onReturnToCall={()=>{}} onRefresh={()=>{}} />);
  expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
});
it('empty state does not mention pasting a command', () => {
  render(<MeetingsPopover meetings={[]} syncedAt={null} inCall={false} onJoin={()=>{}} onReturnToCall={()=>{}} onRefresh={()=>{}} />);
  expect(screen.queryByText(/paste/i)).toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/client/meetingsPopover.test.tsx`
Expected: FAIL — `refreshing` prop unknown / "paste" text still present.

- [ ] **Step 3: Add `refreshing` to `MeetingsPopover` + update copy**

In `MeetingsPopover.tsx`, add to `MeetingsPopoverProps` (after `inCall: boolean;`):

```ts
  refreshing?: boolean;
```
Destructure it (line 26) with a default: `const { meetings, syncedAt, inCall, refreshing = false, onJoin, onReturnToCall, onRefresh } = props;`.

Replace the Refresh button (lines 32-34):

```tsx
        <Button size="small" onClick={onRefresh} disabled={refreshing}
          startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : undefined}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
```
Add `import CircularProgress from '@mui/material/CircularProgress';`.

Replace the `syncedAt == null` empty-state copy (lines 60-65) with:

```tsx
            <>
              No meetings cached.
              <br />
              Click Refresh to load today’s meetings.
            </>
```

- [ ] **Step 4: Make `TeamsPill` run the refresh**

In `TeamsPill.tsx`, add pending state (after line 28): `const [refreshing, setRefreshing] = useState(false);`.

Replace `handleRefresh` (lines 49-57):

```ts
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await invoke('teams:refresh', {});
      if (res.ok) {
        await refreshMeetings();
        showSuccess(`Refreshed — ${res.count ?? 0} meeting${res.count === 1 ? '' : 's'} today.`);
      } else {
        showError(res.error ?? 'Teams refresh failed.');
      }
    } finally {
      setRefreshing(false);
    }
  };
```
Add `import { invoke } from '../../state/ipc';`. The `WATCHTOWER_DB_PATH` const (line 15) is now unused — remove it (typecheck will flag). Pass `refreshing` to the popover (line 130 area): add `refreshing={refreshing}` to the `<MeetingsPopover ... />` props.

- [ ] **Step 5: Run tests + client typecheck**

Run: `npx vitest run tests/client/meetingsPopover.test.tsx` then `npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(meetings): Teams Refresh button runs the refresh in-app"
```

---

### Task 7: Full verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green, count ≥ prior baseline (219+), including the new tests.

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck:ci`
Expected: no errors introduced by this branch.

- [ ] **Step 3: Live smoke (manual, user-run)**

Because the driver spawns a real `claude` (MCP-gated), a headless test can't cover the end-to-end path. Hand the user a smoke checklist:
- Build + launch the dev app from the worktree (`npm run electron:rebuild` first — better-sqlite3 ABI; see memory `worktree-electron-native-rebuild`), isolate WS (`WATCHTOWER_WS_HOST=127.0.0.1 WATCHTOWER_WS_PORT=7455`).
- Click Teams → Refresh: expect a spinner, then today's meetings + a success toast; no tab flashes in the strip.
- TaskGrid → Sync meetings → pick a range → Sync: expect a spinner, then a "Logged N meetings" toast and the grid repopulating.

- [ ] **Step 4: Final commit if any fixups**

```bash
git add -A && git commit -m "chore(meetings): verification fixups"
```

---

## Self-review notes

- **Spec coverage:** permissions (Task 3/4 allowlist), completion detection (Task 3 result-file + Stop-idle), background column (Task 1), writer result files (Task 2), IPC kinds (Task 4), UI swaps (Tasks 5–6), tests (each task) — all covered.
- **Version correction:** migration is **v25** (repo is at v24), not the spec's "v6" (which reflected CLAUDE.md's stale "v5"). Spec updated separately.
- **Type consistency:** `MeetingResult { ok, count?, detail?, error? }` is used identically across the driver, handlers, and the result-file contract. `background: boolean` on `InstanceRow` maps to `0/1` in the DB via `insert`/`toRow`.
- **No electron/ipc.ts change:** `meetings:sync`/`teams:refresh` are not electron-only; they pass through by default.
