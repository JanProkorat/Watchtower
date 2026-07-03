import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

describe('projects.auto_track', () => {
  let sqlite: SqliteLike;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('defaults autoTrack to false', () => {
    const repo = new ProjectsRepo(sqlite);
    const p = repo.create({ name: 'Alpha' });
    expect(p.autoTrack).toBe(false);
  });

  it('round-trips autoTrack via create and update', () => {
    const repo = new ProjectsRepo(sqlite);
    const p = repo.create({ name: 'Beta', autoTrack: true });
    expect(p.autoTrack).toBe(true);
    const off = repo.update(p.id, { autoTrack: false });
    expect(off.autoTrack).toBe(false);
    const on = repo.update(p.id, { autoTrack: true });
    expect(on.autoTrack).toBe(true);
  });
});
