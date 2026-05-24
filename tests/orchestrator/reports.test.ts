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
import { ProjectRatesRepo } from '../../orchestrator/db/repositories/projectRates.js';
import { ReportsService } from '../../orchestrator/db/reports.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('ReportsService', () => {
  let db: SqliteLike;
  let reports: ReportsService;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let worklogs: WorklogsRepo;
  let rates: ProjectRatesRepo;

  beforeEach(() => {
    db = freshDb();
    reports = new ReportsService(db);
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);
    rates = new ProjectRatesRepo(db);
  });

  function seedSingleTaskWithWorklogs(opts: {
    kind?: 'work' | 'time_off';
    minutesByDate: Record<string, number>;
  }) {
    const project = projects.create({ name: 'P', color: '#7aa7ff', kind: opts.kind ?? 'work' });
    const epic = epics.create({ projectId: project.id, name: 'E' });
    const task = tasks.create({ epicId: epic.id, number: 'T-1', title: 'T' });
    for (const [date, mins] of Object.entries(opts.minutesByDate)) {
      worklogs.create({ taskId: task.id, workDate: date, minutes: mins });
    }
    return { project, task };
  }

  describe('trend', () => {
    it('aggregates minutes per day bucket', () => {
      seedSingleTaskWithWorklogs({
        minutesByDate: {
          '2026-05-04': 60,
          '2026-05-05': 90,
          '2026-05-12': 30,
        },
      });
      const rows = reports.trend('2026-05-01', '2026-05-31', 'day');
      expect(rows.map((r) => r.bucket)).toEqual(['2026-05-04', '2026-05-05', '2026-05-12']);
      expect(rows.map((r) => r.minutes)).toEqual([60, 90, 30]);
    });

    it('collapses into one row per month at month granularity', () => {
      seedSingleTaskWithWorklogs({
        minutesByDate: {
          '2026-04-15': 60,
          '2026-05-05': 90,
          '2026-05-20': 30,
        },
      });
      const rows = reports.trend('2026-01-01', '2026-12-31', 'month');
      expect(rows).toEqual([
        { bucket: '2026-04', minutes: 60, earnedByCurrency: {} },
        { bucket: '2026-05', minutes: 120, earnedByCurrency: {} },
      ]);
    });

    it('attaches earnings per bucket per currency when a contract is in place', () => {
      const { project } = seedSingleTaskWithWorklogs({
        minutesByDate: { '2026-05-04': 60 },
      });
      rates.create({
        projectId: project.id,
        effectiveFrom: '2026-01-01',
        rateType: 'hourly',
        rateAmount: 1600,
        currency: 'CZK',
      });
      // Make the project billable (the verbatim TT schema column is_billable
      // isn't auto-set by repo.create when kind=work in non-default seeds,
      // so set it explicitly here).
      db.prepare(`UPDATE projects SET is_billable = 1 WHERE id = ?`).run(project.id);
      const rows = reports.trend('2026-05-01', '2026-05-31', 'day');
      expect(rows[0]?.earnedByCurrency).toEqual({ CZK: 1600 });
    });
  });

  describe('byProject', () => {
    it('returns one row per project with worklogs in range', () => {
      const a = projects.create({ name: 'A', color: '#7aa7ff' });
      const b = projects.create({ name: 'B', color: '#f0a868' });
      const ae = epics.create({ projectId: a.id, name: 'EA' });
      const be = epics.create({ projectId: b.id, name: 'EB' });
      const at = tasks.create({ epicId: ae.id, number: 'A-1', title: 'a' });
      const bt = tasks.create({ epicId: be.id, number: 'B-1', title: 'b' });
      worklogs.create({ taskId: at.id, workDate: '2026-05-05', minutes: 60 });
      worklogs.create({ taskId: bt.id, workDate: '2026-05-05', minutes: 120 });

      const rows = reports.byProject('2026-05-01', '2026-05-31');
      // Sorted by minutes DESC
      expect(rows.map((r) => r.projectName)).toEqual(['B', 'A']);
      expect(rows[0]?.minutes).toBe(120);
      expect(rows[1]?.minutes).toBe(60);
    });

    it('excludes projects with no worklogs in the range', () => {
      const a = projects.create({ name: 'A' });
      const b = projects.create({ name: 'B' });
      const ae = epics.create({ projectId: a.id, name: 'EA' });
      const at = tasks.create({ epicId: ae.id, number: 'A-1', title: 'a' });
      worklogs.create({ taskId: at.id, workDate: '2026-05-05', minutes: 60 });
      // Project B has an epic + task but no worklogs.
      epics.create({ projectId: b.id, name: 'EB' });

      const rows = reports.byProject('2026-05-01', '2026-05-31');
      expect(rows.map((r) => r.projectName)).toEqual(['A']);
    });
  });

  describe('earnings', () => {
    it('splits billable / unbillable / time_off across the right buckets', () => {
      const work = projects.create({ name: 'Work', kind: 'work' });
      db.prepare(`UPDATE projects SET is_billable = 1 WHERE id = ?`).run(work.id);
      const off = projects.create({ name: 'TO', kind: 'time_off' });
      for (const p of [work, off]) {
        const e = epics.create({ projectId: p.id, name: 'E' });
        const t = tasks.create({ epicId: e.id, number: `${p.name}-T`, title: 'X' });
        worklogs.create({ taskId: t.id, workDate: '2026-05-10', minutes: 60 });
      }
      const res = reports.earnings('2026-05-01', '2026-05-31');
      expect(res.billableMinutes).toBe(60);
      expect(res.timeOffMinutes).toBe(60);
      expect(res.unbillableMinutes).toBe(0);
    });
  });

  describe('heatmap', () => {
    it('returns one row per day with summed minutes', () => {
      seedSingleTaskWithWorklogs({
        minutesByDate: {
          '2026-05-04': 60,
          '2026-05-05': 30,
        },
      });
      const rows = reports.heatmap('2026-05-01', '2026-05-31');
      expect(rows).toEqual([
        { date: '2026-05-04', minutes: 60 },
        { date: '2026-05-05', minutes: 30 },
      ]);
    });
  });

  describe('rateChanges', () => {
    it('excludes the first rate row per project (not a "change")', () => {
      const { project } = seedSingleTaskWithWorklogs({ minutesByDate: {} });
      rates.create({
        projectId: project.id,
        effectiveFrom: '2026-01-01',
        rateType: 'hourly',
        rateAmount: 1000,
        currency: 'CZK',
      });
      rates.create({
        projectId: project.id,
        effectiveFrom: '2026-05-15',
        rateType: 'hourly',
        rateAmount: 1500,
        currency: 'CZK',
      });
      const rows = reports.rateChanges('2026-01-01', '2026-12-31');
      expect(rows.map((r) => r.effectiveFrom)).toEqual(['2026-05-15']);
      expect(rows[0]?.rateAmount).toBe(1500);
    });
  });

  describe('contracts', () => {
    it('lists projects whose active contract has an end_date or md_limit', () => {
      const p1 = projects.create({ name: 'Has limit', kind: 'work' });
      const p2 = projects.create({ name: 'No bounds', kind: 'work' });
      rates.create({
        projectId: p1.id,
        effectiveFrom: '2024-01-01',
        rateType: 'hourly',
        rateAmount: 1000,
        currency: 'CZK',
        mdLimit: 100,
      });
      rates.create({
        projectId: p2.id,
        effectiveFrom: '2024-01-01',
        rateType: 'hourly',
        rateAmount: 1000,
        currency: 'CZK',
      });
      const rows = reports.contracts();
      // Only the one with an explicit limit shows up.
      expect(rows.map((r) => r.projectName)).toEqual(['Has limit']);
    });
  });
});
