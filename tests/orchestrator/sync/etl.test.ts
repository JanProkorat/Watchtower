import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { etlFromSqlite, type EtlReport } from '../../../orchestrator/scripts/etl-timetracker.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;

beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[etl.test] pg unreachable — skipping'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('etlFromSqlite', () => {
  it('copies projects + epics into Postgres with resolved FKs, idempotently', async () => {
    if (!reachable || !store) return;
    // Reset pg
    await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await runPgMigrations(store);

    const sqlite = freshSqlite();
    const p = new ProjectsRepo(sqlite).create({ name: 'ETL P' });
    new EpicsRepo(sqlite).create({ projectId: p.id, name: 'ETL E' });

    const r1: EtlReport = await etlFromSqlite(sqlite, store);
    expect(r1.counts.projects).toBe(1);
    expect(r1.counts.epics).toBe(1);

    const epics = await store.query(`SELECT e.name, p.name AS pname FROM epics e JOIN projects p ON p.id = e.project_id`);
    expect(epics.rows[0]).toMatchObject({ name: 'ETL E', pname: 'ETL P' });

    // Re-run is idempotent (upsert by sync_id, no dupes).
    const r2 = await etlFromSqlite(sqlite, store);
    const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM projects`);
    expect(rows[0].c).toBe('1');
    expect(r2.counts.projects).toBe(1);
  });
});
