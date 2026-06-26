import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { markWorklogsForRebill } from '../../orchestrator/db/rebill.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function seed() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db as never);
  db.exec(`INSERT INTO projects (id, sync_id, name) VALUES (1,'p1','P');`);
  db.exec(`INSERT INTO epics (id, sync_id, project_id, name) VALUES (1,'e1',1,'E');`);
  db.exec(`INSERT INTO tasks (id, sync_id, epic_id, number, title) VALUES (1,'t1',1,1,'T');`);
  db.exec(`INSERT INTO worklogs (id, sync_id, task_id, work_date, minutes, updated_at) VALUES
    (1,'w1',1,'2026-05-01',60,'2026-05-01T00:00:00.000Z'),
    (2,'w2',1,'2026-06-15',60,'2026-06-15T00:00:00.000Z');`);
  return db;
}

describe('markWorklogsForRebill', () => {
  it('bumps updated_at only for worklogs on/after fromDate', () => {
    const db = seed();
    const now = '2026-06-26T10:00:00.000Z';
    const n = markWorklogsForRebill(db as never, 1, '2026-06-01', now);
    expect(n).toBe(1);
    const w = (id: number) => (db.prepare('SELECT updated_at u FROM worklogs WHERE id=?').get(id) as { u: string }).u;
    expect(w(2)).toBe(now);                    // on/after → bumped
    expect(w(1)).toBe('2026-05-01T00:00:00.000Z'); // before → untouched
  });
});
