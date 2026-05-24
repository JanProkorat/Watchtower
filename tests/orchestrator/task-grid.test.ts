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
    expect(res.dailyTotals).toEqual({});
    expect(res.earningsByCurrency).toEqual([]);
    expect(res.daysInMonth).toBe(31);
    // May 2026 = 21 weekdays × 8h × 60min = 10080.
    expect(res.monthCapacityMinutes).toBe(10080);
  });

  it('computes monthCapacityMinutes from Mon-Fri workdays × 8h', () => {
    // Feb 2026: 20 weekdays. 20 × 8 × 60 = 9600.
    expect(s.service.get(2026, 2).monthCapacityMinutes).toBe(9600);
    // Aug 2026: 21 weekdays. 21 × 8 × 60 = 10080.
    expect(s.service.get(2026, 8).monthCapacityMinutes).toBe(10080);
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
    expect(res.tasks[0]?.perDay).toEqual({ 4: 90, 5: 60 });
    expect(res.tasks[0]?.totalMinutes).toBe(150);
    expect(res.dailyTotals).toEqual({ 4: 90, 5: 60 });
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
    expect(res.tasks[0]?.perDay).toEqual({ 4: 90, 12: 45 });
    expect(res.tasks[0]?.totalMinutes).toBe(135);
    expect(res.dailyTotals).toEqual({ 4: 90, 12: 45 });
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
    expect(res.tasks[0]?.totalMinutes).toBe(75); // 30 + 45 only
  });

  it('projectId filter narrows the grid to one project', () => {
    const projectA = s.projectsRepo.create({ name: 'A', kind: 'work' });
    const projectB = s.projectsRepo.create({ name: 'B', kind: 'work' });
    const epicA = s.epicsRepo.create({ projectId: projectA.id, name: 'EA' });
    const epicB = s.epicsRepo.create({ projectId: projectB.id, name: 'EB' });
    const taskA = s.tasksRepo.create({ epicId: epicA.id, number: 'A-1', title: 'A' });
    const taskB = s.tasksRepo.create({ epicId: epicB.id, number: 'B-1', title: 'B' });
    s.worklogsRepo.create({ taskId: taskA.id, workDate: '2026-05-05', minutes: 60 });
    s.worklogsRepo.create({ taskId: taskB.id, workDate: '2026-05-05', minutes: 90 });

    const res = s.service.get(2026, 5, projectA.id);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0]?.projectName).toBe('A');
    expect(res.dailyTotals).toEqual({ 5: 60 });
  });

  it('sorts tasks by project name, epic display_order, then task id', () => {
    const projB = s.projectsRepo.create({ name: 'B-proj', kind: 'work' });
    const projA = s.projectsRepo.create({ name: 'A-proj', kind: 'work' });
    const epicA1 = s.epicsRepo.create({ projectId: projA.id, name: 'A1' }); // display 1000
    const epicA2 = s.epicsRepo.create({ projectId: projA.id, name: 'A2' }); // display 2000
    const epicB1 = s.epicsRepo.create({ projectId: projB.id, name: 'B1' });
    const tA1 = s.tasksRepo.create({ epicId: epicA1.id, number: 'A1-T', title: 'A1' });
    const tA2 = s.tasksRepo.create({ epicId: epicA2.id, number: 'A2-T', title: 'A2' });
    const tB1 = s.tasksRepo.create({ epicId: epicB1.id, number: 'B1-T', title: 'B1' });
    s.worklogsRepo.create({ taskId: tB1.id, workDate: '2026-05-05', minutes: 30 });
    s.worklogsRepo.create({ taskId: tA2.id, workDate: '2026-05-05', minutes: 30 });
    s.worklogsRepo.create({ taskId: tA1.id, workDate: '2026-05-05', minutes: 30 });

    const res = s.service.get(2026, 5);
    expect(res.tasks.map((t) => t.taskNumber)).toEqual(['A1-T', 'A2-T', 'B1-T']);
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
          currency: 'CZK',
        });
      }
      const res = s.service.get(2026, 5);
      // Only the work project contributes to earnings
      expect(res.earningsByCurrency).toEqual([{ currency: 'CZK', perDay: { 10: 100 }, totalAmount: 100 }]);
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
        currency: 'CZK',
      });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-04', minutes: 60 });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-05', minutes: 90 });
      const res = s.service.get(2026, 5);
      expect(res.earningsByCurrency).toEqual([
        { currency: 'CZK', perDay: { 4: 1600, 5: 2400 }, totalAmount: 4000 },
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
        currency: 'CZK',
        hoursPerDay: 8,
      });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-04', minutes: 60 });
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-05', minutes: 90 });
      const res = s.service.get(2026, 5);
      expect(res.earningsByCurrency).toEqual([
        { currency: 'CZK', perDay: { 4: 1600, 5: 2400 }, totalAmount: 4000 },
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
        currency: 'CZK',
      });
      s.ratesRepo.create({
        projectId: project.id,
        effectiveFrom: '2026-05-15',
        rateType: 'hourly',
        rateAmount: 2000,
        currency: 'CZK',
      });
      // Auto-close set the previous contract's end_date = 2026-05-14
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-10', minutes: 60 }); // old rate → 1000
      s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-20', minutes: 60 }); // new rate → 2000
      const res = s.service.get(2026, 5);
      expect(res.earningsByCurrency).toEqual([
        { currency: 'CZK', perDay: { 10: 1000, 20: 2000 }, totalAmount: 3000 },
      ]);
    });

    it('emits one row per currency, alphabetically sorted', () => {
      const eu = s.projectsRepo.create({ name: 'EU', kind: 'work' });
      const us = s.projectsRepo.create({ name: 'US', kind: 'work' });
      const cz = s.projectsRepo.create({ name: 'CZ', kind: 'work' });
      for (const { p, currency, amount } of [
        { p: eu, currency: 'EUR', amount: 50 },
        { p: us, currency: 'USD', amount: 100 },
        { p: cz, currency: 'CZK', amount: 1000 },
      ]) {
        const epic = s.epicsRepo.create({ projectId: p.id, name: 'E' });
        const task = s.tasksRepo.create({ epicId: epic.id, number: `${currency}-T`, title: 'X' });
        s.worklogsRepo.create({ taskId: task.id, workDate: '2026-05-10', minutes: 60 });
        s.ratesRepo.create({
          projectId: p.id,
          effectiveFrom: '2026-01-01',
          rateType: 'hourly',
          rateAmount: amount,
          currency,
        });
      }
      const res = s.service.get(2026, 5);
      expect(res.earningsByCurrency.map((r) => r.currency)).toEqual(['CZK', 'EUR', 'USD']);
    });
  });
});
