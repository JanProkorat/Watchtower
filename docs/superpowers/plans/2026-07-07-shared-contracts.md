# Shared Contracts Across Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one client contract span multiple projects with a single shared man-day (MD) budget pool consumed across all linked projects.

**Architecture:** Approach A — a shared contract is a set of ordinary per-project `contracts` rows sharing a new `contract_group_id` column and identical terms. Existing per-project rate-resolution, rebilling, overlap, and sync stay unchanged; group create/edit/delete fan out across member rows, and MD tracking sums worklogs across the group's projects against one `md_limit`.

**Tech Stack:** Electron + React (MUI v5) desktop renderer (`apps/desktop`), Node orchestrator with `better-sqlite3` (tests use `node:sqlite`), Postgres mirror + custom sync engine, shared TS packages (`packages/shared`, `packages/data-supabase`, `packages/module-timetracker`), Supabase (PostgREST) for iPad/iPhone. Vitest.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-07-shared-contracts-design.md`.
- Locale is Czech; **no i18n**. UI copy in Czech. Dates `D. M. YYYY` via `apps/desktop/src` format helpers; numbers with NBSP separators.
- `@watchtower/shared` is a **built composite** package — after editing `packages/shared/src`, run `npm run build -w @watchtower/shared` (or the repo build) before dependents typecheck/resolve.
- Never `git add -A`/`git add .` — the tree carries unrelated untracked WIP (`.etl-run.mts`, `.preflight-supabase.mjs`, `docs/prototypes/*.html`). Stage only the exact files each task touches.
- `npm test` runs vitest but does **not** typecheck (esbuild strips types). Run `npx tsc -p orchestrator/tsconfig.json --noEmit` after orchestrator changes and `npm run typecheck:ci` before the final commit — CI's `verify` job typechecks all workspaces.
- TDD: failing test first, minimal implementation, green, commit. Keep the full suite (987+ tests) green.
- `contract_group_id IS NULL` means a solo contract — today's behavior, must remain byte-for-byte unchanged.
- The invariant "all live rows sharing a `contract_group_id` have identical `effective_from`, `end_date`, `rate_type`, `rate_amount`, `hours_per_day`, `md_limit`" is maintained in the orchestrator service layer and mirrored in the iPad mutation layer.
- Postgres pg tests do `DROP SCHEMA public CASCADE` against localhost only; run them against a throwaway DB, never the dev `watchtower` DB.

---

## Phase 1 — Data model, migrations, sync column

### Task 1: SQLite migration v17 — add `contract_group_id`

**Files:**
- Modify: `orchestrator/db/migrations.ts` (append after the current last version, v16)
- Test: `tests/orchestrator/migrations.test.ts` (add a case; if the file's assertion style differs, mirror the existing v16 test)

**Interfaces:**
- Produces: column `contracts.contract_group_id TEXT` (nullable), index `idx_contracts_group`.

- [ ] **Step 1: Write the failing test** — verify a fresh migrated DB has the column and index.

```ts
// tests/orchestrator/migrations.test.ts
it('v17 adds nullable contract_group_id + idx_contracts_group to contracts', () => {
  const db = freshMigratedDb(); // same helper the file already uses
  const cols = (db.prepare(`PRAGMA table_info(contracts)`).all() as Array<{ name: string; notnull: number }>);
  const col = cols.find((c) => c.name === 'contract_group_id');
  expect(col).toBeDefined();
  expect(col!.notnull).toBe(0); // nullable
  const idx = db.prepare(`PRAGMA index_list(contracts)`).all() as Array<{ name: string }>;
  expect(idx.some((i) => i.name === 'idx_contracts_group')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t "contract_group_id"`
Expected: FAIL (column undefined).

- [ ] **Step 3: Add the migration**

```ts
// orchestrator/db/migrations.ts — new entry appended to the MIGRATIONS array
{
  version: 17,
  up: (db) => {
    // Shared contracts (#<issue>): a nullable group id ties per-project contract
    // rows that belong to one client contract. NULL = solo contract (unchanged).
    addColumnIfMissing(db, 'contracts', 'contract_group_id', 'TEXT');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_contracts_group ON contracts(contract_group_id)`);
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t "contract_group_id"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/migrations.ts tests/orchestrator/migrations.test.ts
git commit -m "feat(contracts): SQLite migration v17 — add contract_group_id"
```

### Task 2: Postgres migration v10 — add `contract_group_id`

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (append `{ version: 10, up: [...] }` to `PG_MIGRATIONS`; also add the column to the base `CONTRACTS` DDL comment is NOT needed — the migration handles existing DBs and `IF NOT EXISTS` makes fresh DBs fine)
- Test: `tests/orchestrator/pg/migrate.test.ts`

**Interfaces:**
- Produces: Postgres column `contracts.contract_group_id TEXT` + index.

- [ ] **Step 1: Write the failing test** (self-skips when Postgres unreachable, per the file's existing guard).

```ts
// tests/orchestrator/pg/migrate.test.ts — new it() inside describe('runPgMigrations')
it('adds contract_group_id to contracts', async () => {
  if (!reachable || !store) return;
  const { rows } = await store.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'contracts'`,
  );
  expect(rows.map((r) => r.column_name)).toContain('contract_group_id');
});
```

- [ ] **Step 2: Run test to verify it fails** — against a throwaway DB.

```bash
docker exec fitness-postgres psql -U fitness_admin -d postgres -c "DROP DATABASE IF EXISTS wt_pgtest;" -c "CREATE DATABASE wt_pgtest OWNER watchtower;"
WATCHTOWER_PG_URL='postgresql://watchtower:watchtower_dev_password@localhost:5432/wt_pgtest' npx vitest run tests/orchestrator/pg/migrate.test.ts -t "contract_group_id"
```
Expected: FAIL (column absent).

- [ ] **Step 3: Add the migration**

```ts
// orchestrator/db/pg/schema.ts — appended to PG_MIGRATIONS
{
  version: 10,
  up: [
    `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_group_id TEXT;`,
    `CREATE INDEX IF NOT EXISTS idx_contracts_group ON contracts(contract_group_id);`,
  ],
},
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker exec fitness-postgres psql -U fitness_admin -d postgres -c "DROP DATABASE IF EXISTS wt_pgtest;" -c "CREATE DATABASE wt_pgtest OWNER watchtower;"
WATCHTOWER_PG_URL='postgresql://watchtower:watchtower_dev_password@localhost:5432/wt_pgtest' npx vitest run tests/orchestrator/pg/migrate.test.ts
```
Expected: PASS. Then drop the throwaway DB: `docker exec fitness-postgres psql -U fitness_admin -d postgres -c "DROP DATABASE IF EXISTS wt_pgtest;"`

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/pg/schema.ts tests/orchestrator/pg/migrate.test.ts
git commit -m "feat(contracts): Postgres migration v10 — add contract_group_id"
```

### Task 3: Sync the `contract_group_id` column

**Files:**
- Modify: `orchestrator/sync/schema.ts` (contracts entry, ~`:150-165`)
- Test: `tests/orchestrator/pg/migrate.writeback.test.ts` (or the sync round-trip test that already pushes/pulls a contract; search for the contracts sync test)

**Interfaces:**
- Consumes: the columns from Tasks 1–2.
- Produces: `contract_group_id` flows through push/pull as a plain text column (no FK).

- [ ] **Step 1: Write the failing test** — a contract with a `contract_group_id` round-trips push→pull with the id intact. Extend the existing contracts sync test; if none isolates contracts, add:

```ts
// wherever the sync round-trip harness lives (mirror the existing worklog/contract round-trip test)
it('round-trips contract_group_id through push and pull', async () => {
  if (!reachable) return;
  // seed a contract row locally with contract_group_id = 'grp-1', push, then pull into a second store
  // assert the pulled row's contract_group_id === 'grp-1'
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the sync test file; Expected: FAIL (column not synced — pulled value null/undefined).

- [ ] **Step 3: Add the column to the registry**

```ts
// orchestrator/sync/schema.ts — inside the contracts entry's columns array, after 'md_limit'
{ name: 'md_limit', kind: 'numeric' },
{ name: 'contract_group_id', kind: 'text' },
{ name: 'created_at', kind: 'ts' },
```

- [ ] **Step 4: Run test to verify it passes** — round-trip test green.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/sync/schema.ts tests/orchestrator/pg/migrate.writeback.test.ts
git commit -m "feat(contracts): sync contract_group_id column"
```

---

## Phase 2 — Orchestrator repo: group operations

### Task 4: Expose `contractGroupId` on the repo row + accept it on insert

**Files:**
- Modify: `orchestrator/db/repositories/projectRates.ts`
- Test: `tests/orchestrator/contracts-repo.test.ts`

**Interfaces:**
- Produces:
  - `ProjectRateRow.contractGroupId: string | null`
  - `ProjectRateInput.contractGroupId?: string | null`
  - private `insertOrResurrect(input: ProjectRateInput): number` (extracted from `create`, so group ops reuse the tombstone-aware insert)

- [ ] **Step 1: Write the failing test**

```ts
it('round-trips contractGroupId on a created contract', () => {
  const c = rates.create({ projectId, effectiveFrom: '2026-01-01', contractGroupId: 'grp-1', ...STANDARD_INPUT });
  expect(c.contractGroupId).toBe('grp-1');
  expect(rates.get(c.id)?.contractGroupId).toBe('grp-1');
});

it('defaults contractGroupId to null for a solo contract', () => {
  const c = rates.create({ projectId, effectiveFrom: '2026-02-01', ...STANDARD_INPUT });
  expect(c.contractGroupId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/contracts-repo.test.ts -t "contractGroupId"`
Expected: FAIL (property missing / not selected).

- [ ] **Step 3: Implement**

Add to types and mapping:

```ts
// ProjectRateRow interface
contractGroupId: string | null;
// DbRow type
contract_group_id: string | null;
// ProjectRateInput interface
contractGroupId?: string | null;
// toRow()
contractGroupId: r.contract_group_id,
```

Add `contract_group_id` to every SELECT column list in `listForProject`, `get`, `activeForProject` (e.g. `..., md_limit, contract_group_id, created_at`).

Extract the tombstone-aware insert from `create` into a private helper that also writes the group id, and have `create` call it inside its existing transaction:

```ts
/** Insert one contract row (tombstone-resurrecting on the UNIQUE(project_id, effective_from) slot). Caller holds the transaction. */
private insertOrResurrect(input: ProjectRateInput): number {
  const tombstone = this.db
    .prepare(`SELECT id FROM contracts WHERE project_id = ? AND effective_from = ? AND deleted_at IS NOT NULL`)
    .get(input.projectId, input.effectiveFrom) as { id: number } | undefined;
  if (tombstone) {
    this.db
      .prepare(
        `UPDATE contracts
            SET rate_type = ?, rate_amount = ?, hours_per_day = ?, end_date = ?, md_limit = ?,
                contract_group_id = ?, deleted_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.rateType, input.rateAmount, input.hoursPerDay ?? 8, input.endDate ?? null,
           input.mdLimit ?? null, input.contractGroupId ?? null, nowIso(), tombstone.id);
    return tombstone.id;
  }
  const info = this.db
    .prepare(
      `INSERT INTO contracts
         (project_id, effective_from, rate_type, rate_amount, hours_per_day, end_date, md_limit,
          contract_group_id, sync_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.projectId, input.effectiveFrom, input.rateType, input.rateAmount, input.hoursPerDay ?? 8,
         input.endDate ?? null, input.mdLimit ?? null, input.contractGroupId ?? null, newSyncId(), nowIso())
    as { lastInsertRowid: number | bigint };
  return Number(info.lastInsertRowid);
}
```

Rewrite `create`'s body between `assertNoOverlap` and `COMMIT` to `const id = this.insertOrResurrect(input);` then `return this.get(id)!`.

- [ ] **Step 4: Run test to verify it passes** — full file green (the Problem-1 resurrection tests must still pass).

Run: `npx vitest run tests/orchestrator/contracts-repo.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/repositories/projectRates.ts tests/orchestrator/contracts-repo.test.ts
git commit -m "feat(contracts): repo exposes contractGroupId; extract insertOrResurrect"
```

### Task 5: Name the conflicting project on overlap

**Files:**
- Modify: `orchestrator/db/repositories/projectRates.ts` (`RateOverlapError`, `assertNoOverlap`)
- Test: `tests/orchestrator/contracts-repo.test.ts`

**Interfaces:**
- Produces: `RateOverlapError.conflictingProjectId: number` (in addition to existing `conflictingId`/`conflictingFrom`/`conflictingTo`).

- [ ] **Step 1: Write the failing test**

```ts
it('overlap error carries the conflicting project id', () => {
  rates.create({ projectId, effectiveFrom: '2026-01-01', endDate: '2026-06-30', ...STANDARD_INPUT });
  try {
    rates.create({ projectId, effectiveFrom: '2026-03-01', endDate: '2026-09-30', ...STANDARD_INPUT });
    throw new Error('expected overlap');
  } catch (e) {
    expect(e).toBeInstanceOf(RateOverlapError);
    expect((e as RateOverlapError).conflictingProjectId).toBe(projectId);
  }
});
```

- [ ] **Step 2: Run test to verify it fails** — property missing.

- [ ] **Step 3: Implement** — add `conflictingProjectId` to the error and include `project_id` in the `assertNoOverlap` SELECT; pass `projectId` when throwing.

```ts
export class RateOverlapError extends Error {
  constructor(
    public conflictingId: number,
    public conflictingFrom: string,
    public conflictingTo: string | null,
    public conflictingProjectId: number,
  ) {
    super(`Contract period overlaps with rate #${conflictingId} (${conflictingFrom} → ${conflictingTo ?? 'ongoing'}).`);
    this.name = 'RateOverlapError';
  }
}
```
In `assertNoOverlap`, select `project_id` too and `throw new RateOverlapError(row.id, row.effective_from, row.end_date, projectId);` (the parameter `projectId` is already in scope).

- [ ] **Step 4: Run test to verify it passes** — full file green.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/repositories/projectRates.ts tests/orchestrator/contracts-repo.test.ts
git commit -m "feat(contracts): overlap error names the conflicting project"
```

### Task 6: Group operations — create/update/delete/listMembers

**Files:**
- Modify: `orchestrator/db/repositories/projectRates.ts`
- Test: `tests/orchestrator/contracts-repo.test.ts`

**Interfaces:**
- Consumes: `insertOrResurrect`, `autoClosePrevious`, `assertNoOverlap` (Task 4/5).
- Produces (public methods on `ProjectRatesRepo`):
  - `createGroup(terms: GroupTerms, projectIds: number[]): { groupId: string; rows: ProjectRateRow[] }`
  - `updateGroup(groupId: string, terms: GroupTerms, projectIds: number[]): ProjectRateRow[]`
  - `deleteGroup(groupId: string): void`
  - `listGroupMembers(groupId: string): number[]`
  - `type GroupTerms = Omit<ProjectRateInput, 'projectId' | 'contractGroupId'>`

- [ ] **Step 1: Write the failing tests**

```ts
describe('shared contract groups', () => {
  let pA: number, pB: number, pC: number;
  beforeEach(() => {
    pA = projectId;
    pB = projects.create({ name: 'B', kind: 'work' }).id;
    pC = projects.create({ name: 'C', kind: 'work' }).id;
  });

  const TERMS = { effectiveFrom: '2026-01-01', rateType: 'hourly' as const, rateAmount: 1600, hoursPerDay: 8, endDate: null, mdLimit: 30 };

  it('createGroup writes one row per project sharing a group id + identical terms', () => {
    const { groupId, rows } = rates.createGroup(TERMS, [pA, pB, pC]);
    expect(rows).toHaveLength(3);
    for (const p of [pA, pB, pC]) {
      const [row] = rates.listForProject(p);
      expect(row!.contractGroupId).toBe(groupId);
      expect(row!.rateAmount).toBe(1600);
      expect(row!.mdLimit).toBe(30);
    }
    expect(rates.listGroupMembers(groupId).sort()).toEqual([pA, pB, pC].sort());
  });

  it('createGroup rejects and rolls back when a member project overlaps, naming the project', () => {
    rates.create({ projectId: pB, effectiveFrom: '2026-03-01', ...STANDARD_INPUT }); // pB busy
    try {
      rates.createGroup(TERMS, [pA, pB, pC]);
      throw new Error('expected overlap');
    } catch (e) {
      expect((e as RateOverlapError).conflictingProjectId).toBe(pB);
    }
    // rollback: pA and pC got nothing
    expect(rates.listForProject(pA)).toHaveLength(0);
    expect(rates.listForProject(pC)).toHaveLength(0);
  });

  it('updateGroup propagates term changes to all members', () => {
    const { groupId } = rates.createGroup(TERMS, [pA, pB]);
    rates.updateGroup(groupId, { ...TERMS, rateAmount: 2000, mdLimit: 50 }, [pA, pB]);
    for (const p of [pA, pB]) {
      const [row] = rates.listForProject(p);
      expect(row!.rateAmount).toBe(2000);
      expect(row!.mdLimit).toBe(50);
    }
  });

  it('updateGroup adds a newly-listed project and removes an unlisted one', () => {
    const { groupId } = rates.createGroup(TERMS, [pA, pB]);
    rates.updateGroup(groupId, TERMS, [pA, pC]); // drop B, add C
    expect(rates.listForProject(pB)).toHaveLength(0);
    expect(rates.listForProject(pC)[0]!.contractGroupId).toBe(groupId);
    expect(rates.listGroupMembers(groupId).sort()).toEqual([pA, pC].sort());
  });

  it('deleteGroup soft-deletes every member', () => {
    const { groupId } = rates.createGroup(TERMS, [pA, pB, pC]);
    rates.deleteGroup(groupId);
    for (const p of [pA, pB, pC]) expect(rates.listForProject(p)).toHaveLength(0);
    expect(rates.listGroupMembers(groupId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — methods undefined.

- [ ] **Step 3: Implement** — all methods wrap one `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` transaction (mirror `create`). Reuse per-project helpers so overlap + auto-close + resurrection all apply per member.

```ts
export type GroupTerms = Omit<ProjectRateInput, 'projectId' | 'contractGroupId'>;

createGroup(terms: GroupTerms, projectIds: number[]): { groupId: string; rows: ProjectRateRow[] } {
  const groupId = newSyncId(); // reuse the UUID generator
  this.db.exec('BEGIN IMMEDIATE');
  try {
    const ids: number[] = [];
    for (const projectId of projectIds) {
      this.autoClosePrevious(projectId, terms.effectiveFrom);
      this.assertNoOverlap(projectId, terms.effectiveFrom, terms.endDate ?? null, null);
      ids.push(this.insertOrResurrect({ ...terms, projectId, contractGroupId: groupId }));
    }
    this.db.exec('COMMIT');
    return { groupId, rows: ids.map((id) => this.get(id)!) };
  } catch (err) { this.db.exec('ROLLBACK'); throw err; }
}

listGroupMembers(groupId: string): number[] {
  return (this.db
    .prepare(`SELECT DISTINCT project_id FROM contracts WHERE contract_group_id = ? AND deleted_at IS NULL`)
    .all(groupId) as Array<{ project_id: number }>).map((r) => r.project_id);
}

updateGroup(groupId: string, terms: GroupTerms, projectIds: number[]): ProjectRateRow[] {
  this.db.exec('BEGIN IMMEDIATE');
  try {
    const current = this.listGroupMembers(groupId);
    const target = new Set(projectIds);
    // Remove unlisted members.
    for (const p of current) {
      if (!target.has(p)) {
        const row = this.db.prepare(
          `SELECT id FROM contracts WHERE contract_group_id = ? AND project_id = ? AND deleted_at IS NULL`
        ).get(groupId, p) as { id: number } | undefined;
        if (row) this.db.prepare(`UPDATE contracts SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), row.id);
      }
    }
    const ids: number[] = [];
    for (const projectId of projectIds) {
      const existing = this.db.prepare(
        `SELECT id FROM contracts WHERE contract_group_id = ? AND project_id = ? AND deleted_at IS NULL`
      ).get(groupId, projectId) as { id: number } | undefined;
      if (existing) {
        // Propagate terms; validate overlap excluding this row.
        this.assertNoOverlap(projectId, terms.effectiveFrom, terms.endDate ?? null, existing.id);
        this.db.prepare(
          `UPDATE contracts SET effective_from = ?, end_date = ?, rate_type = ?, rate_amount = ?, hours_per_day = ?, md_limit = ?, updated_at = ? WHERE id = ?`,
        ).run(terms.effectiveFrom, terms.endDate ?? null, terms.rateType, terms.rateAmount, terms.hoursPerDay ?? 8, terms.mdLimit ?? null, nowIso(), existing.id);
        ids.push(existing.id);
      } else {
        // Newly added project.
        this.autoClosePrevious(projectId, terms.effectiveFrom);
        this.assertNoOverlap(projectId, terms.effectiveFrom, terms.endDate ?? null, null);
        ids.push(this.insertOrResurrect({ ...terms, projectId, contractGroupId: groupId }));
      }
    }
    this.db.exec('COMMIT');
    return ids.map((id) => this.get(id)!);
  } catch (err) { this.db.exec('ROLLBACK'); throw err; }
}

deleteGroup(groupId: string): void {
  const ts = nowIso();
  this.db.prepare(`UPDATE contracts SET deleted_at = ?, updated_at = ? WHERE contract_group_id = ? AND deleted_at IS NULL`).run(ts, ts, groupId);
}
```

- [ ] **Step 4: Run test to verify it passes** — full file green.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/repositories/projectRates.ts tests/orchestrator/contracts-repo.test.ts
git commit -m "feat(contracts): repo group ops (create/update/delete/listMembers)"
```

---

## Phase 3 — Pooled MD tracking

### Task 7: `ContractStatusService.forRate` pools across group members

**Files:**
- Modify: `orchestrator/db/contractStatus.ts`
- Test: `tests/orchestrator/contracts-repo.test.ts` (the `ContractStatusService` describe block already lives here)

**Interfaces:**
- Consumes: `ProjectRateRow.contractGroupId` (Task 4), `ProjectRatesRepo.listGroupMembers` (Task 6).
- Produces: pooled `minutesLogged`/`mdsUsed`/`mdsRemaining` when the rate is grouped.

- [ ] **Step 1: Write the failing test**

```ts
it('pools MD usage across all projects in a shared contract group', () => {
  // pA and pB share a group with mdLimit 30; log 8h on each → 2 MD total.
  const projects2 = new ProjectsRepo(db);
  const pA = projects2.create({ name: 'A', kind: 'work' }).id;
  const pB = projects2.create({ name: 'B', kind: 'work' }).id;
  const epicsR = new EpicsRepo(db), tasksR = new TasksRepo(db), wl = new WorklogsRepo(db);
  const seed = (p: number, mins: number) => {
    const e = epicsR.create({ projectId: p, name: 'E' });
    const t = tasksR.create({ epicId: e.id, number: 'X', title: 'X' });
    wl.create({ taskId: t.id, workDate: '2026-01-05', minutes: mins });
  };
  seed(pA, 8 * 60); seed(pB, 8 * 60);
  const { groupId } = rates.createGroup(
    { effectiveFrom: '2026-01-01', rateType: 'hourly', rateAmount: 1600, hoursPerDay: 8, endDate: '2026-12-31', mdLimit: 30 },
    [pA, pB],
  );
  const svc = new ContractStatusService(db);
  const statusA = svc.forProject(pA, '2026-06-30');
  expect(statusA?.minutesLogged).toBe(2 * 8 * 60); // pooled, not just pA
  expect(statusA?.mdsUsed).toBe(2);
  expect(statusA?.mdsRemaining).toBe(28); // 30 - 2, same number on either project
  const statusB = svc.forProject(pB, '2026-06-30');
  expect(statusB?.minutesLogged).toBe(statusA?.minutesLogged);
});
```

- [ ] **Step 2: Run test to verify it fails** — `minutesLogged` will be one project's minutes only.

- [ ] **Step 3: Implement** — in `forRate`, compute the project set, then use `IN (...)`.

```ts
// forRate(rate, asOf): replace the single-project sum query.
const memberIds = rate.contractGroupId
  ? this.rates.listGroupMembers(rate.contractGroupId)
  : [rate.projectId];
const placeholders = memberIds.map(() => '?').join(', ');
const row = this.db
  .prepare(
    `SELECT COALESCE(SUM(${effectiveMinutes('w')}), 0) AS minutes
       FROM worklogs w
       JOIN tasks t  ON t.id = w.task_id
       JOIN epics e  ON e.id = t.epic_id
       JOIN projects p ON p.id = e.project_id
      WHERE e.project_id IN (${placeholders})
        AND p.kind = 'work'
        AND w.work_date >= ? AND w.work_date <= ?
        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL`,
  )
  .get(...memberIds, rate.effectiveFrom, periodEnd) as { minutes: number };
```

`ContractStatusService` needs a `ProjectRatesRepo` handle; it already constructs `this.rates` (confirm the constructor — if not, add `this.rates = new ProjectRatesRepo(db)`).

- [ ] **Step 4: Run test to verify it passes** — full file green (existing per-project status tests unaffected since solo rates use `[projectId]`).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/contractStatus.ts tests/orchestrator/contracts-repo.test.ts
git commit -m "feat(contracts): pool MD usage across shared-contract members"
```

### Task 8: Dedupe grouped contracts in report + dashboard

**Files:**
- Modify: `orchestrator/db/reports.ts` (`contractsReport`, ~`:370-384`)
- Modify: `orchestrator/db/dashboardOverview.ts` (~`:110-113`)
- Test: `tests/orchestrator/reports.test.ts` and/or `tests/orchestrator/dashboardOverview.test.ts` (mirror existing tests in whichever file covers these)

**Interfaces:**
- Consumes: `ProjectRateRow.contractGroupId`.
- Produces: a grouped contract appears **once** in the contracts report and once in the dashboard active-contracts list, tagged with its member projects.

- [ ] **Step 1: Write the failing test** — after creating a 2-project group, `contractsReport` returns one contract entry for the group, not two.

```ts
it('reports a shared contract once, not once per project', () => {
  // build a group over pA, pB (same helper style as Task 7), then:
  const report = new ReportsService(db).contractsReport(/* args per existing signature */);
  const grouped = report.filter((r) => r.contract && (r.contract as any).contractGroupId === groupId);
  expect(grouped).toHaveLength(1);
});
```
(Adjust to the real `contractsReport` return shape — inspect `ContractReportRowPayload` in `packages/shared/src/ipcContract.ts:221`.)

- [ ] **Step 2: Run test to verify it fails** — two rows returned.

- [ ] **Step 3: Implement** — in the per-project loop, track a `Set<string>` of seen group ids; when a project's active contract has a `contractGroupId` already seen, skip it. On the first occurrence, include the row and attach the member project names (from `listGroupMembers` + `ProjectsRepo`). Solo contracts (null group id) are never deduped. Apply the same skip in `dashboardOverview`.

- [ ] **Step 4: Run test to verify it passes** — target file green, full suite green.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/reports.ts orchestrator/db/dashboardOverview.ts tests/orchestrator/*.test.ts
git commit -m "feat(contracts): dedupe shared contracts in report + dashboard"
```

### Task 9: Pooled `contractBurn` in shared billing

**Files:**
- Modify: `packages/shared/src/billing/contracts.ts` (`contractBurn`, ~`:59`)
- Test: `tests/shared/billing/contracts.test.ts`

**Interfaces:**
- Consumes: a `ContractRow` carrying `contractGroupId` and the full contracts + worklogs arrays.
- Produces: `contractBurn` sums worklogs across all projects sharing the rate's `contractGroupId`, not just `rate.projectId`.

- [ ] **Step 1: Write the failing test** — mirror Task 7 at the pure-function level: two projects share a group; burn pools both projects' minutes. Use the existing test's fixture builders.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement** — compute the member project id set from the passed contracts (`contracts.filter(c => c.contractGroupId === rate.contractGroupId).map(c => c.projectId)`, or `[rate.projectId]` when null) and filter worklogs by `memberIds.includes(w.projectId)` instead of `w.projectId === rate.projectId` (`:95`). Add `contractGroupId` to the `ContractRow`/`ContractLite` types the function consumes (mirror the Postgres/SQLite field).

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Build shared + commit**

```bash
npm run build -w @watchtower/shared
git add packages/shared/src/billing/contracts.ts tests/shared/billing/contracts.test.ts
git commit -m "feat(contracts): pool contractBurn across shared-contract members"
```

---

## Phase 4 — IPC surface + handlers

### Task 10: Extend IPC contract types

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (`ContractInputPayload:313`, `ContractViewPayload:323`, overlap response `:561-564`)
- Modify: `packages/shared/src/messagePort.ts` (mirror: `OrchContractInput:47`, `OrchContractView:498`, `OrchOverlapError`)
- Test: `tests/shared/ipcContract.test.ts` (add a type-shape assertion if the file tests shapes; otherwise this task is validated by downstream typechecks and Task 11)

**Interfaces:**
- Produces:
  - `ContractInputPayload.projectIds: number[]` (required; solo = `[projectId]`). Keep `projectId` for backward compat, OR make handlers derive the primary from `projectIds[0]`. Decision: **keep `projectId` and add `projectIds`**; when `projectIds.length <= 1`, behave exactly as today.
  - `ContractViewPayload.groupId: string | null` and `ContractViewPayload.projectIds: number[]` (member project ids; `[projectId]` for solo).
  - Overlap response gains `conflictingProjectId: number` and `conflictingProjectName: string`.

- [ ] **Step 1: Write the failing test** — if `ipcContract.test.ts` asserts shapes, add fields; else add a minimal compile-time test:

```ts
it('ContractInputPayload accepts projectIds and ContractView exposes groupId', () => {
  const input: ContractInputPayload = { projectId: 1, projectIds: [1, 2], effectiveFrom: '2026-01-01', rateType: 'hourly', rateAmount: 1 };
  const view = {} as ContractViewPayload;
  expect(input.projectIds).toEqual([1, 2]);
  // @ts-expect-no-error
  const g: string | null = view.groupId;
  void g;
});
```

- [ ] **Step 2: Run test to verify it fails / does not compile.**

- [ ] **Step 3: Implement** — add the fields to both files (keep `ipcContract.ts` and `messagePort.ts` in lockstep). `projectIds` required on input; `groupId`/`projectIds` required on the view.

- [ ] **Step 4: Build shared + run test**

```bash
npm run build -w @watchtower/shared
npx vitest run tests/shared/ipcContract.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts tests/shared/ipcContract.test.ts
git commit -m "feat(contracts): IPC types for shared contracts (projectIds, groupId)"
```

### Task 11: Orchestrator handlers route solo vs group

**Files:**
- Modify: `orchestrator/index.ts` (`contracts:create:789`, `contracts:update:808`, `contracts:delete:839`, `contractViewOf:256`)
- Test: `tests/orchestrator/contracts-ipc.test.ts` (new; or extend an existing orchestrator IPC handler test — search for how `contracts:create` is currently tested)

**Interfaces:**
- Consumes: repo group ops (Task 6), extended payloads (Task 10), `RateOverlapError.conflictingProjectId` (Task 5).
- Produces: `contractViewOf(rate)` now fills `groupId` + `projectIds`; handlers fan out to group ops; overlap responses include `conflictingProjectId` + resolved `conflictingProjectName`.

- [ ] **Step 1: Write the failing test** — drive the handler function (mirror how the suite dispatches IPC to the orchestrator; if there's no direct harness, call the exported handler map). Cases: create with `projectIds:[A,B]` produces two rows sharing a group id; create overlap returns `{ error:'overlap', conflictingProjectId, conflictingProjectName }`; update changes membership; delete removes the whole group; `contractViewOf` reports `groupId` + `projectIds`.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement**

`contractViewOf` (`:256`): after building the status row, set
```ts
groupId: rate.contractGroupId,
projectIds: rate.contractGroupId ? projectRatesRepo().listGroupMembers(rate.contractGroupId) : [rate.projectId],
```

`contracts:create`: 
```ts
const p = req.payload as ContractInputPayload;
const ids = p.projectIds ?? [p.projectId];
try {
  if (ids.length > 1) {
    const { rows } = projectRatesRepo().createGroup(termsOf(p), ids);
    for (const r of rows) markWorklogsForRebill(handle!.db, r.projectId, r.effectiveFrom, nowIso());
    notifySync();
    return { contract: contractViewOf(rows[0]) };
  }
  const row = projectRatesRepo().create({ ...termsOf(p), projectId: ids[0] });
  markWorklogsForRebill(handle!.db, row.projectId, row.effectiveFrom, nowIso());
  notifySync();
  return { contract: contractViewOf(row) };
} catch (err) {
  if (err instanceof RateOverlapError) return overlapResponse(err);
  throw err;
}
```
where `termsOf(p)` builds `GroupTerms` and `overlapResponse(err)` adds `conflictingProjectName: new ProjectsRepo(handle!.db).get(err.conflictingProjectId)?.name ?? ''`. Add a small `termsOf`/`overlapResponse` helper near the handler.

`contracts:update`: if the target row has a `contractGroupId`, call `updateGroup(groupId, termsOf(input), input.projectIds)` and rebill each returned row's project (earliest-from rule per member); else the existing single-row `update`. Wrap in the same overlap catch.

`contracts:delete`: if the row has a `contractGroupId`, `deleteGroup(groupId)` and rebill each former member; else existing single delete.

- [ ] **Step 4: Run test to verify it passes** — target file green; then `npx tsc -p orchestrator/tsconfig.json --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/index.ts tests/orchestrator/contracts-ipc.test.ts
git commit -m "feat(contracts): orchestrator handlers route solo vs shared groups"
```

---

## Phase 5 — Desktop UI

### Task 12: `useContracts` hook passes projectIds + exposes group info

**Files:**
- Modify: `apps/desktop/src/state/useContracts.ts`
- Test: none new (hook is thin IPC glue; validated via Task 13 typecheck + manual run). If the repo has hook tests, mirror them.

**Interfaces:**
- Consumes: extended IPC types (Task 10).
- Produces: `create(input & { projectIds })`, `update(id, input & { projectIds })`; contract view objects now carry `groupId`/`projectIds`; `OverlapErrorInfo` gains `conflictingProjectName`.

- [ ] **Step 1: Implement** — thread `projectIds` through the `contracts:create`/`contracts:update` invoke payloads; widen `OverlapErrorInfo` to include `conflictingProjectId`/`conflictingProjectName` from the response.
- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` (accept the known pre-existing drift noted in project CLAUDE.md; no *new* errors).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/state/useContracts.ts
git commit -m "feat(contracts): desktop useContracts threads projectIds + group info"
```

### Task 13: `ContractDrawer` — "shared with projects" multi-select

**Files:**
- Modify: `apps/desktop/src/components/timetracker/ContractDrawer.tsx` (`Draft:42`, submit `:125-131`, props `:28-41`)
- Test: none new (MUI form; validated by run in Task 15). Follow the existing Autocomplete usage in the codebase (search `apps/desktop/src` for `Autocomplete` — e.g. the project/epic pickers).

**Interfaces:**
- Consumes: the full work-project list (add a prop `allProjects: {id: number; name: string}[]` from the parent, or the existing projects hook), `useContracts.create/update` (Task 12), the editing contract's `projectIds` (Task 11 view).
- Produces: on submit, `projectIds = [thisProjectId, ...selectedProjectIds]`; on edit of a grouped contract, the multi-select is pre-populated from `contract.projectIds` minus the current project.

- [ ] **Step 1: Implement**
  - Add `sharedProjectIds: number[]` to `Draft`; seed from `props.contract?.projectIds` (excluding the current project) on open.
  - Render an MUI `Autocomplete multiple` of other `work` projects (exclude the current project and archived), labelled "Sdíleno s projekty (volitelné)".
  - In the submit builder, set `projectIds: [props.projectId, ...draft.sharedProjectIds]`.
  - On overlap error, show the returned `conflictingProjectName` in the existing error surface (e.g. "Překryv smlouvy u projektu {name}").
- [ ] **Step 2: Typecheck** — `npx tsc -p apps/desktop/tsconfig.json --noEmit` (no new errors).
- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/timetracker/ContractDrawer.tsx
git commit -m "feat(contracts): desktop drawer shared-with-projects multi-select"
```

### Task 14: `RateHistorySection` — shared badge + member list

**Files:**
- Modify: `apps/desktop/src/components/timetracker/RateHistorySection.tsx` (`ActiveContractCard`, `RateRow`)
- Test: none new (validated by run in Task 15).

**Interfaces:**
- Consumes: `contract.groupId`, `contract.projectIds` (Task 11 view).
- Produces: when `groupId != null`, a chip "Sdílená smlouva · {N} projektů" and the member project names near the contract row/card; the MD progress bar already reflects the pool (Task 7). Pass `allProjects` for id→name.

- [ ] **Step 1: Implement** — conditional `<Chip>` + a small member-name line; reuse existing chip styling in the file.
- [ ] **Step 2: Typecheck** — no new errors.
- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/timetracker/RateHistorySection.tsx
git commit -m "feat(contracts): desktop shared-contract badge + members"
```

### Task 15: Desktop verification (manual, with evidence)

**Files:** none.

- [ ] **Step 1** — `npm run dev`, open a work project's Contracts section, create a contract and share it with a second project. Confirm: the contract appears on both projects; the MD "remaining" is pooled and identical on both; editing the rate on one reflects on the other; deleting removes it from both; sharing with a project that has an overlapping contract shows the named-project error.
- [ ] **Step 2** — Use the `verify` skill to drive the flow; capture a screen recording/screenshots as evidence (UI iteration rule).
- [ ] **Step 3** — no commit (verification only); note results in the PR description.

---

## Phase 6 — iPad/iPhone UI (Supabase billing module)

### Task 16: `useContractMutations` group-aware create/update/delete

**Files:**
- Modify: `packages/data-supabase/src/useContractMutations.ts`
- Modify: `packages/data-supabase/src/billingWrites.ts` (add `contract_group_id` to `buildContractInsert`/`buildContractUpdate`; add `buildOptimisticContractRow` group field)
- Modify: `packages/data-supabase/src/useBilling.ts:145` (select `contract_group_id`) and `packages/data-supabase/src/billingCache.ts` mapper (`mapContractRow`, add `contractGroupId`)
- Modify: `packages/shared/src/billing/types.ts` (`ContractRow` gains `contractGroupId: string | null`)
- Test: `tests/ipad/*` or a new `tests/data-supabase/useContractMutations.test.ts` mirroring existing mutation tests (mock `getSupabase()`); assert group create writes N rows with one group id, update propagates + diffs membership, delete removes all.

**Interfaces:**
- Consumes: `contractsOverlap` (existing), `ContractRow.contractGroupId`.
- Produces: `createContract(input, projectIds)` / `updateContract(syncId, input, projectIds)` / `deleteContract(syncId)` handle groups; optimistic cache + `rebillProjectWorklogs` across all member projects; overlap pre-check per target project names the conflict.

- [ ] **Step 1: Write the failing test** — group create writes 3 Supabase rows sharing a `contract_group_id`; overlap on one target aborts without writing; delete of a grouped row removes all members from the cache.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Implement**
  - Add `contract_group_id` to the select in `useBilling.ts:145` and to `mapContractRow`.
  - `createContract`: if `projectIds.length > 1`, mint `groupId = crypto.randomUUID()`; for each project run the existing per-project overlap check against that project's cached contracts (naming the first conflict); build N insert rows with `contract_group_id = groupId` + one `sync_id` each; write them; optimistic-apply all; `rebillProjectWorklogs` per project. Reuse the existing auto-close-prior logic per project.
  - `updateContract`: when the row has a `contractGroupId`, update every cached/remote row in the group with new terms and reconcile membership (insert new-project rows, soft-delete removed-project rows), rebill each.
  - `deleteContract`: when grouped, soft-delete all rows sharing the group id.
- [ ] **Step 4: Run test to verify it passes**; then `npm run build -w @watchtower/shared && npm run build -w @watchtower/data-supabase` (or repo build).
- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/types.ts packages/data-supabase/src/useContractMutations.ts packages/data-supabase/src/billingWrites.ts packages/data-supabase/src/useBilling.ts packages/data-supabase/src/billingCache.ts tests/**/useContractMutations.test.ts
git commit -m "feat(contracts): iPad group-aware contract mutations"
```

### Task 17: iPad `ProjectDetailView` drawer + shared badge

**Files:**
- Modify: `packages/module-timetracker/src/billing/ProjectDetailView.tsx` (inline `ContractDrawer:143`, contract rows `:633-686`, `useContractMutations` wiring `:353,:872-883`)
- Test: none new (validated by device/sim run). Follow existing inline-drawer patterns; this module is plain React + inline styles — **no MUI** (per project convention).

**Interfaces:**
- Consumes: Task 16 mutations, `contract.contractGroupId`, `data.projects` for id→name.
- Produces: a multi-select (plain React, inline-styled) of other work projects in the drawer; on save pass `projectIds`; a "Sdílená smlouva · N projektů" badge on grouped contract rows.

- [ ] **Step 1: Implement** — mirror Task 13/14 semantics using the module's existing inline-styled controls (no MUI). Pre-populate membership from the group's rows in `data.contracts`.
- [ ] **Step 2: Typecheck** — `npm run typecheck:ci` (covers apps/ipad, apps/iphone, packages).
- [ ] **Step 3: Commit**

```bash
git add packages/module-timetracker/src/billing/ProjectDetailView.tsx
git commit -m "feat(contracts): iPad/iPhone shared-contract drawer + badge"
```

### Task 18: Full verification + typecheck gate

**Files:** none.

- [ ] **Step 1** — `npm test` (full suite, expect 987 + new tests, all green).
- [ ] **Step 2** — `npm run typecheck:ci` (all workspaces clean of *new* errors).
- [ ] **Step 3** — Build iPad on-device per the deploy runbook (dev creds; `.env` copied into any worktree) and confirm the shared-contract UI on device where feasible; iPhone reads shared contracts correctly.
- [ ] **Step 4** — Open the PR; body summarizes the feature, links the spec, and notes the deferred Postgres tombstone-unique fix as out of scope.

---

## Self-Review Notes (author)

- **Spec coverage:** data model + migrations (T1–T2), sync (T3), group ops (T4–T6), pooled MD (T7), report/dashboard dedupe (T8), shared burn (T9), IPC (T10–T11), desktop UI (T12–T15), iPad/iPhone UI (T16–T17), verification (T18). All spec sections mapped.
- **Type consistency:** `contractGroupId` (repo/TS) ↔ `contract_group_id` (DB/PostgREST) used consistently; `GroupTerms`, `createGroup`/`updateGroup`/`deleteGroup`/`listGroupMembers`, `RateOverlapError.conflictingProjectId`, `ContractViewPayload.groupId`/`projectIds`, `ContractInputPayload.projectIds` are defined once (T4–T6, T10) and consumed by the same names downstream.
- **Edge cases from spec:** overlap-names-project (T5, T11, T16), unlink-last dissolves group (T6 `updateGroup` removal + T18 manual), tombstone resurrection composes (T4 `insertOrResurrect`), md_limit single-source rewrite (T6/T16), concurrent-divergence explicitly out of scope.
- **Known drift:** desktop/client typecheck has pre-existing errors (project CLAUDE.md) — tasks require "no *new* errors", not a clean slate.
