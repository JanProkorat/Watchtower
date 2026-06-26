import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PushDevicesRepo } from '../../orchestrator/db/repositories/pushDevices.js';

// node:sqlite (no native ABI) like the other orchestrator tests — keeps the
// suite independent of how better-sqlite3 is compiled (Node vs Electron).
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function db() { const d = new DatabaseSync(':memory:'); runMigrations(d as never); return d; }

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
