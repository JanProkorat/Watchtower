// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { MIGRATIONS, runMigrations } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const row = {
  id: 'i1', cwd: '/tmp', status: 'working' as const, claudeSessionId: null,
  spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null,
  resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'claude' as const,
  taskId: null, worktreePath: null, background: false,
};

describe('instances.title (v30)', () => {
  it('starts null and round-trips through setTitle', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db as any);
    const repo = new InstancesRepo(db as any);
    repo.insert(row);
    expect(repo.get('i1')?.title).toBeNull();
    repo.setTitle('i1', 'Fix sidebar auto-open');
    expect(repo.get('i1')?.title).toBe('Fix sidebar auto-open');
  });

  it('adds the column on a DB the finance branch already took to v29', () => {
    const db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS.filter((m) => m.version <= 27)) m.up(db as any);
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (29, 0)`);
    runMigrations(db as any);
    const cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('title');
  });
});
