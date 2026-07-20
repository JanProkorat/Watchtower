// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

describe('instances.worktree_path (v25)', () => {
  it('round-trips worktreePath through insert/get', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db as any);
    const repo = new InstancesRepo(db as any);
    repo.insert({
      id: 'i1', cwd: '/tmp/wt', status: 'spawning', claudeSessionId: 'i1',
      spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null,
      resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'claude',
      taskId: null, worktreePath: '/home/u/.watchtower/worktrees/repo-pr7',
    });
    expect(repo.get('i1')?.worktreePath).toBe('/home/u/.watchtower/worktrees/repo-pr7');
  });

  it('defaults worktreePath to null for rows that do not set it', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db as any);
    const repo = new InstancesRepo(db as any);
    repo.insert({
      id: 'i2', cwd: '/tmp', status: 'working', claudeSessionId: null,
      spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null,
      resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'shell',
      taskId: null, worktreePath: null,
    });
    expect(repo.get('i2')?.worktreePath).toBeNull();
  });
});
