import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PingsRepo } from '../../orchestrator/db/repositories/pings.js';

function db() { const d = new Database(':memory:'); runMigrations(d as never); return d; }

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
