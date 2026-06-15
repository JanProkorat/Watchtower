import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import type { InstanceRow } from '../../shared/stateModel.js';

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
