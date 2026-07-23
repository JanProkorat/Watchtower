import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';

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
    taskId: null,
    background: false,
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

describe('InstancesRepo taskId', () => {
  let db: SqliteLike;
  let repo: InstancesRepo;

  // Seeds a project → epic → task chain and returns the new task id, so the
  // task_id FK on instances is satisfiable.
  function seedTask(): number {
    db.prepare(
      `INSERT INTO projects (name, color, archived, is_billable, kind, is_pinned)
       VALUES ('P', '#fff', 0, 1, 'work', 0)`,
    ).run();
    const projId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(`INSERT INTO epics (project_id, name, status) VALUES (?, 'E', 'active')`).run(projId);
    const epicId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(`INSERT INTO tasks (epic_id, number, title, status) VALUES (?, '1', 'T', 'open')`).run(epicId);
    return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
  }

  beforeEach(() => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = ON');
    runMigrations(raw as unknown as SqliteLike);
    db = raw as unknown as SqliteLike;
    repo = new InstancesRepo(db);
  });

  it('defaults task_id to null on insert', () => {
    repo.insert(baseRow({ id: 'i-default' }));
    expect(repo.get('i-default')?.taskId).toBeNull();
  });

  it('setTask round-trips a non-null taskId', () => {
    const taskId = seedTask();
    repo.insert(baseRow({ id: 'i-tagged' }));
    repo.setTask('i-tagged', taskId);
    expect(repo.get('i-tagged')?.taskId).toBe(taskId);
  });

  it('setTask clears to null', () => {
    const taskId = seedTask();
    repo.insert(baseRow({ id: 'i-clear' }));
    repo.setTask('i-clear', taskId);
    repo.setTask('i-clear', null);
    expect(repo.get('i-clear')?.taskId).toBeNull();
  });

  it('ON DELETE SET NULL: deleting the tagged task nulls the instance task_id', () => {
    const taskId = seedTask();
    repo.insert(baseRow({ id: 'i-fk' }));
    repo.setTask('i-fk', taskId);
    expect(repo.get('i-fk')?.taskId).toBe(taskId);

    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    expect(repo.get('i-fk')?.taskId).toBeNull();
  });
});

describe('InstancesRepo background', () => {
  let db: SqliteLike;
  let repo: InstancesRepo;

  beforeEach(() => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    const raw = new DatabaseSync(dbPath);
    runMigrations(raw as unknown as SqliteLike);
    db = raw as unknown as SqliteLike;
    repo = new InstancesRepo(db);
  });

  it('round-trips background: true', () => {
    repo.insert(baseRow({ id: 'bg1', background: true }));
    expect(repo.get('bg1')?.background).toBe(true);
  });

  it('defaults background to false when omitted from an inserted row object', () => {
    repo.insert(baseRow({ id: 'bg-default' }));
    expect(repo.get('bg-default')?.background).toBe(false);
  });

  it('listInstances excludes background rows', () => {
    const base = { cwd: '/x', status: 'idle-notify' as const, claudeSessionId: null, spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null, resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'claude' as const, taskId: null };
    repo.insert({ ...base, id: 'visible', background: false });
    repo.insert({ ...base, id: 'hidden', background: true });
    const ids = repo.listAll().filter((r) => !r.background).map((r) => r.id);
    expect(ids).toEqual(['visible']);
  });
});
