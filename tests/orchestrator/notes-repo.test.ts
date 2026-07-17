import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { NotesRepo } from '../../orchestrator/db/repositories/notes.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('NotesRepo', () => {
  let db: SqliteLike;
  let repo: NotesRepo;
  beforeEach(() => {
    db = freshDb();
    repo = new NotesRepo(db);
  });

  it('creates a plain note (done = null, global) with defaults', () => {
    const n = repo.create({ title: 'Idea' });
    expect(n.id).toBeGreaterThan(0);
    expect(n.title).toBe('Idea');
    expect(n.body).toBe('');
    expect(n.done).toBeNull();
    expect(n.priority).toBe('none');
    expect(n.pinned).toBe(false);
    expect(n.projectId).toBeNull();
    expect(n.projectName).toBeNull();
    expect(typeof n.createdAt).toBe('string');
  });

  it('round-trips the tri-state done column (null | 0 | 1)', () => {
    const n = repo.create({ title: 't', done: 0 });
    expect(repo.get(n.id)!.done).toBe(0);
    const u1 = repo.update(n.id, { done: 1 });
    expect(u1.done).toBe(1);
    expect(u1.doneAt).not.toBeNull(); // set when done → 1
    const u2 = repo.update(n.id, { done: null });
    expect(u2.done).toBeNull();
    expect(u2.doneAt).toBeNull(); // cleared when leaving completed
  });

  it('joins project name + color, and reports Global after the project is soft-deleted', () => {
    const p = new ProjectsRepo(db).create({ name: 'Watchtower', color: '#38bdf8' });
    const n = repo.create({ title: 'scoped', projectId: p.id });
    const got = repo.get(n.id)!;
    expect(got.projectId).toBe(p.id);
    expect(got.projectName).toBe('Watchtower');
    expect(got.projectColor).toBe('#38bdf8');
    new ProjectsRepo(db).delete(p.id);
    const after = repo.get(n.id)!;
    expect(after.projectId).toBe(p.id);      // stored id unchanged
    expect(after.projectName).toBeNull();    // join yields nothing → renders Global
  });

  it('filters: scope, openTodosOnly, includeCompleted, search', () => {
    const p = new ProjectsRepo(db).create({ name: 'P' });
    repo.create({ title: 'global note' });
    repo.create({ title: 'open todo', done: 0 });
    const doneOne = repo.create({ title: 'done todo', done: 1 });
    repo.create({ title: 'project note', projectId: p.id });

    expect(repo.list({ scope: 'global' }).every((r) => r.projectId === null)).toBe(true);
    expect(repo.list({ scope: 'project', projectId: p.id }).map((r) => r.title)).toEqual(['project note']);
    expect(repo.list({ openTodosOnly: true }).map((r) => r.title)).toEqual(['open todo']);
    expect(repo.list({ includeCompleted: false }).some((r) => r.id === doneOne.id)).toBe(false);
    expect(repo.list({ search: 'GLOBAL' }).map((r) => r.title)).toEqual(['global note']);
  });

  it('soft-deletes: deleted rows disappear from reads', () => {
    const n = repo.create({ title: 'gone' });
    repo.delete(n.id);
    expect(repo.get(n.id)).toBeNull();
    expect(repo.list().some((r) => r.id === n.id)).toBe(false);
  });

  it('sorts pinned first, then priority high→low, then updated desc', () => {
    const a = repo.create({ title: 'a' });
    const b = repo.create({ title: 'b', pinned: true });
    const c = repo.create({ title: 'c', priority: 'high' });
    const rows = repo.list();
    expect(rows[0].id).toBe(b.id);          // pinned wins
    expect(rows[1].id).toBe(c.id);          // then high priority
    expect(rows[2].id).toBe(a.id);
  });
});
