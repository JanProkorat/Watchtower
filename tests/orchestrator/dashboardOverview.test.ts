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

  beforeEach(() => {
    db = freshDb();
    service = new DashboardOverviewService(db);
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);
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
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.today.minutes).toBe(90);
  });

  it('today.minutes respects projectId filter', () => {
    const a = seedTask('A', '#aaa', 'A-1');
    const b = seedTask('B', '#bbb', 'B-1');
    seedWorklog(a.task.id, '2026-05-25', 60);
    seedWorklog(b.task.id, '2026-05-25', 30);

    const res = service.run({
      projectId: a.project.id,
      weekAnchor: '2026-05-25',
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
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.month.minutes).toBe(60 + 120 + 30);
  });

  it('week.days is always length 7 Mon→Sun and totals match', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 90, 'Mon task');
    seedWorklog(task.id, '2026-05-28', 60);
    seedWorklog(task.id, '2026-05-31', 30);

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-27',
      todayDate: '2026-05-27',
    });

    expect(res.week.fromDate).toBe('2026-05-25');
    expect(res.week.toDate).toBe('2026-05-31');
    expect(res.week.days.map((d) => d.date)).toEqual([
      '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28',
      '2026-05-29', '2026-05-30', '2026-05-31',
    ]);
    expect(res.week.days[0].minutes).toBe(90);
    expect(res.week.days[3].minutes).toBe(60);
    expect(res.week.days[6].minutes).toBe(30);
    expect(res.week.days[0].worklogs[0]).toMatchObject({
      taskNumber: 'T-1',
      projectName: 'P',
      projectColor: '#7aa7ff',
      minutes: 90,
      note: 'Mon task',
    });
    expect(res.week.totalMinutes).toBe(180);
  });

  it('mondayOf snaps Sunday correctly to the preceding Monday', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 10);

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-31',
      todayDate: '2026-05-31',
    });

    expect(res.week.fromDate).toBe('2026-05-25');
    expect(res.week.toDate).toBe('2026-05-31');
  });

  it('heatmap30d covers exactly 30 consecutive days ending todayDate', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 60);
    seedWorklog(task.id, '2026-04-26', 60);
    seedWorklog(task.id, '2026-04-25', 999);

    const res = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
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
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
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
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    // Spec: "Current streak: count back from today through consecutive
    // non-zero days; resets at any zero day". Today is a zero day → streak
    // resets to 0, even though the prior run was length 2.
    expect(res.heatmap30d.stats.currentStreak).toBe(0);
    expect(res.heatmap30d.stats.longestStreak).toBe(2);
  });

  it('busiestDay returns the heaviest non-zero day, null when empty', () => {
    const empty = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(empty.heatmap30d.stats.busiestDay).toBeNull();

    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-20', 90);
    seedWorklog(task.id, '2026-05-25', 200);
    seedWorklog(task.id, '2026-05-22', 100);

    const res = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(res.heatmap30d.stats.busiestDay).toEqual({ date: '2026-05-25', minutes: 200 });
  });

  it('weeklyAvgMinutes is total / 30 * 7 rounded', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 300);
    seedWorklog(task.id, '2026-05-20', 300);

    const res = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
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
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
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
      projectId: a.project.id, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.topProjects.map((p) => p.projectName)).toEqual(['Alpha']);
  });
});
