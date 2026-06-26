import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PingsRepo } from '../../orchestrator/db/repositories/pings.js';

// node:sqlite (no native ABI) like the other orchestrator tests — keeps the
// suite independent of how better-sqlite3 is compiled (Node vs Electron).
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function db() { const d = new DatabaseSync(':memory:'); runMigrations(d as never); return d; }

describe('PingsRepo', () => {
  it('creates, gets, and marks answered', () => {
    const repo = new PingsRepo(db() as never);
    const id = repo.create({ instanceId: 'i1', kind: 'waiting-permission', title: 'api', body: 'čeká', now: 100 });
    expect(repo.get(id)).toEqual({ id, instanceId: 'i1', kind: 'waiting-permission', title: 'api', body: 'čeká', createdAt: 100, answeredAt: null });
    repo.markAnswered(id, 200);
    expect(repo.get(id)?.answeredAt).toBe(200);
    expect(repo.get(99999)).toBeNull();
  });
});
