import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import { HookEventsRepo } from '../../orchestrator/db/repositories/hookEvents.js';
import { NotificationsRepo } from '../../orchestrator/db/repositories/notifications.js';
import { SettingsRepo } from '../../orchestrator/db/repositories/settings.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function makeRow(overrides: Partial<InstanceRow> = {}): InstanceRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cwd: '/tmp/x',
    status: 'spawning',
    claudeSessionId: null,
    spawnedAt: 1,
    lastActivityAt: 1,
    exitCode: null,
    terminationReason: null,
    resumedFromInstanceId: null,
    jiraKeyHint: null,
    argsJson: null,
    kind: 'claude',
    worktreePath: null,
    taskId: null,
    background: false,
    ...overrides,
  };
}

describe('repositories', () => {
  let db: InstanceType<typeof DatabaseSync>;
  let sqlite: SqliteLike;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('InstancesRepo round-trips a row', () => {
    const repo = new InstancesRepo(sqlite);
    repo.insert(makeRow());
    const found = repo.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(found?.cwd).toBe('/tmp/x');
    expect(found?.status).toBe('spawning');
  });

  it('InstancesRepo.listLive returns only live statuses', () => {
    const repo = new InstancesRepo(sqlite);
    repo.insert(makeRow({ id: '1', cwd: '/a', status: 'working' }));
    repo.insert(makeRow({ id: '2', cwd: '/b', status: 'finished', exitCode: 0, terminationReason: 'session-end' }));
    expect(repo.listLive().map((r) => r.id)).toEqual(['1']);
  });

  it('InstancesRepo.liveByCwd narrows to live rows with matching cwd', () => {
    const repo = new InstancesRepo(sqlite);
    repo.insert(makeRow({ id: '1', cwd: '/a', status: 'working' }));
    repo.insert(makeRow({ id: '2', cwd: '/a', status: 'waiting-permission' }));
    repo.insert(makeRow({ id: '3', cwd: '/b', status: 'working' }));
    // Finished rows are excluded.
    repo.insert(makeRow({ id: '4', cwd: '/a', status: 'finished', exitCode: 0, terminationReason: 'session-end' }));

    expect(repo.liveByCwd('/a').map((r) => r.id).sort()).toEqual(['1', '2']);
    expect(repo.liveByCwd('/b').map((r) => r.id)).toEqual(['3']);
    expect(repo.liveByCwd('/nowhere')).toEqual([]);
  });

  it('InstancesRepo.reorder rewrites display_order so listAll honors the new order', () => {
    const repo = new InstancesRepo(sqlite);
    repo.insert(makeRow({ id: 'a', cwd: '/a' }));
    repo.insert(makeRow({ id: 'b', cwd: '/b' }));
    repo.insert(makeRow({ id: 'c', cwd: '/c' }));
    expect(repo.listAll().map((r) => r.id)).toEqual(['a', 'b', 'c']);
    repo.reorder(['c', 'a', 'b']);
    expect(repo.listAll().map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('InstancesRepo.updateStatus + setTermination + setClaudeSessionId', () => {
    const repo = new InstancesRepo(sqlite);
    repo.insert(makeRow({ id: '1' }));
    repo.updateStatus('1', 'working', 100);
    repo.setClaudeSessionId('1', 'sess-1');
    repo.setTermination('1', 'crash', 137);
    const after = repo.get('1');
    expect(after?.status).toBe('working');
    expect(after?.lastActivityAt).toBe(100);
    expect(after?.claudeSessionId).toBe('sess-1');
    expect(after?.terminationReason).toBe('crash');
    expect(after?.exitCode).toBe(137);
  });

  it('HookEventsRepo appends, lists, and prunes', () => {
    const instances = new InstancesRepo(sqlite);
    instances.insert(makeRow({ id: '1' }));
    const events = new HookEventsRepo(sqlite);
    events.append('1', 'Notification', { foo: 'bar' }, 100);
    events.append('1', 'Stop', {}, 200);
    expect(events.listForInstance('1').length).toBe(2);
    events.pruneOlderThan(150);
    const remaining = events.listForInstance('1');
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.eventName).toBe('Stop');
  });

  it('NotificationsRepo.log + dismiss', () => {
    const instances = new InstancesRepo(sqlite);
    instances.insert(makeRow({ id: '1' }));
    const notifs = new NotificationsRepo(sqlite);
    notifs.log('1', 'waiting-permission', 'Claude in x is waiting', 1000);
    const row = db.prepare(`SELECT id, dismissed_at FROM notifications WHERE instance_id = '1'`).get() as { id: number; dismissed_at: number | null };
    expect(row.id).toBeTypeOf('number');
    expect(row.dismissed_at).toBeNull();
    notifs.dismiss(row.id, 2000);
    const after = db.prepare(`SELECT dismissed_at FROM notifications WHERE id = ?`).get(row.id) as { dismissed_at: number };
    expect(after.dismissed_at).toBe(2000);
  });

  it('SettingsRepo get/set with default + getNumber', () => {
    const repo = new SettingsRepo(sqlite);
    expect(repo.getString('quiet_timer_ms', '90000')).toBe('90000');
    repo.set('quiet_timer_ms', '120000');
    expect(repo.getString('quiet_timer_ms', '90000')).toBe('120000');
    expect(repo.getNumber('quiet_timer_ms', 90000)).toBe(120000);
    expect(repo.getNumber('missing', 42)).toBe(42);
    repo.set('garbage', 'not-a-number');
    expect(repo.getNumber('garbage', 99)).toBe(99);
  });
});
