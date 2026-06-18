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
import {
  ProjectRatesRepo,
  RateOverlapError,
} from '../../orchestrator/db/repositories/projectRates.js';
import { ContractStatusService } from '../../orchestrator/db/contractStatus.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

const STANDARD_INPUT = {
  rateType: 'hourly' as const,
  rateAmount: 1600,
  currency: 'CZK',
  hoursPerDay: 8,
};

describe('ProjectRatesRepo', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let rates: ProjectRatesRepo;
  let projectId: number;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    rates = new ProjectRatesRepo(db);
    projectId = projects.create({ name: 'PPS', kind: 'work' }).id;
  });

  describe('create', () => {
    it('inserts a contract with sensible defaults', () => {
      const c = rates.create({
        projectId,
        effectiveFrom: '2026-01-01',
        ...STANDARD_INPUT,
      });
      expect(c.id).toBeGreaterThan(0);
      expect(c.effectiveFrom).toBe('2026-01-01');
      expect(c.endDate).toBeNull();
      expect(c.rateAmount).toBe(1600);
      expect(c.hoursPerDay).toBe(8);
    });

    it('preserves the end_date and md_limit when supplied', () => {
      const c = rates.create({
        projectId,
        effectiveFrom: '2026-01-01',
        endDate: '2026-06-30',
        mdLimit: 50,
        ...STANDARD_INPUT,
      });
      expect(c.endDate).toBe('2026-06-30');
      expect(c.mdLimit).toBe(50);
    });
  });

  describe('auto-close behaviour', () => {
    it('auto-closes a previous open-ended contract to (new.from - 1 day)', () => {
      const a = rates.create({
        projectId,
        effectiveFrom: '2025-09-01',
        ...STANDARD_INPUT,
      });
      rates.create({ projectId, effectiveFrom: '2026-05-22', ...STANDARD_INPUT });
      const after = rates.get(a.id);
      expect(after?.endDate).toBe('2026-05-21');
    });

    it('does not touch a previous contract that already has an end_date', () => {
      const a = rates.create({
        projectId,
        effectiveFrom: '2025-01-01',
        endDate: '2025-08-31',
        ...STANDARD_INPUT,
      });
      rates.create({ projectId, effectiveFrom: '2026-05-22', ...STANDARD_INPUT });
      const after = rates.get(a.id);
      expect(after?.endDate).toBe('2025-08-31');
    });

    it('does not auto-close a future open-ended contract', () => {
      // Create a forward-dated open-ended contract, then add one that starts
      // before it. The future contract's end_date must stay null because the
      // new contract precedes it.
      const future = rates.create({
        projectId,
        effectiveFrom: '2027-01-01',
        ...STANDARD_INPUT,
      });
      // Insert a closed historical contract — should not affect future open one.
      rates.create({
        projectId,
        effectiveFrom: '2026-01-01',
        endDate: '2026-12-31',
        ...STANDARD_INPUT,
      });
      expect(rates.get(future.id)?.endDate).toBeNull();
    });
  });

  describe('overlap rejection', () => {
    it('rejects a new contract that overlaps a closed range', () => {
      rates.create({
        projectId,
        effectiveFrom: '2025-01-01',
        endDate: '2025-12-31',
        ...STANDARD_INPUT,
      });
      expect(() =>
        rates.create({
          projectId,
          effectiveFrom: '2025-06-01',
          endDate: '2026-05-31',
          ...STANDARD_INPUT,
        }),
      ).toThrowError(RateOverlapError);
    });

    it('rejects update that pushes end_date into a sibling contract', () => {
      const a = rates.create({
        projectId,
        effectiveFrom: '2025-01-01',
        endDate: '2025-06-30',
        ...STANDARD_INPUT,
      });
      rates.create({
        projectId,
        effectiveFrom: '2025-07-01',
        endDate: '2025-12-31',
        ...STANDARD_INPUT,
      });
      expect(() => rates.update(a.id, { endDate: '2025-09-30' })).toThrowError(RateOverlapError);
    });

    it('does not flag a row against itself on a no-op update', () => {
      const c = rates.create({
        projectId,
        effectiveFrom: '2025-01-01',
        endDate: '2025-12-31',
        ...STANDARD_INPUT,
      });
      expect(() => rates.update(c.id, { rateAmount: 1700 })).not.toThrow();
    });

    it('allows back-to-back contracts that abut without overlap', () => {
      rates.create({
        projectId,
        effectiveFrom: '2025-01-01',
        endDate: '2025-06-30',
        ...STANDARD_INPUT,
      });
      // Same-day abut — '2025-07-01' is one day after the previous end.
      expect(() =>
        rates.create({
          projectId,
          effectiveFrom: '2025-07-01',
          endDate: '2025-12-31',
          ...STANDARD_INPUT,
        }),
      ).not.toThrow();
    });
  });

  describe('activeForProject', () => {
    it('returns the contract that contains the given date', () => {
      const c = rates.create({
        projectId,
        effectiveFrom: '2026-01-01',
        endDate: '2026-12-31',
        ...STANDARD_INPUT,
      });
      expect(rates.activeForProject(projectId, '2026-06-15')?.id).toBe(c.id);
      expect(rates.activeForProject(projectId, '2027-01-01')).toBeNull();
    });

    it('prefers the newer contract when ranges abut on the same day', () => {
      // shouldn't happen in practice because of overlap check, but guards
      // against the LIMIT 1 picking the wrong row by accident
      const a = rates.create({
        projectId,
        effectiveFrom: '2025-01-01',
        endDate: '2025-06-30',
        ...STANDARD_INPUT,
      });
      const b = rates.create({
        projectId,
        effectiveFrom: '2025-07-01',
        ...STANDARD_INPUT,
      });
      expect(rates.activeForProject(projectId, '2025-12-31')?.id).toBe(b.id);
      expect(rates.activeForProject(projectId, '2025-06-30')?.id).toBe(a.id);
    });
  });
});

describe('ContractStatusService', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let worklogs: WorklogsRepo;
  let rates: ProjectRatesRepo;
  let service: ContractStatusService;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);
    rates = new ProjectRatesRepo(db);
    service = new ContractStatusService(db);
  });

  function seedProjectWithWorklogs(opts: {
    minutesByDate: Record<string, number>;
    kind?: 'work' | 'time_off';
  }): number {
    const project = projects.create({ name: 'P', kind: opts.kind ?? 'work' });
    const epic = epics.create({ projectId: project.id, name: 'E' });
    const task = tasks.create({ epicId: epic.id, number: 'X', title: 'X' });
    for (const [date, mins] of Object.entries(opts.minutesByDate)) {
      worklogs.create({ taskId: task.id, workDate: date, minutes: mins });
    }
    return project.id;
  }

  it('sums billable minutes inside the contract period only', () => {
    const projectId = seedProjectWithWorklogs({
      minutesByDate: {
        '2025-12-31': 60, // before contract
        '2026-01-01': 120, // first day
        '2026-02-15': 60,
        '2026-07-01': 60, // after contract
      },
    });
    rates.create({
      projectId,
      effectiveFrom: '2026-01-01',
      endDate: '2026-06-30',
      ...STANDARD_INPUT,
    });
    const status = service.forProject(projectId, '2026-06-30');
    expect(status?.minutesLogged).toBe(180);
    expect(status?.mdsUsed).toBe(round2(180 / 60 / 8));
  });

  it('uses reported_minutes (billable basis) when present, falling back to tracked', () => {
    const project = projects.create({ name: 'P', kind: 'work' });
    const epic = epics.create({ projectId: project.id, name: 'E' });
    const task = tasks.create({ epicId: epic.id, number: 'X', title: 'X' });
    // Tracked 60 but billed 90 — contract MD must follow the billed value, the
    // same EFFECTIVE_MINUTES basis the trend/earnings charts use.
    worklogs.create({ taskId: task.id, workDate: '2026-01-05', minutes: 60, reportedMinutes: 90 });
    // No reported value — tracked minutes are the fallback.
    worklogs.create({ taskId: task.id, workDate: '2026-01-06', minutes: 120 });
    rates.create({
      projectId: project.id,
      effectiveFrom: '2026-01-01',
      endDate: '2026-06-30',
      ...STANDARD_INPUT,
    });
    const status = service.forProject(project.id, '2026-06-30');
    expect(status?.minutesLogged).toBe(210); // 90 (reported) + 120 (tracked)
    expect(status?.mdsUsed).toBe(round2(210 / 60 / 8));
  });

  it('skips non-work projects from MD usage', () => {
    const projectId = seedProjectWithWorklogs({
      minutesByDate: { '2026-01-15': 120 },
      kind: 'time_off',
    });
    rates.create({
      projectId,
      effectiveFrom: '2026-01-01',
      endDate: '2026-12-31',
      ...STANDARD_INPUT,
    });
    expect(service.forProject(projectId, '2026-06-01')?.minutesLogged).toBe(0);
  });

  it('reports MD remaining when md_limit is set', () => {
    const projectId = seedProjectWithWorklogs({
      minutesByDate: { '2026-01-15': 8 * 60 * 5 }, // 5 MD
    });
    rates.create({
      projectId,
      effectiveFrom: '2026-01-01',
      endDate: '2026-12-31',
      mdLimit: 20,
      ...STANDARD_INPUT,
    });
    const status = service.forProject(projectId, '2026-02-01');
    expect(status?.mdsUsed).toBe(5);
    expect(status?.mdsRemaining).toBe(15);
  });

  it('reports isActive true while today is inside the period', () => {
    const projectId = seedProjectWithWorklogs({ minutesByDate: {} });
    rates.create({
      projectId,
      effectiveFrom: '2026-01-01',
      endDate: '2026-12-31',
      ...STANDARD_INPUT,
    });
    expect(service.forProject(projectId, '2026-06-15')?.isActive).toBe(true);
    expect(service.forProject(projectId, '2025-12-31')).toBeNull(); // no active rate before
    expect(service.forProject(projectId, '2027-01-01')).toBeNull(); // no active rate after
  });

  it('projects total MDs based on the elapsed-to-total workday ratio', () => {
    // Contract: 2026-01-05 (Mon) → 2026-01-09 (Fri) — 5 workdays.
    // Today: 2026-01-06 (Tue) — 2 elapsed workdays (Mon, Tue).
    // 1 MD logged so far → projected = 1 × (5 / 2) = 2.5
    const projectId = seedProjectWithWorklogs({
      minutesByDate: { '2026-01-05': 8 * 60 },
    });
    rates.create({
      projectId,
      effectiveFrom: '2026-01-05',
      endDate: '2026-01-09',
      ...STANDARD_INPUT,
    });
    const status = service.forProject(projectId, '2026-01-06');
    expect(status?.elapsedWorkdays).toBe(2);
    expect(status?.totalWorkdays).toBe(5);
    expect(status?.projectedTotalMds).toBe(2.5);
  });

  it('leaves projectedTotalMds null on an open-ended contract', () => {
    const projectId = seedProjectWithWorklogs({
      minutesByDate: { '2026-01-05': 120 },
    });
    rates.create({ projectId, effectiveFrom: '2026-01-05', ...STANDARD_INPUT });
    const status = service.forProject(projectId, '2026-01-15');
    expect(status?.totalWorkdays).toBeNull();
    expect(status?.workdaysRemaining).toBeNull();
    expect(status?.projectedTotalMds).toBeNull();
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
