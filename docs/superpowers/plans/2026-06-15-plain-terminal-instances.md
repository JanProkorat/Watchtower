# Plain Terminal Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Watchtower open a plain interactive login shell ("terminal") as a first-class instance alongside Claude sessions, sharing the existing tab/pane/persistence machinery.

**Architecture:** Add a `kind` discriminator (`'claude' | 'shell'`) to the `instances` table. Shells reuse `ptyManager`, `TerminalPool`, `Terminal.tsx`, the tab strip, and the pane workspace. The only new behavior: spawn `$SHELL` instead of `claude` (and omit `WATCHTOWER_INSTANCE_ID`), start live (no hook handshake), opt out of all hook-driven logic (quiet timer, Slack, session-id boot validation), and auto-close on a clean exit. Pure decision logic lives in a new testable `orchestrator/shellPolicy.ts`; the rest is wiring verified by typecheck.

**Tech Stack:** TypeScript, Node `utilityProcess` orchestrator, node-pty, node:sqlite (tests) / better-sqlite (runtime), React + MUI v5 + xterm.js renderer, vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-plain-terminal-instances-design.md`

---

## File Structure

**New files:**
- `orchestrator/shellPolicy.ts` — pure decision logic: `InstanceKind`, `buildPtySpawnConfig()`, `planBootAction()`.
- `tests/orchestrator/shellPolicy.test.ts` — unit tests for the above.

**Modified — orchestrator / shared:**
- `orchestrator/db/migrations.ts` — v11 migration adding the `kind` column.
- `orchestrator/db/schema.sql` — `kind` column on the `CREATE TABLE instances` (for fresh installs).
- `orchestrator/db/repositories/instances.ts` — `DbInstanceRow`, `toRow`, `insert` carry `kind`.
- `shared/stateModel.ts` — `InstanceKind` re-export + `kind` on `InstanceRow`.
- `shared/ipcContract.ts` — `spawnInstance` payload `kind?`; `listInstances` response item `kind`.
- `shared/messagePort.ts` — mirror `spawnInstance` payload `kind?`.
- `orchestrator/index.ts` — `PtySpawnArgs.kind`, `spawnPtyForInstance` uses `buildPtySpawnConfig`, shell exit handling, `disposeInstanceRow` helper, `spawnInstance` handler persists `kind` (+ shells start `'working'`), boot loop uses `planBootAction`, shell guards on hook/slack/quiet fan-out, new `restartInstance` request, `listInstances` returns `kind`.

**Modified — renderer:**
- `client/src/state/useInstances.ts` — `InstanceView.kind`, `spawn(cwd, args?, kind?)`.
- `client/src/components/instances/SessionTabBar.tsx` — `SessionInfo.kind`, terminal icon + neutral dot for shells, restart affordance for crashed shells.
- `client/src/components/instances/LeafView.tsx` — thread `kind` into `sessionInfos` / `hiddenSessionInfos`; wire `onRestartColumn`.
- `client/src/components/NewInstanceModal.tsx` — Claude/Terminal kind toggle; `onSpawn(cwd, kind)`.
- `client/src/App.tsx` — `doSpawn(cwd, kind?)`, `spawnTerminalForCwd`, pass restart handler down.
- `client/src/components/timetracker/ProjectDetailPane.tsx` — "Open terminal" action.

---

## Task 1: v11 migration — `kind` column

**Files:**
- Modify: `orchestrator/db/migrations.ts` (MIGRATIONS array, after the `version: 10` entry)
- Modify: `orchestrator/db/schema.sql` (CREATE TABLE instances)
- Test: `tests/orchestrator/migrations.test.ts`

- [ ] **Step 1: Update the idempotency test + add a column test (failing)**

In `tests/orchestrator/migrations.test.ts`, change the existing `'is idempotent when run twice'` assertion from `toBe(10)` to `toBe(11)`:

```typescript
  it('is idempotent when run twice', () => {
    runMigrations(db as unknown as SqliteLike);
    runMigrations(db as unknown as SqliteLike);
    const version = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(11);
  });
```

Add a new test at the end of the `describe` block:

```typescript
  it('v11 adds the kind column to instances defaulting to claude', () => {
    runMigrations(db as unknown as SqliteLike);
    const cols = (
      db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string; dflt_value: string | null }>
    );
    const kind = cols.find((c) => c.name === 'kind');
    expect(kind).toBeTruthy();
    // Existing rows backfill to 'claude' via the column default.
    db.prepare(
      `INSERT INTO instances (id, cwd, status, spawned_at, last_activity_at)
       VALUES ('row1', '/tmp', 'working', 1, 1)`,
    ).run();
    const row = db.prepare(`SELECT kind FROM instances WHERE id='row1'`).get() as { kind: string };
    expect(row.kind).toBe('claude');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/migrations.test.ts`
Expected: FAIL — idempotency expects 11 (got 10), and `kind` column missing.

- [ ] **Step 3: Add the v11 migration entry**

In `orchestrator/db/migrations.ts`, add this object as the last element of the `MIGRATIONS` array (immediately after the `version: 10` entry, before the closing `];`):

```typescript
  {
    version: 11,
    up: (db) => {
      // Plain-terminal support: instances are now either a managed `claude`
      // session ('claude') or a plain interactive shell ('shell'). Existing
      // rows backfill to 'claude' via the default. See
      // docs/superpowers/specs/2026-06-15-plain-terminal-instances-design.md.
      db.exec(
        `ALTER TABLE instances ADD COLUMN kind TEXT NOT NULL DEFAULT 'claude'`,
      );
    },
  },
```

> Note: SQLite cannot add a `CHECK` constraint via `ALTER TABLE ADD COLUMN` retroactively, so the enum is enforced in code (the `InstanceKind` type + `buildPtySpawnConfig`/repo), not the DB. The `DEFAULT 'claude'` backfills every existing row.

- [ ] **Step 4: Add `kind` to schema.sql for fresh installs**

In `orchestrator/db/schema.sql`, edit the `CREATE TABLE instances` block to add the column after `args_json`:

```sql
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  claude_session_id TEXT,
  spawned_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  exit_code INTEGER,
  termination_reason TEXT,
  resumed_from_instance_id TEXT REFERENCES instances(id),
  jira_key_hint TEXT,
  args_json TEXT,
  kind TEXT NOT NULL DEFAULT 'claude'
);
```

> Fresh installs run migration v1 (loads schema.sql, giving them `kind` already) then v11 (the `ALTER` would error because the column exists). To keep v11 safe for both paths, make the migration tolerant — see Step 5.

- [ ] **Step 5: Make v11 tolerant of the column already existing**

Update the v11 `up` from Step 3 to guard against the column being present (fresh installs get it from schema.sql):

```typescript
  {
    version: 11,
    up: (db) => {
      const cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === 'kind')) return; // fresh install already has it
      db.exec(`ALTER TABLE instances ADD COLUMN kind TEXT NOT NULL DEFAULT 'claude'`);
    },
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/migrations.test.ts`
Expected: PASS — all migration tests green, version is 11, `kind` defaults to `'claude'`.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/schema.sql tests/orchestrator/migrations.test.ts
git commit -m "feat(instances): add kind column (v11 migration) for plain terminals"
```

---

## Task 2: Thread `kind` through the repository and row types

**Files:**
- Modify: `shared/stateModel.ts:28-40` (InstanceRow)
- Modify: `orchestrator/db/repositories/instances.ts` (DbInstanceRow, toRow, insert)
- Test: `tests/orchestrator/instancesRepo.test.ts` (new)

- [ ] **Step 1: Write the failing repo round-trip test**

Create `tests/orchestrator/instancesRepo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import type { InstanceRow } from '../../shared/stateModel.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function baseRow(over: Partial<InstanceRow>): InstanceRow {
  return {
    id: 'i1',
    cwd: '/tmp/proj',
    status: 'working',
    claudeSessionId: null,
    spawnedAt: 1,
    lastActivityAt: 1,
    exitCode: null,
    terminationReason: null,
    resumedFromInstanceId: null,
    jiraKeyHint: null,
    argsJson: null,
    kind: 'claude',
    ...over,
  };
}

describe('InstancesRepo kind', () => {
  let repo: InstancesRepo;
  beforeEach(() => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    const db = new DatabaseSync(dbPath);
    runMigrations(db as unknown as SqliteLike);
    repo = new InstancesRepo(db as unknown as SqliteLike);
  });

  it('round-trips a shell instance kind', () => {
    repo.insert(baseRow({ id: 'sh1', kind: 'shell' }));
    expect(repo.get('sh1')?.kind).toBe('shell');
  });

  it('round-trips a claude instance kind', () => {
    repo.insert(baseRow({ id: 'cl1', kind: 'claude' }));
    expect(repo.get('cl1')?.kind).toBe('claude');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/instancesRepo.test.ts`
Expected: FAIL — `InstanceRow` has no `kind` (type error) and/or `kind` is `undefined` on read.

- [ ] **Step 3: Add `kind` to `InstanceRow` and `InstanceKind`**

In `shared/stateModel.ts`, add the type and field. Add after the `TerminationReason` union (line 26):

```typescript
export type InstanceKind = 'claude' | 'shell';
```

Add `kind` to the `InstanceRow` interface (after `argsJson`):

```typescript
export interface InstanceRow {
  id: string;
  cwd: string;
  status: InstanceStatus;
  claudeSessionId: string | null;
  spawnedAt: number;
  lastActivityAt: number;
  exitCode: number | null;
  terminationReason: TerminationReason | null;
  resumedFromInstanceId: string | null;
  jiraKeyHint: string | null;
  argsJson: string | null;
  kind: InstanceKind;
}
```

- [ ] **Step 4: Add `kind` to `DbInstanceRow`, `toRow`, and `insert`**

In `orchestrator/db/repositories/instances.ts`:

Add `kind` to the `DbInstanceRow` type (after `args_json`):

```typescript
  args_json: string | null;
  kind: InstanceKind;
```

Add the import for `InstanceKind` to the existing `shared/stateModel.js` import line, then map it in `toRow` (after `argsJson`):

```typescript
    argsJson: r.args_json,
    kind: r.kind,
  };
}
```

In `insert`, add `kind` to the column list, the `VALUES` placeholders, and the bound params:

```typescript
    this.db
      .prepare(
        `INSERT INTO instances (id, cwd, status, claude_session_id, spawned_at, last_activity_at, exit_code, termination_reason, resumed_from_instance_id, jira_key_hint, args_json, kind, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.cwd,
        row.status,
        row.claudeSessionId,
        row.spawnedAt,
        row.lastActivityAt,
        row.exitCode,
        row.terminationReason,
        row.resumedFromInstanceId,
        row.jiraKeyHint,
        row.argsJson,
        row.kind,
        displayOrder,
      );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/instancesRepo.test.ts`
Expected: PASS — both kinds round-trip.

- [ ] **Step 6: Verify the full suite + orchestrator typecheck still pass**

Run: `npm test`
Expected: PASS (all prior tests + the 2 new ones).

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: No new errors (any `InstanceRow` literal in orchestrator now needs `kind` — fix the `spawnInstance` insert in Task 5; if tsc flags it here, leave the literal until Task 5 or add `kind: 'claude'` now).

> If tsc flags the `repo().insert({...})` call in `orchestrator/index.ts` (line ~466) for a missing `kind`, add `kind: 'claude',` to that literal now — Task 5 will refine it.

- [ ] **Step 7: Commit**

```bash
git add shared/stateModel.ts orchestrator/db/repositories/instances.ts tests/orchestrator/instancesRepo.test.ts
git commit -m "feat(instances): carry kind through InstanceRow + repository"
```

---

## Task 3: `shellPolicy.ts` — pure spawn-config and boot-action logic

**Files:**
- Create: `orchestrator/shellPolicy.ts`
- Test: `tests/orchestrator/shellPolicy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/orchestrator/shellPolicy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPtySpawnConfig, planBootAction } from '../../orchestrator/shellPolicy.js';
import type { InstanceRow } from '../../shared/stateModel.js';

describe('buildPtySpawnConfig', () => {
  it('claude: --session-id <id> and injects WATCHTOWER_INSTANCE_ID', () => {
    const c = buildPtySpawnConfig({ kind: 'claude', id: 'abc', extraArgs: [], env: { PATH: '/usr/bin' } });
    expect(c.command).toBe('claude');
    expect(c.args).toEqual(['--session-id', 'abc']);
    expect(c.env.WATCHTOWER_INSTANCE_ID).toBe('abc');
  });

  it('claude: --resume when resumeSessionId is present, keeps extraArgs', () => {
    const c = buildPtySpawnConfig({ kind: 'claude', id: 'abc', extraArgs: ['--foo'], resumeSessionId: 'sess9', env: {} });
    expect(c.args).toEqual(['--resume', 'sess9', '--foo']);
  });

  it('shell: uses $SHELL as a login shell and OMITS WATCHTOWER_INSTANCE_ID', () => {
    const c = buildPtySpawnConfig({
      kind: 'shell',
      id: 'sh1',
      extraArgs: [],
      env: { SHELL: '/bin/fish', WATCHTOWER_INSTANCE_ID: 'leaked' },
    });
    expect(c.command).toBe('/bin/fish');
    expect(c.args).toEqual(['-l']);
    expect('WATCHTOWER_INSTANCE_ID' in c.env).toBe(false);
  });

  it('shell: falls back to /bin/zsh when $SHELL is empty/unset', () => {
    expect(buildPtySpawnConfig({ kind: 'shell', id: 's', extraArgs: [], env: {} }).command).toBe('/bin/zsh');
    expect(buildPtySpawnConfig({ kind: 'shell', id: 's', extraArgs: [], env: { SHELL: '  ' } }).command).toBe('/bin/zsh');
  });
});

describe('planBootAction', () => {
  const row = (over: Partial<InstanceRow>): InstanceRow => ({
    id: 'i', cwd: '/tmp', status: 'working', claudeSessionId: 'sess', spawnedAt: 1,
    lastActivityAt: 1, exitCode: null, terminationReason: null, resumedFromInstanceId: null,
    jiraKeyHint: null, argsJson: null, kind: 'claude', ...over,
  });

  it('live shell → respawn-shell', () => {
    expect(planBootAction(row({ kind: 'shell', status: 'working' }))).toBe('respawn-shell');
  });
  it('crashed shell → leave (keep the restart button)', () => {
    expect(planBootAction(row({ kind: 'shell', status: 'crashed' }))).toBe('leave');
  });
  it('finished claude → leave', () => {
    expect(planBootAction(row({ status: 'finished' }))).toBe('leave');
  });
  it('user-killed claude → leave', () => {
    expect(planBootAction(row({ terminationReason: 'user-kill' }))).toBe('leave');
  });
  it('claude with no session id → crash', () => {
    expect(planBootAction(row({ claudeSessionId: null }))).toBe('crash');
  });
  it('claude with session id → resume', () => {
    expect(planBootAction(row({ claudeSessionId: 'sess' }))).toBe('resume');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/shellPolicy.test.ts`
Expected: FAIL — `orchestrator/shellPolicy.ts` does not exist.

- [ ] **Step 3: Implement `shellPolicy.ts`**

Create `orchestrator/shellPolicy.ts`:

```typescript
import type { InstanceKind, InstanceRow } from '../shared/stateModel.js';

export type { InstanceKind };

/** Fallback shell when $SHELL is unset/blank (macOS default). */
const SHELL_FALLBACK = '/bin/zsh';

export interface PtySpawnConfigInput {
  kind: InstanceKind;
  id: string;
  extraArgs: string[];
  /** Claude only: spawn via `claude --resume <id>` instead of `--session-id <id>`. */
  resumeSessionId?: string;
  /** Defaults to process.env; injectable for tests. */
  env?: Record<string, string | undefined>;
}

export interface PtySpawnConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Decide the command/args/env for a pty given the instance kind.
 *
 * Shells run `$SHELL -l` (interactive login) and deliberately DO NOT receive
 * WATCHTOWER_INSTANCE_ID — a shell posts no hooks, and a nested `claude` typed
 * into it must not inherit a managed id and clobber a row (the
 * nested-claude-hook-contamination hazard).
 */
export function buildPtySpawnConfig(input: PtySpawnConfigInput): PtySpawnConfig {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.env ?? process.env)) {
    if (typeof v === 'string') baseEnv[k] = v;
  }

  if (input.kind === 'shell') {
    const shell = baseEnv.SHELL && baseEnv.SHELL.trim() ? baseEnv.SHELL : SHELL_FALLBACK;
    delete baseEnv.WATCHTOWER_INSTANCE_ID; // never leak a managed id into a shell
    return { command: shell, args: ['-l'], env: baseEnv };
  }

  const args = input.resumeSessionId
    ? ['--resume', input.resumeSessionId, ...input.extraArgs]
    : ['--session-id', input.id, ...input.extraArgs];
  return { command: 'claude', args, env: { ...baseEnv, WATCHTOWER_INSTANCE_ID: input.id } };
}

export type BootAction = 'leave' | 'crash' | 'resume' | 'respawn-shell';

/**
 * Decide what to do with a persisted instance row when the orchestrator boots.
 *   - shell, was live      → respawn a FRESH shell (dead pty can't resume)
 *   - shell, crashed       → leave (keep the lingering crashed tab + restart button)
 *   - claude, finished     → leave (exited cleanly)
 *   - claude, user-killed  → leave
 *   - claude, no session   → crash (unrecoverable)
 *   - claude, has session  → resume via `claude --resume`
 */
export function planBootAction(
  row: Pick<InstanceRow, 'kind' | 'status' | 'terminationReason' | 'claudeSessionId'>,
): BootAction {
  if (row.kind === 'shell') return row.status === 'crashed' ? 'leave' : 'respawn-shell';
  if (row.status === 'finished') return 'leave';
  if (row.terminationReason === 'user-kill') return 'leave';
  if (!row.claudeSessionId) return 'crash';
  return 'resume';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/shellPolicy.test.ts`
Expected: PASS — all spawn-config and boot-action cases green.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/shellPolicy.ts tests/orchestrator/shellPolicy.test.ts
git commit -m "feat(instances): shellPolicy — spawn config + boot action logic"
```

---

## Task 4: IPC contract — `kind` on spawn + list

**Files:**
- Modify: `shared/ipcContract.ts:5` (spawnInstance request), `:482` region (listInstances response)
- Modify: `shared/messagePort.ts:5` (OrchRequest spawnInstance)

- [ ] **Step 1: Add `kind?` to the `spawnInstance` request (renderer contract)**

In `shared/ipcContract.ts`, change the `spawnInstance` request member:

```typescript
  | { kind: 'spawnInstance'; payload: { cwd: string; args?: string[]; instanceKind?: import('./stateModel.js').InstanceKind } }
```

> Field named `instanceKind` (not `kind`) to avoid shadowing the union's own discriminator `kind`.

- [ ] **Step 2: Add `kind` to the `listInstances` response item**

In `shared/ipcContract.ts`, find the `listInstances` response member and add `kind` to each instance item:

```typescript
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{
          id: string;
          cwd: string;
          status: string;
          lastActivityAt: number;
          kind: import('./stateModel.js').InstanceKind;
        }>;
      };
    }
```

> If the existing member is written inline on one line, expand it to this shape, preserving any fields already present.

- [ ] **Step 3: Add a `restartInstance` request/response (used by Task 7)**

In `shared/ipcContract.ts`, add a request member and matching response member:

```typescript
// request
  | { kind: 'restartInstance'; payload: { instanceId: string } }
// response
  | { kind: 'restartInstance'; payload: { ok: boolean } }
```

- [ ] **Step 4: Mirror into the orchestrator contract**

In `shared/messagePort.ts`, change the `spawnInstance` `OrchRequest` member and add `restartInstance`:

```typescript
  | { id: string; kind: 'spawnInstance'; payload: { cwd: string; args?: string[]; instanceKind?: import('./stateModel.js').InstanceKind } }
  | { id: string; kind: 'restartInstance'; payload: { instanceId: string } }
```

And add the `restartInstance` `OrchResponse` member (mirror of Step 3 response):

```typescript
  | { kind: 'restartInstance'; payload: { ok: boolean } }
```

- [ ] **Step 5: Verify both contracts typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: errors ONLY at the not-yet-updated handlers in `orchestrator/index.ts` (missing `restartInstance` case, `listInstances` not returning `kind`). These are fixed in Tasks 5–7. No errors in the `shared/` files themselves.

- [ ] **Step 6: Commit**

```bash
git add shared/ipcContract.ts shared/messagePort.ts
git commit -m "feat(ipc): spawnInstance.instanceKind, listInstances.kind, restartInstance"
```

---

## Task 5: Orchestrator spawn + exit handling for shells

**Files:**
- Modify: `orchestrator/index.ts` — `PtySpawnArgs` (386-392), `spawnPtyForInstance` (396-450), `spawnInstance` handler (457-492), `removeInstance` handler (508-526), `listInstances` (532-542)

- [ ] **Step 1: Import the policy helpers**

At the top of `orchestrator/index.ts`, add to the imports:

```typescript
import { buildPtySpawnConfig, planBootAction } from './shellPolicy.js';
import type { InstanceKind } from './shellPolicy.js';
```

- [ ] **Step 2: Add `kind` to `PtySpawnArgs` and rewrite the spawn body**

Replace `PtySpawnArgs` (lines 386-392) and the top of `spawnPtyForInstance`:

```typescript
interface PtySpawnArgs {
  id: string;
  cwd: string;
  extraArgs: string[];
  kind: InstanceKind;
  /** Claude only: spawn via `claude --resume <id>` instead of `--session-id <id>`. */
  resumeSessionId?: string;
}
```

In `spawnPtyForInstance`, replace the `cmdArgs`/`pty.spawn({...command/args/env...})` head (lines 397-406) with:

```typescript
  const cfg = buildPtySpawnConfig({
    kind: opts.kind,
    id: opts.id,
    extraArgs: opts.extraArgs,
    resumeSessionId: opts.resumeSessionId,
  });
  const spawnedAt = Date.now();
  pty.spawn({
    id: opts.id,
    command: cfg.command,
    args: cfg.args,
    cwd: opts.cwd,
    env: cfg.env,
    onData: (chunk) => {
      terminalSnapshots.feed(opts.id, chunk);
      api?.push({ kind: 'ptyData', payload: { instanceId: opts.id, chunk } });
      applyTransition(opts.id, { kind: 'ptyData' });
    },
```

- [ ] **Step 3: Branch the exit handler for shells**

In `spawnPtyForInstance`'s `onExit` (currently lines 412-448), the existing claude logic (resume fast-fail + `applyTransition({kind:'ptyExit'})`) stays. Add a shell branch at the very top of `onExit`, before the `opts.resumeSessionId && lifespan < RESUME_FAIL_FAST_MS` check:

```typescript
    onExit: (code) => {
      if (opts.kind === 'shell') {
        api?.push({ kind: 'ptyExit', payload: { instanceId: opts.id, code } });
        if (code === 0) {
          // Clean exit (user typed `exit`) → drop the row; the renderer's
          // deriveTabs prune removes the now-orphaned column automatically.
          disposeInstanceRow(opts.id);
        } else {
          const r = repo();
          if (r.get(opts.id)) {
            r.setTermination(opts.id, 'crash', code);
            r.updateStatus(opts.id, 'crashed', Date.now());
          }
        }
        api?.push({ kind: 'stateChanged', payload: { instanceId: opts.id, status: code === 0 ? 'finished' : 'crashed' } });
        return;
      }
      const lifespan = Date.now() - spawnedAt;
      // ... existing claude exit handling unchanged ...
```

> The extra `stateChanged` push guarantees `useInstances` refreshes even for the delete case (it listens to both `ptyExit` and `stateChanged`); harmless redundancy.

- [ ] **Step 4: Extract `disposeInstanceRow` and reuse it in `removeInstance`**

Add this helper near `spawnPtyForInstance` (top-level function in `orchestrator/index.ts`):

```typescript
/** Kill the pty (if any), delete the row + child rows, and clear Slack/timer state. */
function disposeInstanceRow(id: string): void {
  try {
    pty.get(id)?.kill();
  } catch {
    /* pty already dead */
  }
  new HookEventsRepo(handle!.db).deleteForInstance(id);
  new NotificationsRepo(handle!.db).deleteForInstance(id);
  repo().delete(id);
  forgetSlackThread(id);
  slackEscalator?.clear(id);
  terminalSnapshots.dispose(id);
}
```

Replace the body of the `removeInstance` case (lines 508-526) with a call to it:

```typescript
    case 'removeInstance': {
      disposeInstanceRow(req.payload.instanceId);
      return { ok: true };
    }
```

- [ ] **Step 5: Persist `kind` in the `spawnInstance` handler; shells start live**

In the `spawnInstance` case (lines 457-492), compute the kind and use it for both the inserted status and the pty spawn:

```typescript
    case 'spawnInstance': {
      const id = randomUUID();
      const now = Date.now();
      const instanceKind: InstanceKind = req.payload.instanceKind ?? 'claude';
      const expandedCwd = req.payload.cwd.startsWith('~/')
        ? path.join(homedir(), req.payload.cwd.slice(2))
        : req.payload.cwd === '~'
        ? homedir()
        : req.payload.cwd;
      try {
        repo().insert({
          id,
          cwd: expandedCwd,
          // Shells have no SessionStart handshake, so they start live ('working')
          // and never show the spinner. Claude starts 'spawning' until the hook.
          status: instanceKind === 'shell' ? 'working' : 'spawning',
          // Claude: --session-id <uuid> => session id matches row id. Shells: none.
          claudeSessionId: instanceKind === 'shell' ? null : id,
          spawnedAt: now,
          lastActivityAt: now,
          exitCode: null,
          terminationReason: null,
          resumedFromInstanceId: null,
          jiraKeyHint: null,
          argsJson: req.payload.args ? JSON.stringify(req.payload.args) : null,
          kind: instanceKind,
        });
        spawnPtyForInstance({ id, cwd: expandedCwd, extraArgs: req.payload.args ?? [], kind: instanceKind });
        return { instanceId: id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[orchestrator] spawnInstance failed:', message);
        try {
          repo().updateStatus(id, 'crashed', Date.now());
          repo().setTermination(id, 'crash', null);
        } catch {
          /* row may not have been inserted yet */
        }
        return { instanceId: null, error: message };
      }
    }
```

- [ ] **Step 6: Return `kind` from `listInstances`**

In the `listInstances` case (lines 532-542):

```typescript
    case 'listInstances': {
      const rows = repo().listAll();
      return {
        instances: rows.map((r) => ({
          id: r.id,
          cwd: r.cwd,
          status: r.status,
          lastActivityAt: r.lastActivityAt,
          kind: r.kind,
        })),
      };
    }
```

- [ ] **Step 7: Typecheck the orchestrator**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: errors remaining ONLY for the missing `restartInstance` case and the boot loop (Tasks 6–7). The `HookEventsRepo`/`NotificationsRepo` imports already exist (used by the old `removeInstance`); if tsc says they're now unused elsewhere, ignore — they're used in `disposeInstanceRow`.

- [ ] **Step 8: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(instances): spawn + exit handling for shell instances"
```

---

## Task 6: Boot respawn + hook/Slack/quiet guards

**Files:**
- Modify: `orchestrator/index.ts` — `respawnIncompleteRowsOnBoot` (928-990), the hook `onEvent` handler, `applyTransition` fan-out (340-365)

- [ ] **Step 1: Rewrite the boot loop using `planBootAction`**

Replace the per-row body inside the `for (const row of allRows)` loop in `respawnIncompleteRowsOnBoot` (lines ~948-986) with a switch on `planBootAction`:

```typescript
  for (const row of allRows) {
    const action = planBootAction(row);
    if (action === 'leave') continue;
    if (action === 'crash') {
      if (row.status !== 'crashed') {
        r.updateStatus(row.id, 'crashed', Date.now());
        r.setTermination(row.id, 'crash', null);
      }
      crashed++;
      continue;
    }
    if (action === 'respawn-shell') {
      try {
        r.updateStatus(row.id, 'working', Date.now());
        r.setTermination(row.id, null, null);
        terminalSnapshots.dispose(row.id); // stale scrollback from the dead pty
        spawnPtyForInstance({ id: row.id, cwd: row.cwd, extraArgs: [], kind: 'shell' });
        respawned++;
      } catch (err) {
        console.error('[orchestrator] shell respawn failed for', row.id, err);
        r.updateStatus(row.id, 'crashed', Date.now());
        r.setTermination(row.id, 'crash', null);
        crashed++;
      }
      continue;
    }
    // action === 'resume' (claude)
    try {
      r.updateStatus(row.id, 'spawning', Date.now());
      r.setTermination(row.id, null, null);
      const resumeSessionId = resolveResumeTarget(row) ?? undefined;
      spawnPtyForInstance({ id: row.id, cwd: row.cwd, extraArgs: [], kind: 'claude', resumeSessionId });
      respawned++;
    } catch (err) {
      console.error('[orchestrator] respawn failed for', row.id, err);
      r.updateStatus(row.id, 'crashed', Date.now());
      r.setTermination(row.id, 'resume-failed', null);
      crashed++;
    }
  }
```

> Preserve the surrounding `const r = repo(); const allRows = r.listAll(); let respawned = 0; let crashed = 0;` and the trailing summary `console.log`.

- [ ] **Step 2: Guard the hook handler against shell instances**

Find the `onEvent` callback passed to the hook listener (the function that receives `(event, body, instanceId)` and calls `applyTransition` / `mapHookEventToStateEvent`, near the cwd-gate logic around lines 1000-1009). Add an early bail for shell rows right after the row is fetched:

```typescript
    const row = repo().get(instanceId);
    if (!row) return;
    if (row.kind === 'shell') return; // shells post no hooks; ignore any that arrive
    // ... existing cwd-gate + mapHookEventToStateEvent logic ...
```

> If the handler doesn't already fetch the row, add the `repo().get(instanceId)` lookup; it's cheap and the cwd gate likely needs it anyway.

- [ ] **Step 3: Guard the quiet-timer / Slack fan-out in `applyTransition`**

In `applyTransition` (lines 340-365), the block that calls `slackEscalator.apply(...)` and the `startQuietTimer` output handling assume a managed claude instance. Wrap the notifier/Slack/quiet fan-out so it never fires for shells. At the point where `inst` is in scope (the function already reads `inst.cwd` at line 350), add near the top of the fan-out:

```typescript
  const isShell = inst.kind === 'shell';
  if (!isShell && slackEscalator) slackEscalator.apply(instanceId, inst.cwd, prevStatus, result.state);
  if (!isShell && (result.state === 'crashed' || result.state === 'finished')) forgetSlackThread(instanceId);
```

And in the `result.outputs` loop, guard the quiet-timer start (shells never produce these outputs in practice, but be defensive):

```typescript
    } else if (out.kind === 'startQuietTimer') {
      if (!isShell) quietTimers?.start(instanceId);
    } else if (out.kind === 'clearQuietTimer') {
      quietTimers?.clear(instanceId);
```

> `inst` must be the `InstanceRow` already fetched in `applyTransition`. If the function fetches it as `inst`, use `inst.kind`; confirm the variable name and adjust. Shells reaching `applyTransition` only via `{kind:'ptyData'}` (which has no Slack/quiet outputs), so this is belt-and-suspenders.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: only the missing `restartInstance` case remains (Task 7).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Existing `hookListener.test.ts` unaffected (the shell guard is in the orchestrator `onEvent`, not the listener).

- [ ] **Step 6: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(instances): boot respawn for shells + hook/slack/quiet guards"
```

---

## Task 7: `restartInstance` handler (crashed-shell restart)

**Files:**
- Modify: `orchestrator/index.ts` — add `restartInstance` case in `handleRequest`

- [ ] **Step 1: Add the handler**

In `handleRequest`'s switch, add (near `removeInstance`):

```typescript
    case 'restartInstance': {
      const row = repo().get(req.payload.instanceId);
      if (!row) return { ok: false };
      // Re-spawn a fresh process into the SAME row id. Shells re-run the login
      // shell; claude rows resume via the row's session id.
      terminalSnapshots.dispose(row.id);
      repo().updateStatus(row.id, row.kind === 'shell' ? 'working' : 'spawning', Date.now());
      repo().setTermination(row.id, null, null);
      spawnPtyForInstance({
        id: row.id,
        cwd: row.cwd,
        extraArgs: [],
        kind: row.kind,
        resumeSessionId: row.kind === 'claude' ? (resolveResumeTarget(row) ?? undefined) : undefined,
      });
      api?.push({ kind: 'stateChanged', payload: { instanceId: row.id, status: row.kind === 'shell' ? 'working' : 'spawning' } });
      return { ok: true };
    }
```

- [ ] **Step 2: Typecheck the orchestrator (should now be clean)**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: No errors related to this work. (Pre-existing drift noted in CLAUDE.md may remain — do not fix it.)

- [ ] **Step 3: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(instances): restartInstance handler for crashed shells"
```

---

## Task 8: Renderer — thread `kind`, terminal icon, neutral status, restart button

**Files:**
- Modify: `client/src/state/useInstances.ts` (InstanceView, listInstances result)
- Modify: `client/src/components/instances/LeafView.tsx:68-75` (sessionInfos)
- Modify: `client/src/components/instances/SessionTabBar.tsx` (SessionInfo, dot/icon, restart)

- [ ] **Step 1: Add `kind` to `InstanceView`**

In `client/src/state/useInstances.ts`, extend the interface:

```typescript
export interface InstanceView {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
  kind: 'claude' | 'shell';
}
```

`refresh()` already does `setInstances(res.instances)` — the `kind` field now flows through because the IPC response carries it (Task 4/5). No further change here.

- [ ] **Step 2: Thread `kind` into `sessionInfos`**

In `client/src/components/instances/LeafView.tsx`, update both maps (lines 68-75):

```typescript
  const sessionInfos = tab.columnOrder.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return { id, status: inst?.status ?? 'unknown', kind: inst?.kind ?? 'claude' };
  });
  const hiddenSessionInfos = tab.hiddenInstanceIds.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return { id, status: inst?.status ?? 'unknown', kind: inst?.kind ?? 'claude' };
  });
```

- [ ] **Step 3: Extend `SessionInfo` and render a terminal icon + neutral dot for shells**

In `client/src/components/instances/SessionTabBar.tsx`:

Extend the interface (lines 17-20):

```typescript
export interface SessionInfo {
  id: string;
  status: string;
  kind: 'claude' | 'shell';
}
```

Add a terminal icon import at the top:

```typescript
import TerminalIcon from '@mui/icons-material/Terminal';
```

In the `sessions.map(...)` render (lines 62-112), inside the per-tab body, compute shell flag and swap the status dot for a terminal icon. Replace the attention-dot `<Box>` (the 8×8 circle) with:

```typescript
      {s.kind === 'shell' ? (
        <TerminalIcon
          aria-label="terminal"
          sx={{ fontSize: 14, flexShrink: 0, opacity: s.status === 'crashed' ? 0.5 : 0.8 }}
        />
      ) : (
        <Box
          aria-label={attentionColor ? `${s.status} — needs attention` : s.status}
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: attentionColor ?? MUTED_DOT,
            flexShrink: 0,
          }}
        />
      )}
```

> Keep `const attentionColor = ATTENTION_DOT[s.status];` above — it's still used for claude tabs. Shell tabs get the icon regardless of status (crashed shells dim it), so no claude status sublabels appear for them.

- [ ] **Step 4: Add a restart affordance for crashed shells**

Add an `onRestart?(id: string): void` to `SessionTabBar`'s `Props` (next to `onClose`). In the per-tab render, before the Close button, add a restart button shown only for crashed shells:

```typescript
      {s.kind === 'shell' && s.status === 'crashed' && onRestart && (
        <Tooltip title="Restart terminal">
          <IconButton
            size="small"
            aria-label="restart terminal"
            onClick={(e) => {
              e.stopPropagation();
              onRestart(s.id);
            }}
            sx={{ p: 0.25 }}
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
```

Add the icon import:

```typescript
import RefreshIcon from '@mui/icons-material/Refresh';
```

- [ ] **Step 5: Wire `onRestart` through `LeafView` to a `restartInstance` IPC call**

In `LeafView.tsx`, add an `onRestartColumn?(id: string): void` prop and pass it to both `<SessionTabBar onRestart={onRestartColumn} ... />` instances. In `App.tsx`, supply the handler where `LeafView`/the workspace is rendered:

```typescript
onRestartColumn={(id) => void window.watchtower.invoke('restartInstance', { instanceId: id })}
```

> If `App.tsx` renders the workspace through an intermediate component rather than `LeafView` directly, thread the prop down that component the same way `onCloseColumn` is threaded (search for `onCloseColumn=` in App.tsx, line ~484, and add `onRestartColumn` alongside it).

- [ ] **Step 6: Typecheck the client**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: No NEW errors. (Pre-existing drift listed in CLAUDE.md — rootDir for `dev/`, MUI v6 slotProps, `useInstances.spawn` return type — may remain. Do not fix those.)

- [ ] **Step 7: Commit**

```bash
git add client/src/state/useInstances.ts client/src/components/instances/LeafView.tsx client/src/components/instances/SessionTabBar.tsx client/src/App.tsx
git commit -m "feat(instances): terminal icon, neutral status, restart for shell tabs"
```

---

## Task 9: Renderer — "New terminal" in the new-instance flow

**Files:**
- Modify: `client/src/components/NewInstanceModal.tsx` (kind toggle, onSpawn signature)
- Modify: `client/src/App.tsx:280-299` (doSpawn), `:513-520` (NewInstanceModal mount)
- Modify: `client/src/state/useInstances.ts:78-91` (spawn signature)

- [ ] **Step 1: Add a kind toggle to `NewInstanceModal`**

In `client/src/components/NewInstanceModal.tsx`:

Change `Props.onSpawn` to carry kind:

```typescript
interface Props {
  open: boolean;
  defaultCwd?: string;
  onClose(): void;
  onSpawn(cwd: string, kind: 'claude' | 'shell'): void;
}
```

Add local state for the kind (near the existing `cwd` state):

```typescript
  const [kind, setKind] = useState<'claude' | 'shell'>('claude');
```

Add a toggle to the modal body (above or below the folder field), using MUI `ToggleButtonGroup`:

```tsx
<ToggleButtonGroup
  exclusive
  size="small"
  value={kind}
  onChange={(_e, v) => { if (v) setKind(v); }}
  sx={{ mb: 1 }}
>
  <ToggleButton value="claude">Claude session</ToggleButton>
  <ToggleButton value="shell">Terminal</ToggleButton>
</ToggleButtonGroup>
```

Add the imports:

```typescript
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
```

Update `submit` to pass the kind:

```typescript
  const submit = () => {
    const trimmed = cwd.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    onSpawn(trimmed, kind);
    onClose();
  };
```

- [ ] **Step 2: Update `useInstances.spawn` to accept and forward kind**

In `client/src/state/useInstances.ts`, change `spawn`:

```typescript
  const spawn = useCallback(
    async (cwd: string, args?: string[], kind: 'claude' | 'shell' = 'claude') => {
      const res = await window.watchtower.invoke('spawnInstance', { cwd, args, instanceKind: kind });
      if (res.instanceId) {
        await refresh();
        setActiveId(res.instanceId);
      }
      return res;
    },
    [refresh],
  );
```

Update the hook's return-type annotation for `spawn` accordingly:

```typescript
  spawn(cwd: string, args?: string[], kind?: 'claude' | 'shell'): Promise<{ instanceId: string | null; error?: string }>;
```

- [ ] **Step 3: Update `App.doSpawn` to accept kind and the modal mount**

In `client/src/App.tsx`, change `doSpawn` (lines 280-299):

```typescript
  const doSpawn = async (cwd: string, kind: 'claude' | 'shell' = 'claude') => {
    setSpawnInFlight((n) => n + 1);
    try {
      const tabId = routeSpawnToTab(cwd, projects);
      if (tabId.startsWith('cwd:')) setOpenAdHocCwds((s) => new Set(s).add(cwd));
      ensureTabMountedAndFocused({ layout, actions: layoutActions }, tabId);
      setActiveModule('instances');
      const res = await spawn(cwd, undefined, kind);
      if (res.instanceId) {
        layoutActions.focusColumnInTab(tabId, res.instanceId);
        setActive(res.instanceId);
      } else {
        setSpawnError(res.error ?? 'spawn failed — no instance id returned');
      }
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpawnInFlight((n) => n - 1);
    }
  };
```

Update the `NewInstanceModal` mount (line ~520):

```tsx
            onSpawn={(cwd, kind) => void doSpawn(cwd, kind)}
```

- [ ] **Step 4: Typecheck the client**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: No new errors beyond pre-existing drift.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
- Click the new-instance "+" → modal opens with a "Claude session / Terminal" toggle.
- Pick "Terminal", choose a folder, submit → a tab appears immediately (no spinner) running your `$SHELL`; you can type `ls`, `git status`.
- Type `exit` → the tab disappears.
- Start another terminal, run a command that exits non-zero in a subshell then `exit 3` → tab lingers showing crashed with a ↻ button; clicking it re-spawns a fresh shell.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/NewInstanceModal.tsx client/src/state/useInstances.ts client/src/App.tsx
git commit -m "feat(instances): New terminal option in the new-instance flow"
```

---

## Task 10: TimeTracker — "Open terminal" launch

**Files:**
- Modify: `client/src/App.tsx` (add `spawnTerminalForCwd`, pass to the TimeTracker subtree)
- Modify: `client/src/components/timetracker/ProjectDetailPane.tsx` (Open terminal action)

- [ ] **Step 1: Add a terminal-launch callback in App.tsx**

In `client/src/App.tsx`, near `switchToNewInstanceForCwd` (line 200), add:

```typescript
  const spawnTerminalForCwd = (cwd: string) => {
    setActiveModule('instances');
    void doSpawn(cwd, 'shell');
  };
```

> Terminals always spawn fresh (you may already have a Claude session in that cwd), so this bypasses the existing-instance launch modal and spawns directly.

- [ ] **Step 2: Pass it to the TimeTracker subtree**

Find where `ProjectDetailPane` (or its parent that already receives `onOpenNewInstanceForCwd` — line ~465) is rendered in `App.tsx` and add a prop:

```tsx
onOpenTerminalForCwd={spawnTerminalForCwd}
```

- [ ] **Step 3: Add the "Open terminal" action in ProjectDetailPane**

In `client/src/components/timetracker/ProjectDetailPane.tsx`, add the prop to its `Props` interface:

```typescript
  onOpenTerminalForCwd?: (cwd: string) => void;
```

Next to the existing "Open in Instances" control (the one wired to `launcher.launch`), add a button that launches a terminal in the project's folder. Use the project's `folder_path` the same way the existing launch action does (find the variable holding the project's folder, e.g. `project.folderPath` / `folder_path`):

```tsx
{onOpenTerminalForCwd && project.folderPath && (
  <Tooltip title="Open a terminal in this project's folder">
    <IconButton
      size="small"
      aria-label="open terminal"
      onClick={() => onOpenTerminalForCwd(project.folderPath!)}
    >
      <TerminalIcon fontSize="small" />
    </IconButton>
  </Tooltip>
)}
```

Add the import:

```typescript
import TerminalIcon from '@mui/icons-material/Terminal';
```

> Confirm the exact field name for the folder on the project object in this component (it may be `folderPath`, `folder_path`, or accessed via a prop). Match the field the existing "Open in Instances" action passes to `launcher.launch(projectName, cwd)`.

- [ ] **Step 4: Typecheck the client**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: No new errors beyond pre-existing drift.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
- Go to TimeTracker, open a project that has a `folder_path`.
- Click "Open terminal" → switches to Instances and a shell tab opens in that folder.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/components/timetracker/ProjectDetailPane.tsx
git commit -m "feat(timetracker): open a terminal in a project's folder"
```

---

## Task 11: Full verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — 528+ prior tests plus the new migration (2), repo (2), and shellPolicy (10) tests. No regressions.

- [ ] **Step 2: Both typechecks**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: No new errors; only the pre-existing drift documented in CLAUDE.md.

- [ ] **Step 3: End-to-end manual smoke (npm run dev)**

- New terminal from the + menu; type commands; `exit` closes the tab.
- Non-zero exit lingers as crashed; ↻ restarts it.
- Split a shell tab into a pane next to a Claude session (drag) — both render and resize.
- Quit and relaunch the app with a live shell open → it re-spawns fresh at the same cwd, live (no spinner). A crashed shell comes back crashed with its ↻ button.
- Confirm a Claude session in the same window still behaves exactly as before (spinner on spawn, status dots, Slack/quiet timers unaffected).
- Open terminal from a TimeTracker project row → shell opens in `folder_path`.

- [ ] **Step 4: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "test: full verification for plain terminal instances" || echo "nothing to commit"
```

---

## Notes / known limitations (documented, not bugs)

- A live shell (`status='working'`) appears in `instances:findByCwd` results, so launching a *Claude* session in a cwd that has a shell may show the shell in the existing-instances picker. Acceptable for v1; a `kind` filter on that query is a follow-up.
- Restart-on-launch loses a shell's prior scrollback (the pty is dead). By design.
- The enum (`'claude' | 'shell'`) is enforced in TypeScript + `buildPtySpawnConfig`, not by a DB `CHECK` constraint (SQLite can't add one via `ALTER TABLE ADD COLUMN`).
