import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PushDevicesRepo } from '../../orchestrator/db/repositories/pushDevices.js';

function db() { const d = new Database(':memory:'); runMigrations(d as never); return d; }

describe('PushDevicesRepo', () => {
  it('registers (idempotent on token), lists, removes', () => {
    const repo = new PushDevicesRepo(db() as never);
    repo.register('tokA', 'ios', 1);
    repo.register('tokA', 'ios', 2); // upsert, no dup
    repo.register('tokB', 'ios', 3);
    expect(repo.listTokens().sort()).toEqual(['tokA', 'tokB']);
    repo.remove('tokA');
    expect(repo.listTokens()).toEqual(['tokB']);
  });
});
