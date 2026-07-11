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
import { TaskGridService } from '../../orchestrator/db/taskGrid.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

interface Seeded {
  db: SqliteLike;
  service: TaskGridService;
  projectsRepo: ProjectsRepo;
  epicsRepo: EpicsRepo;
  tasksRepo: TasksRepo;
  worklogsRepo: WorklogsRepo;
  ratesRepo: ProjectRatesRepo;
}

function seed(): Seeded {
  const db = freshDb();
  return {
    db,
    service: new TaskGridService(db),
    projectsRepo: new ProjectsRepo(db),
    epicsRepo: new EpicsRepo(db),
    tasksRepo: new TasksRepo(db),
    worklogsRepo: new WorklogsRepo(db),
    ratesRepo: new ProjectRatesRepo(db),
  };
}

describe('TaskGridService', () => {
  let s: Seeded;
  beforeEach(() => {
    s = seed();
  });

  it('returns an empty response when no worklogs exist in the month', () => {
    const res = s.service.get(2026, 5);
    expect(res.tasks).toEqual([]);
    expect(res.dailyTotalsTracked).toEqual({});
    expect(res.dailyTotalsReported).toEqual({});
    expect(res.earningsByCurrency).toEqual([]);
    expect(res.daysInMonth).toBe(31);
    // May 2026: 21 Mon-Fri days minus Labour Day (May 1) and Liberation Day
    // (May 8) — both fall on Friday — = 19 workdays × 8h × 60min = 9120.
    expect(res.monthCapacityMinutes).toBe(9120);
  });

  it('computes monthCapacityMinutes from workdays × 8h (minus public holidays)', () => {
    // Feb 2026: 20 weekdays, no Czech holidays. 20 × 8 × 60 = 9600.
    expect(s.service.get(2026, 2).monthCapacityMinutes).toBe(9600);
    // Aug 2026: 21 weekdays, no Czech holidays. 21 × 8 × 60 = 10080.
    expect(s.service.get(2026, 8).monthCapacityMinutes).toBe(10080);
    // May 2026: 21 weekdays - 2 holidays (May 1, May 8) = 19 workdays.
    expect(s.service.get(2026, 5).monthCapacityMinutes).toBe(9120);
  });

  it('returns the Czech public holidays that fall inside the displayed month', () => {
    const may = s.service.get(2026, 5);
    expect(may.publicHolidays).toEqual([
      { date: '2026-05-01', name: 'Labour Day' },
      { date: '2026-05-08', name: 'Liberation Day' },
    ]);
    // April 2026 carries Good Friday and Easter Monday (Easter Sunday = Apr 5).
    const apr = s.service.get(2026, 4);
    expect(apr.publicHolidays.map((h) => h.date)).toEqual([
      '2026-04-03',
      '2026-04-06',
    ]);
    // February has none.
    expect(s.service.get(2026, 2).publicHolidays).toEqual([]);
  });

  it('uses reported_minutes when set, falling back to minutes', () => {
    const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
    const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
    const task = s.tasksRepo.create({ epicId: epic.id, number: 'T', title: 'T' });
    // Tracked 120 min, reported 90 min — grid should show 90.
    s.worklogsRepo.create({
      taskId: task.id,
      workDate: '2026-05-04',
      minutes: 120,
      reportedMinutes: 90,
    });
    // Reported NULL (default) — grid should show the tracked 60.
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-05', minutes: 60 });
    const res = s.service.get(2026, 5);
    // Reported view: 90 (overridden) on day 4, 60 (fallback) on day 5
    expect(res.tasks[0]?.perDayReported).toEqual({ 4: 90, 5: 60 });
    expect(res.tasks[0]?.totalReported).toBe(150);
    expect(res.dailyTotalsReported).toEqual({ 4: 90, 5: 60 });
    // Tracked view: 120 on day 4, 60 on day 5
    expect(res.tasks[0]?.perDayTracked).toEqual({ 4: 120, 5: 60 });
    expect(res.tasks[0]?.totalTracked).toBe(180);
    expect(res.dailyTotalsTracked).toEqual({ 4: 120, 5: 60 });
  });

  it('falls back to the pulled Jira estimate for estimatedMinutes when no manual estimate is set', () => {
    const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
    const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });

    // Task pulled from Jira: no manual estimate, Jira original estimate = 2h.
    const pulled = s.tasksRepo.create({ epicId: epic.id, number: 'FIE-1', title: 'pulled' });
    s.tasksRepo.updateJiraFields(pulled.id, {
      jiraStatus: 'In Progress',
      estimateSeconds: 7200,
      component: null,
      syncedAt: '2026-05-01T00:00:00.000Z',
    });
    s.worklogsRepo.create({ taskId: pulled.id, workDate: '2026-05-05', minutes: 60 });

    // Manual estimate present AND a (different) Jira estimate — manual must win.
    const manual = s.tasksRepo.create({
      epicId: epic.id,
      number: 'FIE-2',
      title: 'manual',
      estimatedMinutes: 45,
    });
    s.tasksRepo.updateJiraFields(manual.id, {
      jiraStatus: 'In Progress',
      estimateSeconds: 7200,
      component: null,
      syncedAt: '2026-05-01T00:00:00.000Z',
    });
    s.worklogsRepo.create({ taskId: manual.id, workDate: '2026-05-05', minutes: 60 });

    // Neither estimate — stays null.
    const bare = s.tasksRepo.create({ epicId: epic.id, number: 'FIE-3', title: 'bare' });
    s.worklogsRepo.create({ taskId: bare.id, workDate: '2026-05-05', minutes: 60 });

    const res = s.service.get(2026, 5);
    const byNum = Object.fromEntries(res.tasks.map((t) => [t.taskNumber, t.estimatedMinutes]));
    expect(byNum['FIE-1']).toBe(120); // 7200s / 60, from the Jira fallback
    expect(byNum['FIE-2']).toBe(45); // manual estimate wins over Jira's 120
    expect(byNum['FIE-3']).toBe(null);
  });

  it('includes daysInMonth correctly for short / long / leap months', () => {
    expect(s.service.get(2026, 2).daysInMonth).toBe(28); // 2026 is not leap
    expect(s.service.get(2024, 2).daysInMonth).toBe(29); // 2024 is leap
    expect(s.service.get(2026, 4).daysInMonth).toBe(30);
    expect(s.service.get(2026, 12).daysInMonth).toBe(31);
  });

  it('groups worklogs by task and day', () => {
    const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
    const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
    const task = s.tasksRepo.create({ epicId: epic.id, number: 'T-1', title: 'Task' });
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-04', minutes: 60 });
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-04', minutes: 30 }); // same day
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-12', minutes: 45 });

    const res = s.service.get(2026, 5);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0]?.perDayReported).toEqual({ 4: 90, 12: 45 });
    expect(res.tasks[0]?.totalReported).toBe(135);
    expect(res.tasks[0]?.perDayTracked).toEqual({ 4: 90, 12: 45 });
    expect(res.tasks[0]?.totalTracked).toBe(135);
    expect(res.dailyTotalsReported).toEqual({ 4: 90, 12: 45 });
    expect(res.dailyTotalsTracked).toEqual({ 4: 90, 12: 45 });
  });

  it('excludes worklogs outside the month boundaries', () => {
    const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
    const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
    const task = s.tasksRepo.create({ epicId: epic.id, number: 'T-1', title: 'Task' });
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-04-30', minutes: 60 });
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-01', minutes: 30 });
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-31', minutes: 45 });
    s.worklogsRepo.create({ taskId: task.id, workDate: '2026-06-01', minutes: 90 });

    const res = s.service.get(2026, 5);
    expect(res.tasks[0]?.totalReported).toBe(75); // 30 + 45 only
    expect(res.tasks[0]?.totalTracked).toBe(75);
  });

  it('projectIds filter narrows the grid to one project', () => {
    const projectA = s.projectsRepo.create({ name: 'A', kind: 'work' });
    const projectB = s.projectsRepo.create({ name: 'B', kind: 'work' });
    const epicA = s.epicsRepo.create({ projectId: projectA.id, name: 'EA' });
    const epicB = s.epicsRepo.create({ projectId: projectB.id, name: 'EB' });
    const taskA = s.tasksRepo.create({ epicId: epicA.id, number: 'A-1', title: 'A' });
    const taskB = s.tasksRepo.create({ epicId: epicB.id, number: 'B-1', title: 'B' });
    s.worklogsRepo.create({ taskId: taskA.id, workDate: '2026-05-05', minutes: 60 });
    s.worklogsRepo.create({ taskId: taskB.id, workDate: '2026-05-05', minutes: 90 });

    const res = s.service.get(2026, 5, [projectA.id]);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0]?.projectName).toBe('A');
    expect(res.dailyTotalsReported).toEqual({ 5: 60 });
    expect(res.dailyTotalsTracked).toEqual({ 5: 60 });
  });

  it('projectIds filter keeps every selected project (multi-select)', () => {
    const projectA = s.projectsRepo.create({ name: 'A', kind: 'work' });
    const projectB = s.projectsRepo.create({ name: 'B', kind: 'work' });
    const projectC = s.projectsRepo.create({ name: 'C', kind: 'work' });
    const epicA = s.epicsRepo.create({ projectId: projectA.id, name: 'EA' });
    const epicB = s.epicsRepo.create({ projectId: projectB.id, name: 'EB' });
    const epicC = s.epicsRepo.create({ projectId: projectC.id, name: 'EC' });
    const taskA = s.tasksRepo.create({ epicId: epicA.id, number: 'A-1', title: 'A' });
    const taskB = s.tasksRepo.create({ epicId: epicB.id, number: 'B-1', title: 'B' });
    const taskC = s.tasksRepo.create({ epicId: epicC.id, number: 'C-1', title: 'C' });
    s.worklogsRepo.create({ taskId: taskA.id, workDate: '2026-05-05', minutes: 60 });
    s.worklogsRepo.create({ taskId: taskB.id, workDate: '2026-05-05', minutes: 90 });
    s.worklogsRepo.create({ taskId: taskC.id, workDate: '2026-05-05', minutes: 30 });

    const res = s.service.get(2026, 5, [projectA.id, projectC.id]);
    expect(res.tasks.map((t) => t.projectName).sort()).toEqual(['A', 'C']);
    expect(res.dailyTotalsReported).toEqual({ 5: 90 }); // 60 + 30, B excluded
  });

  it('empty projectIds array behaves like no filter (all projects)', () => {
    const projectA = s.projectsRepo.create({ name: 'A', kind: 'work' });
    const projectB = s.projectsRepo.create({ name: 'B', kind: 'work' });
    const epicA = s.epicsRepo.create({ projectId: projectA.id, name: 'EA' });
    const epicB = s.epicsRepo.create({ projectId: projectB.id, name: 'EB' });
    const taskA = s.tasksRepo.create({ epicId: epicA.id, number: 'A-1', title: 'A' });
    const taskB = s.tasksRepo.create({ epicId: epicB.id, number: 'B-1', title: 'B' });
    s.worklogsRepo.create({ taskId: taskA.id, workDate: '2026-05-05', minutes: 60 });
    s.worklogsRepo.create({ taskId: taskB.id, workDate: '2026-05-05', minutes: 90 });

    const res = s.service.get(2026, 5, []);
    expect(res.tasks.length).toBe(2);
    expect(res.dailyTotalsReported).toEqual({ 5: 150 });
  });

  it('sorts tasks by task number using natural-numeric comparison', () => {
    // Mix projects + epics to prove the sort is driven by task number
    // alone (and not by project name / epic display_order, which used to
    // be the primary keys).
    const projB = s.projectsRepo.create({ name: 'B-proj', kind: 'work' });
    const projA = s.projectsRepo.create({ name: 'A-proj', kind: 'work' });
    const epicA = s.epicsRepo.create({ projectId: projA.id, name: 'EA' });
    const epicB = s.epicsRepo.create({ projectId: projB.id, name: 'EB' });
    // Numeric suffixes are out of lexicographic order on purpose:
    // FIE-19100 sorts before FIE-19000 alphabetically but should land
    // after it with numeric comparison.
    const tHi = s.tasksRepo.create({ epicId: epicB.id, number: 'FIE-19100', title: 'high' });
    const tLo = s.tasksRepo.create({ epicId: epicA.id, number: 'FIE-19000', title: 'low' });
    const tMid = s.tasksRepo.create({ epicId: epicA.id, number: 'FIE-2000', title: 'mid' });
    s.worklogsRepo.create({ taskId: tHi.id, workDate: '2026-05-05', minutes: 30 });
    s.worklogsRepo.create({ taskId: tLo.id, workDate: '2026-05-05', minutes: 30 });
    s.worklogsRepo.create({ taskId: tMid.id, workDate: '2026-05-05', minutes: 30 });

    const res = s.service.get(2026, 5);
    expect(res.tasks.map((t) => t.taskNumber)).toEqual([
      'FIE-2000',
      'FIE-19000',
      'FIE-19100',
    ]);
  });

  it('only shows tasks that have at least one worklog in the month', () => {
    const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
    const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
    s.tasksRepo.create({ epicId: epic.id, number: 'EMPTY', title: 'no worklogs' });
    const busy = s.tasksRepo.create({ epicId: epic.id, number: 'BUSY', title: 'has worklogs' });
    s.worklogsRepo.create({ taskId: busy.id, workDate: '2026-05-10', minutes: 60 });
    const res = s.service.get(2026, 5);
    expect(res.tasks.map((t) => t.taskNumber)).toEqual(['BUSY']);
  });

  describe('earnings by currency', () => {
    it('skips time_off projects from the earnings rows', () => {
      const work = s.projectsRepo.create({ name: 'Work', kind: 'work' });
      const off = s.projectsRepo.create({ name: 'TO', kind: 'time_off' });
      for (const p of [work, off]) {
        const epic = s.epicsRepo.create({ projectId: p.id, name: 'E' });
        const task = s.tasksRepo.create({ epicId: epic.id, number: `${p.name}-T`, title: 'X' });
        s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-10', minutes: 60 });
        s.ratesRepo.create({
          projectId: p.id,
          effectiveFrom: '2026-01-01',
          rateType: 'hourly',
          rateAmount: 100,
        });
      }
      const res = s.service.get(2026, 5);
      // Only the work project contributes to earnings. Expected = 19
      // workdays (May 2026 minus Labour & Liberation Day) × 100 CZK/h ×
      // 8 h = 15200 CZK.
      expect(res.earningsByCurrency).toEqual([
        { perDay: { 10: 100 }, totalAmount: 100, expectedAmount: 15200 },
      ]);
    });

    it('uses each worklog\'s effective rate (hourly)', () => {
      const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
      const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
      const task = s.tasksRepo.create({ epicId: epic.id, number: 'T', title: 'T' });
      // Hourly rate: 1600 CZK/hr. 60 minutes = 1 hour = 1600 CZK.
      s.ratesRepo.create({
        projectId: project.id,
        effectiveFrom: '2026-01-01',
        rateType: 'hourly',
        rateAmount: 1600,
      });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-04', minutes: 60 });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-05', minutes: 90 });
      const res = s.service.get(2026, 5);
      // Expected = 19 workdays × 1600 × 8 = 243200.
      expect(res.earningsByCurrency).toEqual([
        {
          perDay: { 4: 1600, 5: 2400 },
          totalAmount: 4000,
          expectedAmount: 243200,
        },
      ]);
    });

    it('uses each worklog\'s effective rate (daily / MD)', () => {
      const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
      const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
      const task = s.tasksRepo.create({ epicId: epic.id, number: 'T', title: 'T' });
      // Daily rate: 12800 CZK / MD at 8 h/day → 1600 CZK/hr effective.
      s.ratesRepo.create({
        projectId: project.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 12800,
        hoursPerDay: 8,
      });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-04', minutes: 60 });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-05', minutes: 90 });
      const res = s.service.get(2026, 5);
      // Expected = 19 workdays × 12800 (MD) = 243200.
      expect(res.earningsByCurrency).toEqual([
        {
          perDay: { 4: 1600, 5: 2400 },
          totalAmount: 4000,
          expectedAmount: 243200,
        },
      ]);
    });

    it('picks the rate that contains the worklog\'s work_date when contracts change mid-month', () => {
      const project = s.projectsRepo.create({ name: 'P', kind: 'work' });
      const epic = s.epicsRepo.create({ projectId: project.id, name: 'E' });
      const task = s.tasksRepo.create({ epicId: epic.id, number: 'T', title: 'T' });
      // Old rate up to May 14, then new rate from May 15.
      s.ratesRepo.create({
        projectId: project.id,
        effectiveFrom: '2026-01-01',
        rateType: 'hourly',
        rateAmount: 1000,
      });
      s.ratesRepo.create({
        projectId: project.id,
        effectiveFrom: '2026-05-15',
        rateType: 'hourly',
        rateAmount: 2000,
      });
      // Auto-close set the previous contract's end_date = 2026-05-14
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-10', minutes: 60 }); // old rate → 1000
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-20', minutes: 60 }); // new rate → 2000
      const res = s.service.get(2026, 5);
      // Expected mid-month split: 8 workdays at 1000 CZK/h × 8 h +
      // 11 workdays at 2000 CZK/h × 8 h = 64000 + 176000 = 240000.
      expect(res.earningsByCurrency).toEqual([
        {
          perDay: { 10: 1000, 20: 2000 },
          totalAmount: 3000,
          expectedAmount: 240000,
        },
      ]);
    });

    it('merges earnings from multiple projects into a single CZK row', () => {
      // All contracts now hardcode CZK — multiple projects combine into one row.
      for (const { name, amount } of [
        { name: 'P1', amount: 50 },
        { name: 'P2', amount: 100 },
        { name: 'P3', amount: 1000 },
      ]) {
        const p = s.projectsRepo.create({ name, kind: 'work' });
        const epic = s.epicsRepo.create({ projectId: p.id, name: 'E' });
        const task = s.tasksRepo.create({ epicId: epic.id, number: `${name}-T`, title: 'X' });
        s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-10', minutes: 60 });
        s.ratesRepo.create({
          projectId: p.id,
          effectiveFrom: '2026-01-01',
          rateType: 'hourly',
          rateAmount: amount,
        });
      }
      const res = s.service.get(2026, 5);
      expect(res.earningsByCurrency).toHaveLength(1);
    });
  });

  it('soft-deleted worklog is excluded from task grid', () => {
    const p = s.projectsRepo.create({ name: 'P', kind: 'work' });
    const e = s.epicsRepo.create({ projectId: p.id, name: 'E' });
    const t = s.tasksRepo.create({ epicId: e.id, number: 'T-1', title: 'T' });
    const wl = s.worklogsRepo.create({ taskId: t.id, workDate: '2026-05-15', minutes: 60 });

    const before = s.service.get(2026, 5);
    expect(before.tasks.find((r) => r.taskId === t.id)?.totalTracked).toBe(60);

    s.worklogsRepo.delete(wl.id);
    const after = s.service.get(2026, 5);
    expect(after.tasks.find((r) => r.taskId === t.id)).toBeUndefined();
  });
});
