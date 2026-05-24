import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('WorklogsRepo', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let worklogs: WorklogsRepo;

  let projectId: number;
  let epicId: number;
  let taskId: number;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);

    const project = projects.create({ name: 'Watchtower', color: '#7aa7ff' });
    projectId = project.id;
    epicId = epics.create({ projectId, name: 'Phase 16' }).id;
    taskId = tasks.create({ epicId, number: 'WT-T1', title: 'Worklog work' }).id;
  });

  describe('create', () => {
    it('creates a worklog with defaults (source=manual, jira_uploaded=false)', () => {
      const w = worklogs.create({ taskId, workDate: '2026-05-24', minutes: 60 });
      expect(w.source).toBe('manual');
      expect(w.jiraUploaded).toBe(false);
      expect(w.minutes).toBe(60);
      expect(w.taskNumber).toBe('WT-T1');
      expect(w.taskTitle).toBe('Worklog work');
      expect(w.projectName).toBe('Watchtower');
      expect(w.projectColor).toBe('#7aa7ff');
      expect(w.epicName).toBe('Phase 16');
    });

    it('preserves an explicit source (e.g. watchtower-auto)', () => {
      const w = worklogs.create({
        taskId,
        workDate: '2026-05-24',
        minutes: 30,
        source: 'watchtower-auto',
        externalId: 'sha-abc',
      });
      expect(w.source).toBe('watchtower-auto');
      expect(w.externalId).toBe('sha-abc');
    });

    it('CHECK constraint rejects minutes <= 0', () => {
      expect(() => worklogs.create({ taskId, workDate: '2026-05-24', minutes: 0 })).toThrow();
    });
  });

  describe('list filters', () => {
    let otherProject: number;
    let otherTask: number;

    beforeEach(() => {
      otherProject = projects.create({ name: 'PPS', color: '#f0a868' }).id;
      const otherEpic = epics.create({ projectId: otherProject, name: 'FIE' }).id;
      otherTask = tasks.create({ epicId: otherEpic, number: 'FIE-1', title: 'RFP' }).id;

      worklogs.create({ taskId, workDate: '2026-05-20', minutes: 60, description: 'a' });
      worklogs.create({ taskId, workDate: '2026-05-22', minutes: 90, description: 'b', source: 'watchtower-auto', externalId: 'x1' });
      worklogs.create({ taskId, workDate: '2026-05-24', minutes: 30, description: 'c' });
      worklogs.create({ taskId: otherTask, workDate: '2026-05-22', minutes: 45, description: 'other proj' });
    });

    it('lists newest day first, newest row within a day first', () => {
      const rows = worklogs.list({});
      expect(rows.map((r) => r.workDate)).toEqual([
        '2026-05-24',
        '2026-05-22',
        '2026-05-22',
        '2026-05-20',
      ]);
    });

    it('projectId narrows to the requested project', () => {
      const rows = worklogs.list({ projectId });
      expect(rows.length).toBe(3);
      expect(rows.every((r) => r.projectId === projectId)).toBe(true);
    });

    it('taskId narrows to the requested task', () => {
      const rows = worklogs.list({ taskId: otherTask });
      expect(rows.length).toBe(1);
      expect(rows[0]?.description).toBe('other proj');
    });

    it('from/to bracket the date range inclusively', () => {
      const rows = worklogs.list({ from: '2026-05-22', to: '2026-05-22' });
      expect(rows.map((r) => r.description).sort()).toEqual(['b', 'other proj']);
    });

    it('source filter matches exactly', () => {
      const rows = worklogs.list({ source: 'watchtower-auto' });
      expect(rows.length).toBe(1);
      expect(rows[0]?.description).toBe('b');
    });

    it('search matches description / task title / task number', () => {
      expect(worklogs.list({ search: 'other' }).length).toBe(1);
      expect(worklogs.list({ search: 'WT-T1' }).length).toBe(3);
      expect(worklogs.list({ search: 'WORKLOG' }).length).toBe(3); // title match, case-insensitive
      expect(worklogs.list({ search: 'no-match-anywhere' }).length).toBe(0);
    });

    it('filters combine as AND', () => {
      const rows = worklogs.list({
        projectId,
        from: '2026-05-22',
        source: 'watchtower-auto',
      });
      expect(rows.length).toBe(1);
      expect(rows[0]?.description).toBe('b');
    });

    it('empty search string is ignored (does not filter to nothing)', () => {
      const rows = worklogs.list({ search: '   ' });
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('update', () => {
    it('updates description / workDate / minutes', () => {
      const w = worklogs.create({ taskId, workDate: '2026-05-24', minutes: 30 });
      const u = worklogs.update(w.id, { description: 'edited', workDate: '2026-05-25', minutes: 45 });
      expect(u.description).toBe('edited');
      expect(u.workDate).toBe('2026-05-25');
      expect(u.minutes).toBe(45);
    });

    it('does NOT change the source (origin is immutable)', () => {
      const w = worklogs.create({
        taskId,
        workDate: '2026-05-24',
        minutes: 60,
        source: 'jira-sync',
        externalId: 'JIRA-1',
      });
      // Attempt to flip source via update — should be ignored
      worklogs.update(w.id, { source: 'manual' } as unknown as { jiraUploaded: boolean });
      const after = worklogs.get(w.id);
      expect(after?.source).toBe('jira-sync');
      expect(after?.externalId).toBe('JIRA-1');
    });

    it('can move a worklog to a different task', () => {
      const otherEpic = epics.create({ projectId, name: 'E2' }).id;
      const otherTask = tasks.create({ epicId: otherEpic, number: 'T2', title: 'Other' }).id;
      const w = worklogs.create({ taskId, workDate: '2026-05-24', minutes: 30 });
      worklogs.update(w.id, { taskId: otherTask });
      const after = worklogs.get(w.id);
      expect(after?.taskId).toBe(otherTask);
      expect(after?.epicName).toBe('E2');
    });
  });

  describe('delete', () => {
    it('removes the row', () => {
      const w = worklogs.create({ taskId, workDate: '2026-05-24', minutes: 30 });
      worklogs.delete(w.id);
      expect(worklogs.get(w.id)).toBeNull();
    });
  });

  describe('cascade behaviour', () => {
    it('deleting the parent task removes its worklogs', () => {
      worklogs.create({ taskId, workDate: '2026-05-24', minutes: 60 });
      worklogs.create({ taskId, workDate: '2026-05-25', minutes: 30 });
      tasks.delete(taskId);
      expect(worklogs.list({ projectId }).length).toBe(0);
    });
  });

  describe('partial unique index on (source, external_id)', () => {
    it('rejects duplicates when both are non-null', () => {
      worklogs.create({
        taskId,
        workDate: '2026-05-24',
        minutes: 30,
        source: 'jira-sync',
        externalId: 'JIRA-42',
      });
      expect(() =>
        worklogs.create({
          taskId,
          workDate: '2026-05-25',
          minutes: 30,
          source: 'jira-sync',
          externalId: 'JIRA-42',
        }),
      ).toThrow();
    });

    it('allows duplicates when source is null', () => {
      worklogs.create({ taskId, workDate: '2026-05-24', minutes: 30, source: null, externalId: 'X' });
      worklogs.create({ taskId, workDate: '2026-05-25', minutes: 30, source: null, externalId: 'X' });
      expect(worklogs.list({ projectId }).length).toBe(2);
    });
  });
});
