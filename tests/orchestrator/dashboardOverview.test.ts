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
import { DashboardOverviewService } from '../../orchestrator/db/dashboardOverview.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-dash-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('DashboardOverviewService', () => {
  let db: SqliteLike;
  let service: DashboardOverviewService;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let worklogs: WorklogsRepo;
  let rates: ProjectRatesRepo;

  beforeEach(() => {
    db = freshDb();
    service = new DashboardOverviewService(db);
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);
    rates = new ProjectRatesRepo(db);
  });

  function seedTask(projectName: string, color: string, taskNumber: string) {
    const p = projects.create({ name: projectName, color, kind: 'work' });
    const e = epics.create({ projectId: p.id, name: 'E' });
    const t = tasks.create({ epicId: e.id, number: taskNumber, title: taskNumber });
    return { project: p, task: t };
  }

  function seedWorklog(taskId: number, date: string, minutes: number, description?: string) {
    return worklogs.create({ taskId, workDate: date, minutes, description: description ?? null });
  }

  it('today.minutes sums worklogs on todayDate, ignoring other days', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 90);
    seedWorklog(task.id, '2026-05-24', 60);

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.today.minutes).toBe(90);
    expect(res.today.earned).toEqual({});
    expect(res.month.earned).toEqual({});
    expect(res.sprint.totalEarned).toEqual({});
  });

  it('today.minutes respects projectId filter', () => {
    const a = seedTask('A', '#aaa', 'A-1');
    const b = seedTask('B', '#bbb', 'B-1');
    seedWorklog(a.task.id, '2026-05-25', 60);
    seedWorklog(b.task.id, '2026-05-25', 30);

    const res = service.run({
      projectId: a.project.id,
      sprintAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.today.minutes).toBe(60);
  });

  it('month.minutes sums all worklogs in the YYYY-MM derived from todayDate', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-01', 60);
    seedWorklog(task.id, '2026-05-25', 120);
    seedWorklog(task.id, '2026-05-31', 30);
    seedWorklog(task.id, '2026-04-30', 999);
    seedWorklog(task.id, '2026-06-01', 999);

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.month.minutes).toBe(60 + 120 + 30);
  });

  function setSprintConfig(startDate: string, lengthDays: number) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('dashboard.sprint.startDate', startDate);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('dashboard.sprint.lengthDays', String(lengthDays));
  }

  it('sprint.days is length lengthDays and spans fromDate→toDate inclusive', () => {
    // Default sprint config: startDate=2026-01-05, lengthDays=14
    // Sprint containing 2026-05-25: days from 2026-01-05 = 140 days → sprint index 10
    // fromDate = 2026-01-05 + 10*14 = 2026-01-05 + 140 = 2026-05-25
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 90, 'Day 1 task');
    seedWorklog(task.id, '2026-05-28', 60);
    seedWorklog(task.id, '2026-06-07', 30);

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-27',
      todayDate: '2026-05-27',
    });

    expect(res.sprint.fromDate).toBe('2026-05-25');
    expect(res.sprint.toDate).toBe('2026-06-07');
    expect(res.sprint.lengthDays).toBe(14);
    expect(res.sprint.days).toHaveLength(14);
    expect(res.sprint.days[0].date).toBe('2026-05-25');
    expect(res.sprint.days[13].date).toBe('2026-06-07');
    expect(res.sprint.days[0].minutes).toBe(90);
    expect(res.sprint.days[3].minutes).toBe(60);
    expect(res.sprint.days[13].minutes).toBe(30);
    expect(res.sprint.days[0].worklogs[0]).toMatchObject({
      taskNumber: 'T-1',
      taskTitle: 'T-1',
      projectName: 'P',
      projectColor: '#7aa7ff',
      minutes: 90,
      note: 'Day 1 task',
    });
    expect(res.sprint.totalMinutes).toBe(180);
  });

  it('sprintFor honours custom sprint length from settings', () => {
    setSprintConfig('2026-01-05', 7);
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    // With 7-day sprints from 2026-01-05, 2026-05-25 is day 140 (0-indexed)
    // sprint index = floor(140/7) = 20 → fromDate = 2026-01-05 + 140 = 2026-05-25
    seedWorklog(task.id, '2026-05-25', 45);
    seedWorklog(task.id, '2026-05-31', 55);

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-27',
      todayDate: '2026-05-27',
    });

    expect(res.sprint.lengthDays).toBe(7);
    expect(res.sprint.days).toHaveLength(7);
    expect(res.sprint.fromDate).toBe('2026-05-25');
    expect(res.sprint.toDate).toBe('2026-05-31');
    expect(res.sprint.totalMinutes).toBe(100);
  });

  it('sprintFor honours custom sprint start from settings', () => {
    // Sprint starts on 2026-05-20, length 14 → first sprint: 2026-05-20..2026-06-02
    setSprintConfig('2026-05-20', 14);
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-20', 60);
    seedWorklog(task.id, '2026-06-02', 30);
    seedWorklog(task.id, '2026-06-03', 999); // outside sprint

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.sprint.fromDate).toBe('2026-05-20');
    expect(res.sprint.toDate).toBe('2026-06-02');
    expect(res.sprint.lengthDays).toBe(14);
    expect(res.sprint.totalMinutes).toBe(90);
  });

  it('heatmap30d covers exactly 30 consecutive days ending todayDate', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 60);
    seedWorklog(task.id, '2026-04-26', 60);
    seedWorklog(task.id, '2026-04-25', 999);

    const res = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.heatmap30d.fromDate).toBe('2026-04-26');
    expect(res.heatmap30d.toDate).toBe('2026-05-25');
    expect(res.heatmap30d.days).toHaveLength(30);
    expect(res.heatmap30d.days.find((d) => d.date === '2026-05-25')?.minutes).toBe(60);
    expect(res.heatmap30d.days.find((d) => d.date === '2026-04-26')?.minutes).toBe(60);
  });

  it('streak counts back from today through consecutive non-zero days', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    for (const d of ['2026-05-25', '2026-05-24', '2026-05-23']) {
      seedWorklog(task.id, d, 30);
    }
    seedWorklog(task.id, '2026-05-21', 30);

    const res = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.heatmap30d.stats.currentStreak).toBe(3);
    expect(res.heatmap30d.stats.longestStreak).toBe(3);
    expect(res.heatmap30d.stats.activeDays).toBe(4);
  });

  it('currentStreak is 0 when today has no logged minutes, even if yesterday did', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    // Worked yesterday and the day before — but nothing today.
    seedWorklog(task.id, '2026-05-24', 60);
    seedWorklog(task.id, '2026-05-23', 60);

    const res = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    // Spec: "Current streak: count back from today through consecutive
    // non-zero days; resets at any zero day". Today is a zero day → streak
    // resets to 0, even though the prior run was length 2.
    expect(res.heatmap30d.stats.currentStreak).toBe(0);
    expect(res.heatmap30d.stats.longestStreak).toBe(2);
  });

  it('busiestDay returns the heaviest non-zero day, null when empty', () => {
    const empty = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(empty.heatmap30d.stats.busiestDay).toBeNull();

    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-20', 90);
    seedWorklog(task.id, '2026-05-25', 200);
    seedWorklog(task.id, '2026-05-22', 100);

    const res = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(res.heatmap30d.stats.busiestDay).toEqual({ date: '2026-05-25', minutes: 200 });
  });

  it('weeklyAvgMinutes is total / 30 * 7 rounded', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 300);
    seedWorklog(task.id, '2026-05-20', 300);

    const res = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(res.heatmap30d.stats.weeklyAvgMinutes).toBe(Math.round((600 / 30) * 7));
  });

  it('topProjects is sorted by minutes desc, excludes zero-minute projects', () => {
    const a = seedTask('Alpha', '#aaa', 'A-1');
    const b = seedTask('Bravo', '#bbb', 'B-1');
    const c = seedTask('Charlie', '#ccc', 'C-1');

    seedWorklog(a.task.id, '2026-05-10', 60);
    seedWorklog(b.task.id, '2026-05-15', 180);
    seedWorklog(b.task.id, '2026-05-20', 120);
    seedWorklog(c.task.id, '2026-04-15', 999);

    const res = service.run({
      projectId: null, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.topProjects.map((p) => p.projectName)).toEqual(['Bravo', 'Alpha']);
    expect(res.topProjects[0]).toMatchObject({
      projectName: 'Bravo',
      minutes: 300,
      projectColor: '#bbb',
    });
  });

  it('topProjects respects projectId filter', () => {
    const a = seedTask('Alpha', '#aaa', 'A-1');
    const b = seedTask('Bravo', '#bbb', 'B-1');
    seedWorklog(a.task.id, '2026-05-10', 60);
    seedWorklog(b.task.id, '2026-05-15', 180);

    const res = service.run({
      projectId: a.project.id, sprintAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.topProjects.map((p) => p.projectName)).toEqual(['Alpha']);
  });

  it('lists every worklog for the same task on the same day as a separate row (sorted by minutes desc)', () => {
    const { task } = seedTask('P', '#7aa7ff', 'AGG-1');
    seedWorklog(task.id, '2026-05-25', 30, 'morning');
    seedWorklog(task.id, '2026-05-25', 60, 'afternoon');
    seedWorklog(task.id, '2026-05-25', 15, 'evening');

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    // For the default 2026-01-05 / 14d sprint config,
    // 2026-05-25 falls inside one sprint and exactly one day cell will hold this data.
    const day = res.sprint.days.find((d) => d.date === '2026-05-25');
    expect(day).toBeDefined();
    expect(day!.worklogs).toHaveLength(3);
    expect(day!.worklogs.map((w) => w.minutes)).toEqual([60, 30, 15]);
    expect(day!.worklogs.every((w) => w.taskNumber === 'AGG-1')).toBe(true);
    expect(day!.worklogs[0]).toMatchObject({
      taskNumber: 'AGG-1',
      projectName: 'P',
      minutes: 60,
      note: 'afternoon',
    });
  });

  it('renders distinct worklogs on the same day sorted by minutes desc', () => {
    const a = seedTask('P', '#7aa7ff', 'BIG-1');
    const b = seedTask('P', '#7aa7ff', 'SMALL-1');
    seedWorklog(a.task.id, '2026-05-25', 90);
    seedWorklog(b.task.id, '2026-05-25', 30);

    const res = service.run({
      projectId: null,
      sprintAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    const day = res.sprint.days.find((d) => d.date === '2026-05-25');
    expect(day).toBeDefined();
    expect(day!.worklogs.map((w) => w.taskNumber)).toEqual(['BIG-1', 'SMALL-1']);
    expect(day!.worklogs[0].minutes).toBe(90);
    expect(day!.worklogs[1].minutes).toBe(30);
  });

  describe('activeContracts', () => {
    it('returns one entry per project with a current contract (end_date or md_limit)', () => {
      const a = projects.create({ name: 'Alpha', color: '#aaa', kind: 'work' });
      const b = projects.create({ name: 'Bravo', color: '#bbb', kind: 'work' });
      projects.create({ name: 'Charlie', color: '#ccc', kind: 'work' }); // no contract → excluded
      rates.create({
        projectId: a.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 12000,
        currency: 'CZK',
        endDate: '2026-06-30',
        mdLimit: 115,
      });
      rates.create({
        projectId: b.id,
        effectiveFrom: '2026-01-01',
        rateType: 'hourly',
        rateAmount: 1500,
        currency: 'EUR',
        mdLimit: 50,
      });

      const res = service.run({
        projectId: null,
        sprintAnchor: '2026-05-27',
        todayDate: '2026-05-27',
      });

      expect(res.activeContracts.map((c) => c.projectName)).toEqual(['Alpha', 'Bravo']);
      expect(res.activeContracts[0]).toMatchObject({
        projectId: a.id,
        projectName: 'Alpha',
        projectColor: '#aaa',
        currency: 'CZK',
      });
      expect(res.activeContracts[0].contract).toMatchObject({
        projectId: a.id,
        mdLimit: 115,
        endDate: '2026-06-30',
      });
    });

    it('excludes archived projects', () => {
      const p = projects.create({ name: 'Archived', color: '#aaa', kind: 'work' });
      rates.create({
        projectId: p.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 1,
        currency: 'CZK',
        endDate: '2026-12-31',
        mdLimit: 10,
      });
      projects.archive(p.id, true);

      const res = service.run({
        projectId: null,
        sprintAnchor: '2026-05-27',
        todayDate: '2026-05-27',
      });
      expect(res.activeContracts).toEqual([]);
    });

    it('excludes contracts without end_date AND without md_limit', () => {
      const p = projects.create({ name: 'Open', color: '#aaa', kind: 'work' });
      rates.create({
        projectId: p.id,
        effectiveFrom: '2026-01-01',
        rateType: 'hourly',
        rateAmount: 100,
        currency: 'CZK',
        // No endDate, no mdLimit → excluded.
      });

      const res = service.run({
        projectId: null,
        sprintAnchor: '2026-05-27',
        todayDate: '2026-05-27',
      });
      expect(res.activeContracts).toEqual([]);
    });

    it('ignores the request projectId filter — surfaces every active contract', () => {
      const a = projects.create({ name: 'Alpha', color: '#aaa', kind: 'work' });
      const b = projects.create({ name: 'Bravo', color: '#bbb', kind: 'work' });
      for (const pid of [a.id, b.id]) {
        rates.create({
          projectId: pid,
          effectiveFrom: '2026-01-01',
          rateType: 'daily',
          rateAmount: 10000,
          currency: 'CZK',
          endDate: '2026-12-31',
          mdLimit: 100,
        });
      }

      const res = service.run({
        projectId: a.id,
        sprintAnchor: '2026-05-27',
        todayDate: '2026-05-27',
      });
      expect(res.activeContracts.map((c) => c.projectName)).toEqual(['Alpha', 'Bravo']);
    });

    it('sorts highest-overshoot first, then alphabetically when scores tie', () => {
      const high = projects.create({ name: 'High', color: '#a00', kind: 'work' });
      const low = projects.create({ name: 'Low', color: '#0a0', kind: 'work' });
      const aOpen = projects.create({ name: 'A-Open', color: '#00a', kind: 'work' });
      const zOpen = projects.create({ name: 'Z-Open', color: '#aa0', kind: 'work' });

      // Both have an end_date so projectedTotalMds is computable. We can't
      // easily control mdsUsed (depends on real elapsed workdays from
      // effectiveFrom→today), so we tilt the score via mdLimit alone: a
      // tiny mdLimit forces "projectedTotalMds - mdLimit" to be huge.
      rates.create({
        projectId: high.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 1,
        currency: 'CZK',
        endDate: '2026-12-31',
        mdLimit: 1,
      });
      rates.create({
        projectId: low.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 1,
        currency: 'CZK',
        endDate: '2026-12-31',
        mdLimit: 10_000,
      });
      // "Open" contracts can't compute projectedTotalMds (no end_date) and
      // therefore tie at the bottom — alphabetical order between them.
      rates.create({
        projectId: aOpen.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 1,
        currency: 'CZK',
        mdLimit: 100,
      });
      rates.create({
        projectId: zOpen.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 1,
        currency: 'CZK',
        mdLimit: 100,
      });

      const res = service.run({
        projectId: null,
        sprintAnchor: '2026-05-27',
        todayDate: '2026-05-27',
      });
      expect(res.activeContracts.map((c) => c.projectName)).toEqual([
        'High',
        'Low',
        'A-Open',
        'Z-Open',
      ]);
    });

    it('contract.mdsUsed accumulates logged minutes inside the contract period', () => {
      const p = projects.create({ name: 'P', color: '#aaa', kind: 'work' });
      const e = epics.create({ projectId: p.id, name: 'E' });
      const t = tasks.create({ epicId: e.id, number: 'T-1', title: 'T-1' });
      rates.create({
        projectId: p.id,
        effectiveFrom: '2026-01-01',
        rateType: 'daily',
        rateAmount: 10000,
        currency: 'CZK',
        endDate: '2026-12-31',
        mdLimit: 100,
        hoursPerDay: 8,
      });
      // 1 MD = 8h = 480 min.
      worklogs.create({ taskId: t.id, workDate: '2026-05-25', minutes: 480 });
      worklogs.create({ taskId: t.id, workDate: '2026-05-26', minutes: 240 });

      const res = service.run({
        projectId: null,
        sprintAnchor: '2026-05-27',
        todayDate: '2026-05-27',
      });
      expect(res.activeContracts).toHaveLength(1);
      expect(res.activeContracts[0].contract.mdsUsed).toBe(1.5);
      expect(res.activeContracts[0].contract.mdsRemaining).toBe(98.5);
    });
  });
});
