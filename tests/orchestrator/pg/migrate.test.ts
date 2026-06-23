import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';

const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;

beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  // Safety guard: refuse to DROP SCHEMA against any non-localhost connection.
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(PG_URL)) {
    console.warn('[migrate.test] refusing DROP SCHEMA against non-localhost PG — skipping pg migration tests');
    reachable = false;
    return;
  }
  try {
    await store.healthCheck();
    reachable = true;
    // Clean slate so the run is deterministic.
    await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  } catch {
    console.warn('[migrate.test] Postgres unreachable — skipping pg migration tests');
  }
});

afterAll(async () => {
  if (store) await store.end();
});

describe('runPgMigrations', () => {
  it('creates the 6 synced tables + sync_conflicts and is idempotent', async () => {
    if (!reachable || !store) return;
    const v1 = await runPgMigrations(store);
    const v2 = await runPgMigrations(store); // second run is a no-op
    expect(v2).toBe(v1);

    const { rows } = await store.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off', 'sync_conflicts', 'pg_schema_version']) {
      expect(names).toContain(t);
    }
  });

  it('gives every synced table sync_id/updated_at/deleted_at', async () => {
    if (!reachable || !store) return;
    for (const t of ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off']) {
      const { rows } = await store.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [t],
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain('sync_id');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
    }
  });

  it('enforces the partial unique index on worklogs(source, external_id)', async () => {
    if (!reachable || !store) return;
    // Two NULL-source rows must coexist; two same (source, external_id) must not.
    await store.query(`DELETE FROM worklogs`);
    await store.query(`DELETE FROM tasks`); await store.query(`DELETE FROM epics`); await store.query(`DELETE FROM projects`);
    await store.query(`INSERT INTO projects (sync_id, name, updated_at) VALUES ('p1','P', now())`);
    const p = await store.query<{ id: number }>(`SELECT id FROM projects WHERE sync_id='p1'`);
    await store.query(`INSERT INTO epics (sync_id, project_id, name, updated_at) VALUES ('e1',$1,'E', now())`, [p.rows[0].id]);
    const e = await store.query<{ id: number }>(`SELECT id FROM epics WHERE sync_id='e1'`);
    await store.query(`INSERT INTO tasks (sync_id, epic_id, number, title, updated_at) VALUES ('t1',$1,'N','T', now())`, [e.rows[0].id]);
    const t = await store.query<{ id: number }>(`SELECT id FROM tasks WHERE sync_id='t1'`);
    const tid = t.rows[0].id;

    // Positive case: two NULL-source rows must coexist (partial index WHERE source IS NOT NULL).
    await store.query(
      `INSERT INTO worklogs (sync_id, task_id, work_date, minutes, source, external_id, updated_at)
       VALUES ('wn1',$1,'2026-01-10',30,NULL,NULL, now()), ('wn2',$1,'2026-01-11',30,NULL,NULL, now())`,
      [tid],
    );
    const { rows: nullRows } = await store.query<{ sync_id: string }>(
      `SELECT sync_id FROM worklogs WHERE source IS NULL ORDER BY sync_id`,
    );
    expect(nullRows.map((r) => r.sync_id)).toEqual(['wn1', 'wn2']);

    // Negative case: two rows with same non-null (source, external_id) must be rejected.
    await store.query(
      `INSERT INTO worklogs (sync_id, task_id, work_date, minutes, source, external_id, updated_at)
       VALUES ('w1',$1,'2026-01-01',60,'jira','X', now()), ('w2',$1,'2026-01-02',60,'jira','Y', now())`,
      [tid],
    );
    await expect(
      store.query(
        `INSERT INTO worklogs (sync_id, task_id, work_date, minutes, source, external_id, updated_at)
         VALUES ('w3',$1,'2026-01-03',60,'jira','X', now())`,
        [tid],
      ),
    ).rejects.toThrow();
  });
});
