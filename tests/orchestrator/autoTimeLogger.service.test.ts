import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
import { HookEventsRepo } from '../../orchestrator/db/repositories/hookEvents.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import { SettingsRepo } from '../../orchestrator/db/repositories/settings.js';
import { WORKLOG_LOCK_SETTING_KEY } from '../../orchestrator/db/repositories/worklogs.js';
import { AutoTimeLogger } from '../../orchestrator/services/autoTimeLogger.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const MIN = 60 * 1000;
const T = Date.parse('2026-07-03T10:00:00');

function makeInstance(over: Partial<InstanceRow> = {}): InstanceRow {
  return {
    id: 'inst-1', cwd: '/work/alpha', status: 'finished',
    claudeSessionId: null, spawnedAt: T, lastActivityAt: T, exitCode: 0,
    terminationReason: 'session-end', resumedFromInstanceId: null,
    jiraKeyHint: null, argsJson: null, kind: 'claude', taskId: null, background: false, ...over,
  };
}

function seedProject(sqlite: SqliteLike, autoTrack: boolean): number {
  return new ProjectsRepo(sqlite).create({ name: 'Alpha', folderPath: '/work/alpha', autoTrack }).id;
}

function seedPings(sqlite: SqliteLike, instanceId: string) {
  const h = new HookEventsRepo(sqlite);
  h.append(instanceId, 'SessionStart', {}, T);
  h.append(instanceId, 'UserPromptSubmit', {}, T + 5 * MIN);
  h.append(instanceId, 'SessionEnd', {}, T + 8 * MIN); // 5 + 3 = 8 min
}

describe('AutoTimeLogger.onSessionEnd', () => {
  let sqlite: SqliteLike;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('does nothing when the project is not auto-tracked', () => {
    seedProject(sqlite, false);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    expect(new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' })).toHaveLength(0);
  });

  it('does nothing when the cwd matches no project', () => {
    seedProject(sqlite, true);
    const inst = makeInstance({ cwd: '/work/unknown' });
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    expect(new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' })).toHaveLength(0);
  });

  it('logs to the per-project catch-all task when untagged', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minutes).toBe(8);
    expect(rows[0]!.workDate).toBe('2026-07-03');
    expect(rows[0]!.taskNumber).toBe('AUTO');
    expect(rows[0]!.epicName).toBe('Auto-tracked');
    expect(rows[0]!.externalId).toBe('auto:inst-1:2026-07-03');
    expect(rows[0]!.reportedMinutes).toBeNull();
  });

  it('logs to the instance tagged task when set', () => {
    const pid = seedProject(sqlite, true);
    const e = new EpicsRepo(sqlite).create({ projectId: pid, name: 'Feature' });
    const t = new TasksRepo(sqlite).create({ epicId: e.id, number: 'F-1', title: 'Do it' });
    const inst = makeInstance({ taskId: t.id });
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe(t.id);
  });

  it('is idempotent — a re-fire updates in place, no duplicate row', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    const logger = new AutoTimeLogger(sqlite);
    logger.onSessionEnd(inst);
    logger.onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minutes).toBe(8);
  });

  it('accrues more minutes when new activity arrives before a later SessionEnd', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    const logger = new AutoTimeLogger(sqlite);
    logger.onSessionEnd(inst);
    // A new /clear'd session on the same instance adds 4 more minutes.
    const h = new HookEventsRepo(sqlite);
    h.append(inst.id, 'SessionStart', {}, T + 20 * MIN);
    h.append(inst.id, 'SessionEnd', {}, T + 24 * MIN);
    logger.onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    // 8 (first) + capped(20→cap 10) + 4 = 8 + 10 + 4 = 22
    expect(rows[0]!.minutes).toBe(22);
  });

  it('calls onChange when it writes', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    let changed = 0;
    new AutoTimeLogger(sqlite, () => { changed++; }).onSessionEnd(inst);
    expect(changed).toBe(1);
  });

  it('matches a `~`-prefixed folderPath via home expansion', () => {
    const cwd = path.join(homedir(), 'wt-autolog-test');
    new ProjectsRepo(sqlite).create({ name: 'Home', folderPath: '~/wt-autolog-test', autoTrack: true });
    const inst = makeInstance({ cwd });
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
  });

  it('falls back to the catch-all when the tagged task is done', () => {
    const pid = seedProject(sqlite, true);
    const e = new EpicsRepo(sqlite).create({ projectId: pid, name: 'Feature' });
    const t = new TasksRepo(sqlite).create({ epicId: e.id, number: 'F-1', title: 'Do it' });
    new TasksRepo(sqlite).update(t.id, { status: 'done' });
    const inst = makeInstance({ taskId: t.id });
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskNumber).toBe('AUTO');
  });

  it('does not create the empty catch-all epic/task when activity rounds to under a minute', () => {
    const pid = seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    const h = new HookEventsRepo(sqlite);
    h.append(inst.id, 'SessionStart', {}, T);
    h.append(inst.id, 'SessionEnd', {}, T + 20 * 1000); // 20s — rounds to 0 minutes
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    expect(new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' })).toHaveLength(0);
    expect(new EpicsRepo(sqlite).listForProject(pid).some((e) => e.name === 'Auto-tracked')).toBe(false);
  });

  it('skips a date whose worklog would land on or before the locked-through setting', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new SettingsRepo(sqlite).set(WORKLOG_LOCK_SETTING_KEY, '2999-01-01');
    let changed = 0;
    new AutoTimeLogger(sqlite, () => { changed++; }).onSessionEnd(inst);
    expect(new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' })).toHaveLength(0);
    expect(changed).toBe(0);
  });
});
