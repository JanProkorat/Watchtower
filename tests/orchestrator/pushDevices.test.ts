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
  it('register defaults bundle_id to ipad and listTokens returns {token,bundleId}', () => {
    const repo = new PushDevicesRepo(db() as never);
    repo.register('tok-ipad', 'ios', 1000);
    expect(repo.listTokens()).toEqual([{ token: 'tok-ipad', bundleId: 'cz.greencode.watchtower.ipad' }]);
  });

  it('register stores an explicit bundle_id', () => {
    const repo = new PushDevicesRepo(db() as never);
    repo.register('tok-ios', 'ios', 1000, 'cz.greencode.watchtower.ios');
    expect(repo.listTokens()).toEqual([{ token: 'tok-ios', bundleId: 'cz.greencode.watchtower.ios' }]);
  });

  it('register upsert updates bundle_id on conflict', () => {
    const repo = new PushDevicesRepo(db() as never);
    repo.register('t', 'ios', 1000, 'cz.greencode.watchtower.ipad');
    repo.register('t', 'ios', 2000, 'cz.greencode.watchtower.ios');
    expect(repo.listTokens()).toEqual([{ token: 't', bundleId: 'cz.greencode.watchtower.ios' }]);
  });

  it('registers (idempotent on token), lists, removes', () => {
    const repo = new PushDevicesRepo(db() as never);
    repo.register('tokA', 'ios', 1);
    repo.register('tokA', 'ios', 2); // upsert, no dup
    repo.register('tokB', 'ios', 3);
    expect(repo.listTokens().map((t) => t.token).sort()).toEqual(['tokA', 'tokB']);
    repo.remove('tokA');
    expect(repo.listTokens().map((t) => t.token)).toEqual(['tokB']);
  });
});
