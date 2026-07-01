# Tombstone Purge (#79) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Periodically hard-delete soft-deleted (tombstoned) rows older than 30 days from both the Mac's SQLite and Supabase Postgres, driven by the orchestrator after a converged sync cycle.

**Architecture:** A new `orchestrator/sync/purge.ts` module (`purgeTombstones` + `purgeDue`) that `SyncService` invokes at the end of a cycle where both `pushAll` and `pullAll` succeeded. Single-Mac topology (clients are online-direct, don't re-push) means convergence + a 30-day grace is sufficient — no per-device tracking, no schema changes.

**Tech Stack:** TypeScript, node:sqlite (tests) / better-sqlite3 (prod) via the `SqliteLike` interface, node-postgres via the `PgStore` interface, vitest.

## Global Constraints

- Grace period: **30 days** — `GRACE_MS = 30 * 24 * 60 * 60 * 1000`, copied verbatim.
- Purge throttle: **24 hours** — `PURGE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000`.
- Purge runs **only after a cycle where both `pushAll` and `pullAll` succeeded** (both stores converged). A purge failure must **never** flip the cycle to `ok:false`.
- Delete order is **child → parent**: `worklogs, tasks, contracts, epics, days_off, projects`.
- **No schema migration.** `lastRunAt` uses the existing `settings` table via `SettingsRepo` under key `sync.purge.lastRunAt`.
- Live-Postgres tests follow the existing `tests/orchestrator/sync/pull.test.ts` harness and **self-skip when PG is unreachable** (the `reachable` guard). Run them locally with the dev Postgres container up (`postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower`).
- Verification gate: `npm run typecheck:ci` and `npm test` both green.

---

## File Structure

- **Create** `orchestrator/sync/purge.ts` — the purge module (`GRACE_MS`, `PURGE_MIN_INTERVAL_MS`, `purgeDue`, `purgeTombstones`, `PurgeResult`).
- **Modify** `orchestrator/sync/service.ts` — inject `now`, add `purge?` to `SyncCycleResult`, call the purge after a converged cycle (throttled, failure-isolated).
- **Create** `tests/orchestrator/sync/purge.test.ts` — pure-unit (`purgeDue`) + live-PG (`purgeTombstones`) coverage.
- **Modify** `tests/orchestrator/sync/service.test.ts` — assert purge is skipped on a non-converged cycle and gated by `purgeDue`.

---

### Task 1: Purge module (`orchestrator/sync/purge.ts`)

**Files:**
- Create: `orchestrator/sync/purge.ts`
- Test: `tests/orchestrator/sync/purge.test.ts`

**Interfaces:**
- Consumes: `SqliteLike` (`orchestrator/db/migrations.ts`), `PgStore` (`orchestrator/db/pg/pool.ts`), `SYNCED_TABLES` (`orchestrator/sync/schema.ts`), `SettingsRepo` (`orchestrator/db/repositories/settings.ts`).
- Produces:
  - `GRACE_MS: number`, `PURGE_MIN_INTERVAL_MS: number`
  - `purgeDue(db: SqliteLike, now: number): boolean`
  - `purgeTombstones(db: SqliteLike, store: PgStore, now: number): Promise<PurgeResult>`
  - `interface PurgeResult { purged: Record<string, number>; ranAt: string }`

- [ ] **Step 1: Write the failing pure-unit test for `purgeDue`** (no Postgres needed — fails cleanly first).

Create `tests/orchestrator/sync/purge.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { pushAll } from '../../../orchestrator/sync/push.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { SettingsRepo } from '../../../orchestrator/db/repositories/settings.js';
import { GRACE_MS, PURGE_MIN_INTERVAL_MS, purgeDue, purgeTombstones } from '../../../orchestrator/sync/purge.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';
const urlIsLocalhost = PG_URL.includes('localhost') || PG_URL.includes('127.0.0.1');
if (!urlIsLocalhost) throw new Error(`[purge.test] refusing DROP SCHEMA on non-localhost PG_URL: ${PG_URL}`);

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('purgeDue', () => {
  it('is due when never run before', () => {
    const db = freshSqlite();
    expect(purgeDue(db, Date.parse('2026-07-01T00:00:00.000Z'))).toBe(true);
  });

  it('is not due within the throttle interval, due after it', () => {
    const db = freshSqlite();
    const t0 = Date.parse('2026-07-01T00:00:00.000Z');
    new SettingsRepo(db).set('sync.purge.lastRunAt', new Date(t0).toISOString());
    expect(purgeDue(db, t0 + PURGE_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(purgeDue(db, t0 + PURGE_MIN_INTERVAL_MS + 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npx vitest run tests/orchestrator/sync/purge.test.ts -t purgeDue`
Expected: FAIL — cannot resolve `../../../orchestrator/sync/purge.js` / `purgeDue is not a function`.

- [ ] **Step 3: Write `orchestrator/sync/purge.ts`**

```ts
import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { SYNCED_TABLES } from './schema.js';
import { SettingsRepo } from '../db/repositories/settings.js';

/** Retain a soft-deleted (tombstoned) row this long before hard-deleting it. */
export const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** Run the purge sweep at most this often. */
export const PURGE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const LAST_RUN_KEY = 'sync.purge.lastRunAt';

// Child → parent so an FK-enforcing DELETE never orphans/violates. days_off has no FK.
const PURGE_ORDER = ['worklogs', 'tasks', 'contracts', 'epics', 'days_off', 'projects'] as const;

export interface PurgeResult {
  /** Per-table count of hard-deleted tombstone rows (SQLite side). */
  purged: Record<string, number>;
  ranAt: string;
}

/** True when no purge has run within PURGE_MIN_INTERVAL_MS (or ever). */
export function purgeDue(db: SqliteLike, now: number): boolean {
  const last = new SettingsRepo(db).getString(LAST_RUN_KEY, '');
  const lastMs = Date.parse(last);
  if (!Number.isFinite(lastMs)) return true;
  return now - lastMs > PURGE_MIN_INTERVAL_MS;
}

/**
 * Hard-delete tombstones (deleted_at set) older than GRACE_MS from BOTH stores,
 * child→parent. Postgres first, then SQLite; a partial failure self-heals next
 * run (a leftover tombstone's updated_at is far below the push cursor, so it
 * never re-pushes). Records the run time so purgeDue() throttles later calls.
 * SAFETY: the caller MUST only invoke this after a sync cycle converged both stores.
 */
export async function purgeTombstones(db: SqliteLike, store: PgStore, now: number): Promise<PurgeResult> {
  const threshold = new Date(now - GRACE_MS).toISOString();
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));
  const purged: Record<string, number> = {};
  for (const name of PURGE_ORDER) {
    const table = byName.get(name);
    if (!table) continue;
    const { rows } = await store.query<{ sync_id: string }>(
      `DELETE FROM ${table.pgTable} WHERE deleted_at IS NOT NULL AND deleted_at < $1 RETURNING sync_id`,
      [threshold],
    );
    const info = db
      .prepare(`DELETE FROM ${table.name} WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
      .run(threshold) as { changes: number };
    purged[name] = info.changes;
    if (rows.length !== info.changes) {
      console.warn(`[purge] ${name}: store counts differ pg=${rows.length} sqlite=${info.changes}`);
    }
  }
  new SettingsRepo(db).set(LAST_RUN_KEY, new Date(now).toISOString());
  const total = Object.values(purged).reduce((a, b) => a + b, 0);
  if (total > 0) console.log(`[purge] hard-deleted ${total} tombstones:`, purged);
  return { purged, ranAt: new Date(now).toISOString() };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run tests/orchestrator/sync/purge.test.ts -t purgeDue`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the live-PG behaviour tests** to `tests/orchestrator/sync/purge.test.ts` (append after the `purgeDue` describe block):

```ts
describe('purgeTombstones', () => {
  let store: PgStore | null = null;
  let reachable = false;
  beforeAll(async () => {
    store = createPgStore(PG_URL);
    if (!store) return;
    try { await store.healthCheck(); reachable = true; } catch { console.warn('[purge.test] pg unreachable — skipping'); }
  });
  afterAll(async () => { if (store) await store.end(); });
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  const NOW = Date.parse('2026-07-01T12:00:00.000Z');
  const OLD = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40d ago > 30d grace
  const FRESH = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2d ago < grace

  // Tombstone a project's row in BOTH stores at a given deleted_at/updated_at.
  async function tombstoneBoth(db: SqliteLike, store: PgStore, id: number, syncId: string, ts: string) {
    db.prepare(`UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?`).run(ts, ts, id);
    await store.query(`UPDATE projects SET deleted_at=$1, updated_at=$1 WHERE sync_id=$2`, [ts, syncId]);
  }

  it('hard-deletes tombstones older than the grace period from both stores', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Old' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    await tombstoneBoth(db, store, p.id, syncId, OLD);

    const res = await purgeTombstones(db, store, NOW);

    expect(res.purged.projects).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) c FROM projects WHERE sync_id=?`).get(syncId) as any).toMatchObject({ c: 0 });
    const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text c FROM projects WHERE sync_id=$1`, [syncId]);
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it('leaves fresh tombstones and live rows untouched', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const live = new ProjectsRepo(db).create({ name: 'Live' });
    const freshDel = new ProjectsRepo(db).create({ name: 'FreshDel' });
    await pushAll(db, store);
    const freshSyncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(freshDel.id) as any).sync_id;
    await tombstoneBoth(db, store, freshDel.id, freshSyncId, FRESH);

    const res = await purgeTombstones(db, store, NOW);

    expect(res.purged.projects).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) c FROM projects WHERE deleted_at IS NULL`).get() as any).toMatchObject({ c: 1 }); // the live one
    expect(db.prepare(`SELECT COUNT(*) c FROM projects WHERE sync_id=?`).get(freshSyncId) as any).toMatchObject({ c: 1 }); // fresh tombstone kept
  });

  it('deletes child rows before parents without FK violation', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    // A project with an epic → task → worklog, then delete the project (cascade
    // tombstones the whole subtree), backdate all tombstones, push, and purge.
    const p = new ProjectsRepo(db).create({ name: 'Tree' });
    const e = new EpicsRepo(db).create({ projectId: p.id, name: 'E' });
    const t = new TasksRepo(db).create({ epicId: e.id, number: 'T-1', title: 'T' });
    new WorklogsRepo(db).create({ taskId: t.id, workDate: '2026-06-01', minutes: 60 });
    await pushAll(db, store);
    // Cascade-tombstone via the repo, then backdate every tombstone in both stores.
    new ProjectsRepo(db).delete(p.id);
    db.prepare(`UPDATE projects SET deleted_at=?, updated_at=? WHERE deleted_at IS NOT NULL`).run(OLD, OLD);
    db.prepare(`UPDATE epics SET deleted_at=?, updated_at=? WHERE deleted_at IS NOT NULL`).run(OLD, OLD);
    db.prepare(`UPDATE tasks SET deleted_at=?, updated_at=? WHERE deleted_at IS NOT NULL`).run(OLD, OLD);
    db.prepare(`UPDATE worklogs SET deleted_at=?, updated_at=? WHERE deleted_at IS NOT NULL`).run(OLD, OLD);
    await pushAll(db, store); // propagate the backdated tombstones to PG

    const res = await purgeTombstones(db, store, NOW);

    expect(res.purged.worklogs).toBeGreaterThanOrEqual(1);
    expect(res.purged.projects).toBe(1);
    for (const tbl of ['projects', 'epics', 'tasks', 'worklogs']) {
      const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text c FROM ${tbl}`);
      expect(Number(rows[0]!.c)).toBe(0);
    }
  });

  it('is idempotent — a second purge deletes nothing', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Once' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    await tombstoneBoth(db, store, p.id, syncId, OLD);
    await purgeTombstones(db, store, NOW);
    const res2 = await purgeTombstones(db, store, NOW + 1);
    expect(res2.purged.projects).toBe(0);
  });
});
```

Add the extra repo imports at the top of the file (next to `ProjectsRepo`):

```ts
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../../orchestrator/db/repositories/worklogs.js';
```

- [ ] **Step 6: Run the full purge test file (dev Postgres container up)**

Run: `npx vitest run tests/orchestrator/sync/purge.test.ts`
Expected: PASS (all `purgeDue` + `purgeTombstones` tests). If PG is down the `purgeTombstones` block self-skips (still green) — start the dev container to actually exercise it.

- [ ] **Step 7: Typecheck the orchestrator**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add orchestrator/sync/purge.ts tests/orchestrator/sync/purge.test.ts
git commit -m "feat(sync): tombstone purge module (#79)"
```

---

### Task 2: Wire the purge into `SyncService`

**Files:**
- Modify: `orchestrator/sync/service.ts`
- Test: `tests/orchestrator/sync/service.test.ts`

**Interfaces:**
- Consumes: `purgeDue`, `purgeTombstones` from Task 1; existing `pushAll`/`pullAll`.
- Produces: `SyncServiceOptions.now?: () => number`; `SyncCycleResult.purge?: Record<string, number>`.

- [ ] **Step 1: Write the failing test** — add to `tests/orchestrator/sync/service.test.ts`. `SyncService` must NOT purge when the cycle fails, and must skip when not due. Use a fake store whose `query` throws to force a non-converged cycle; assert no purge ran (the settings key stays unset).

```ts
import { SettingsRepo } from '../../../orchestrator/db/repositories/settings.js';

it('does not purge when the cycle fails to converge', async () => {
  const db = freshSqlite(); // existing helper in this file, or mirror pull.test.ts
  const throwingStore = {
    query: async () => { throw new Error('pg down'); },
    healthCheck: async () => false,
    end: async () => {},
  } as unknown as PgStore;
  const svc = new SyncService({ db, store: throwingStore, now: () => Date.parse('2026-07-01T00:00:00.000Z') });
  const res = await svc.syncNow();
  expect(res.ok).toBe(false);
  expect(res.purge).toBeUndefined();
  // No purge ran → throttle key never written.
  expect(new SettingsRepo(db).getString('sync.purge.lastRunAt', '')).toBe('');
});
```

If `service.test.ts` has no `freshSqlite` helper, add the same one used in `pull.test.ts` (import `runMigrations`, `DatabaseSync` via `createRequire`) at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/orchestrator/sync/service.test.ts -t "does not purge"`
Expected: FAIL — `res.purge` type/behaviour not present yet, or `now` option unsupported (TS error / assertion fail).

- [ ] **Step 3: Modify `orchestrator/sync/service.ts`**

Add the import:

```ts
import { purgeDue, purgeTombstones } from './purge.js';
```

Add `purge?` to the result interface:

```ts
export interface SyncCycleResult {
  ok: boolean;
  push?: Record<string, number>;
  pull?: Record<string, { pulled: number; conflicts: number; touchedFkIds: number[] }>;
  purge?: Record<string, number>;
  error?: string;
}
```

Add a `now` option + field:

```ts
export interface SyncServiceOptions {
  db: SqliteLike;
  store: PgStore | null;
  periodMs?: number;
  debounceMs?: number;
  now?: () => number;
  onCycle?: (r: SyncCycleResult) => void;
}
```

In the class, add the field and initialise it in the constructor:

```ts
  private readonly now: () => number;
  // ...in constructor:
  this.now = opts.now ?? (() => Date.now());
```

Replace the body of `syncNow` between the `try/catch` and `this.onCycle?.(result)` so a converged cycle triggers a throttled, failure-isolated purge:

```ts
    this.running = true;
    let result: SyncCycleResult;
    try {
      const push = await pushAll(this.db, this.store);
      const pull = await pullAll(this.db, this.store);
      result = { ok: true, push, pull };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.running = false;
    }
    // Both stores just converged → safe to hard-delete old tombstones. Throttled
    // to once/day. A purge failure must not flip the cycle to not-ok; it self-heals.
    if (result.ok && this.store && purgeDue(this.db, this.now())) {
      try {
        result.purge = (await purgeTombstones(this.db, this.store, this.now())).purged;
      } catch (err) {
        console.warn('[purge] failed (will retry next cycle):', err);
      }
    }
    this.onCycle?.(result);
    if (this.pending) { this.pending = false; void this.syncNow(); }
    return result;
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `npx vitest run tests/orchestrator/sync/service.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Add the converged-cycle happy-path test** (live PG) to `service.test.ts` — a converged `syncNow` with an old tombstone purges it and reports `res.purge`:

```ts
it('purges old tombstones after a converged cycle', async () => {
  if (!reachable || !store) return; // reuse this file's PG guard, or mirror pull.test.ts setup
  const db = freshSqlite();
  const p = new ProjectsRepo(db).create({ name: 'Doomed' });
  const NOW = Date.parse('2026-07-01T12:00:00.000Z');
  const OLD = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString();
  const svc = new SyncService({ db, store, now: () => NOW });
  await svc.syncNow(); // push it up
  const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
  db.prepare(`UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?`).run(OLD, OLD, p.id);
  await store.query(`UPDATE projects SET deleted_at=$1, updated_at=$1 WHERE sync_id=$2`, [OLD, syncId]);
  // Force the throttle open (first syncNow already recorded a run).
  new SettingsRepo(db).set('sync.purge.lastRunAt', '');
  const res = await svc.syncNow();
  expect(res.ok).toBe(true);
  expect(res.purge?.projects).toBe(1);
});
```

If `service.test.ts` is currently a pure-unit file (no PG), guard this test with the same `reachable`/`store` `beforeAll` block used in `pull.test.ts` so it self-skips without Postgres.

- [ ] **Step 6: Run the full sync test suite**

Run: `npx vitest run tests/orchestrator/sync/`
Expected: PASS (push, pull, service, schema, derive, etl, purge).

- [ ] **Step 7: Full verification gate**

Run: `npm run typecheck:ci && npm test`
Expected: typecheck clean; suite green (909+ existing pass, no regressions; live-PG tests skip if no container).

- [ ] **Step 8: Commit**

```bash
git add orchestrator/sync/service.ts tests/orchestrator/sync/service.test.ts
git commit -m "feat(sync): run tombstone purge after a converged sync cycle (#79)"
```

---

## Self-Review

**Spec coverage:**
- Mac-driven purge after converged sync → Task 2 (purge gated on `result.ok` inside `syncNow`). ✓
- 30-day grace + 24h throttle → Task 1 constants + `purgeDue`. ✓
- Delete both stores, child→parent, Postgres-first → Task 1 `purgeTombstones` (`PURGE_ORDER`, PG `DELETE … RETURNING` then SQLite). ✓
- No migration; `sync.purge.lastRunAt` in settings → Task 1 via `SettingsRepo`. ✓
- Crash-safety/idempotency → Task 1 idempotency test (Step 5) + Postgres-first ordering. ✓
- Failure isolation (purge never flips cycle ok) → Task 2 try/catch + "does not purge when cycle fails" test. ✓
- Tests mirror the live-PG harness and self-skip → both test files use the `reachable` guard. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `purgeTombstones(db, store, now)` and `purgeDue(db, now)` signatures identical across module, tests, and the `service.ts` call site. `PurgeResult.purged` (`Record<string, number>`) matches `SyncCycleResult.purge`. `now` is `() => number` on the service, `number` on the module functions (the service calls `this.now()`). ✓

## Out of Scope (from spec)

No new schema/tables/Supabase jobs; no per-device tracking / multi-Mac; no undelete UI; no purge of `sync_conflicts` / `hook_events` / `notifications`.
