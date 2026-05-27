import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

function seedProject(db: SqliteLike, name = 'Watchtower'): number {
  return new ProjectsRepo(db).create({ name }).id;
}

describe('EpicsRepo', () => {
  let db: SqliteLike;
  let epics: EpicsRepo;
  let projectId: number;

  beforeEach(() => {
    db = freshDb();
    projectId = seedProject(db);
    epics = new EpicsRepo(db);
  });

  it('creates an epic with defaults (status=planned, display_order at the end)', () => {
    const e = epics.create({ projectId, name: 'Phase 1' });
    expect(e.id).toBeGreaterThan(0);
    expect(e.projectId).toBe(projectId);
    expect(e.name).toBe('Phase 1');
    expect(e.status).toBe('planned');
    expect(e.displayOrder).toBe(1000);
    expect(e.shortcut).toBeNull();
    expect(e.taskCount).toBe(0);
    expect(e.totalMinutes).toBe(0);
  });

  it('round-trips shortcut on create and update (trimmed; empty → NULL)', () => {
    const e = epics.create({ projectId, name: 'Technology', shortcut: '  TEH  ' });
    expect(e.shortcut).toBe('TEH');

    const updated = epics.update(e.id, { shortcut: '' });
    expect(updated.shortcut).toBeNull();

    const restored = epics.update(e.id, { shortcut: 'VYR' });
    expect(restored.shortcut).toBe('VYR');
  });

  it('appends new epics at the end of the project\'s order', () => {
    const a = epics.create({ projectId, name: 'A' });
    const b = epics.create({ projectId, name: 'B' });
    const c = epics.create({ projectId, name: 'C' });
    expect(a.displayOrder).toBe(1000);
    expect(b.displayOrder).toBe(2000);
    expect(c.displayOrder).toBe(3000);
  });

  it('list orders epics by display_order ascending', () => {
    const a = epics.create({ projectId, name: 'A' });
    const b = epics.create({ projectId, name: 'B' });
    const c = epics.create({ projectId, name: 'C' });
    // Reorder accepts a full ordered list; unlisted ids would keep their
    // existing order (same semantics as InstancesRepo.reorder).
    epics.reorder(projectId, [c.id, a.id, b.id]);
    const list = epics.listForProject(projectId);
    expect(list.map((e) => e.name)).toEqual(['C', 'A', 'B']);
  });

  it('reorder rewrites display_order so the array order wins', () => {
    const a = epics.create({ projectId, name: 'A' });
    const b = epics.create({ projectId, name: 'B' });
    const c = epics.create({ projectId, name: 'C' });
    epics.reorder(projectId, [c.id, a.id, b.id]);
    const list = epics.listForProject(projectId);
    expect(list.map((e) => e.name)).toEqual(['C', 'A', 'B']);
  });

  it('update changes only the supplied fields', () => {
    const e = epics.create({ projectId, name: 'A', status: 'planned' });
    const u = epics.update(e.id, { status: 'active', jiraEpicKey: 'WT-100' });
    expect(u.name).toBe('A');
    expect(u.status).toBe('active');
    expect(u.jiraEpicKey).toBe('WT-100');
  });

  it('listForProject filters by project_id', () => {
    const other = seedProject(db, 'Other');
    epics.create({ projectId, name: 'A' });
    epics.create({ projectId: other, name: 'B' });
    const rows = epics.listForProject(projectId);
    expect(rows.map((e) => e.name)).toEqual(['A']);
  });

  it('delete cascades to tasks (via schema FK)', () => {
    const e = epics.create({ projectId, name: 'X' });
    db.prepare(`INSERT INTO tasks (epic_id, number, title) VALUES (?, 'T-1', 'task')`).run(e.id);
    epics.delete(e.id);
    const tasks = db.prepare(`SELECT * FROM tasks WHERE epic_id = ?`).all(e.id);
    expect(tasks).toEqual([]);
  });
});

describe('TasksRepo', () => {
  let db: SqliteLike;
  let tasks: TasksRepo;
  let epics: EpicsRepo;
  let projectId: number;
  let epicId: number;

  beforeEach(() => {
    db = freshDb();
    projectId = seedProject(db);
    epics = new EpicsRepo(db);
    epicId = epics.create({ projectId, name: 'E' }).id;
    tasks = new TasksRepo(db);
  });

  it('creates a task with defaults (status=open)', () => {
    const t = tasks.create({ epicId, number: 'WT-T1', title: 'Task' });
    expect(t.id).toBeGreaterThan(0);
    expect(t.status).toBe('open');
    expect(t.estimatedMinutes).toBeNull();
    expect(t.description).toBeNull();
    expect(t.totalMinutes).toBe(0);
  });

  it('persists description, status, estimate, and number', () => {
    const t = tasks.create({
      epicId,
      number: 'FIE1933-18887',
      title: 'RFP',
      description: 'Endpoint validation',
      status: 'in_progress',
      estimatedMinutes: 240,
    });
    expect(tasks.get(t.id)).toEqual({
      ...t,
      description: 'Endpoint validation',
      status: 'in_progress',
      estimatedMinutes: 240,
    });
  });

  it('listForEpic narrows to the requested epic', () => {
    const otherEpic = epics.create({ projectId, name: 'F' }).id;
    tasks.create({ epicId, number: 'A-1', title: 'A' });
    tasks.create({ epicId: otherEpic, number: 'B-1', title: 'B' });
    const rows = tasks.listForEpic(epicId);
    expect(rows.map((t) => t.number)).toEqual(['A-1']);
  });

  it('listForProject joins through epics and sorts by epic display_order, then task id', () => {
    const epicA = epics.create({ projectId, name: 'A' }).id; // display_order 2000
    tasks.create({ epicId, number: 'E1-T1', title: 'T1' });
    tasks.create({ epicId: epicA, number: 'A-T1', title: 'T1' });
    tasks.create({ epicId, number: 'E1-T2', title: 'T2' });
    // Reorder so epicA (initially second) comes first
    epics.reorder(projectId, [epicA, epicId]);
    const rows = tasks.listForProject(projectId);
    expect(rows.map((t) => t.number)).toEqual(['A-T1', 'E1-T1', 'E1-T2']);
  });

  it('update can move a task to a different epic', () => {
    const newEpic = epics.create({ projectId, name: 'F' }).id;
    const t = tasks.create({ epicId, number: 'X-1', title: 'X' });
    tasks.update(t.id, { epicId: newEpic });
    expect(tasks.get(t.id)?.epicId).toBe(newEpic);
  });

  it('totalMinutes sums worklogs joined to the task', () => {
    const t = tasks.create({ epicId, number: 'X-1', title: 'X' });
    db.prepare(`INSERT INTO worklogs (task_id, work_date, minutes) VALUES (?, '2026-05-01', 60)`).run(t.id);
    db.prepare(`INSERT INTO worklogs (task_id, work_date, minutes) VALUES (?, '2026-05-02', 45)`).run(t.id);
    expect(tasks.get(t.id)?.totalMinutes).toBe(105);
  });

  it('delete cascades to worklogs', () => {
    const t = tasks.create({ epicId, number: 'X', title: 'X' });
    db.prepare(`INSERT INTO worklogs (task_id, work_date, minutes) VALUES (?, '2026-05-01', 30)`).run(t.id);
    tasks.delete(t.id);
    const rows = db.prepare(`SELECT * FROM worklogs WHERE task_id = ?`).all(t.id);
    expect(rows).toEqual([]);
  });

  describe('jira fields', () => {
    it('findByNumber returns null when the key does not exist', () => {
      expect(tasks.findByNumber('FIE1933-99999')).toBeNull();
    });

    it('findByNumber returns the row when it exists', () => {
      const t = tasks.create({ epicId, number: 'FIE1933-19796', title: 'foo' });
      const found = tasks.findByNumber('FIE1933-19796');
      expect(found?.id).toBe(t.id);
      expect(found?.number).toBe('FIE1933-19796');
    });

    it('updateJiraFields persists status/estimate/component/syncedAt', () => {
      const t = tasks.create({ epicId, number: 'FIE1933-19796', title: 'foo' });
      tasks.updateJiraFields(t.id, {
        jiraStatus: 'In Review',
        estimateSeconds: 14400,
        component: 'TEH-Vzory',
        syncedAt: '2026-05-26T14:32:00.000Z',
      });
      const got = tasks.get(t.id)!;
      expect(got.jiraStatus).toBe('In Review');
      expect(got.jiraEstimateSecs).toBe(14400);
      expect(got.jiraComponent).toBe('TEH-Vzory');
      expect(got.jiraSyncedAt).toBe('2026-05-26T14:32:00.000Z');
    });

    it('clearJiraStatusExceptForProject clears rows whose number is NOT in the keep-set', () => {
      const a = tasks.create({ epicId, number: 'A-1', title: 'a' });
      const b = tasks.create({ epicId, number: 'A-2', title: 'b' });
      const c = tasks.create({ epicId, number: 'A-3', title: 'c' });
      for (const id of [a.id, b.id, c.id]) {
        tasks.updateJiraFields(id, {
          jiraStatus: 'To Do',
          estimateSeconds: null,
          component: null,
          syncedAt: '2026-05-26T00:00:00Z',
        });
      }
      const cleared = tasks.clearJiraStatusExceptForProject(projectId, ['A-1', 'A-2']);
      expect(cleared).toBe(1);
      expect(tasks.get(a.id)?.jiraStatus).toBe('To Do');
      expect(tasks.get(b.id)?.jiraStatus).toBe('To Do');
      expect(tasks.get(c.id)?.jiraStatus).toBeNull();
    });

    it('clearJiraStatusExceptForProject with an empty keep-set clears all rows in that project', () => {
      const a = tasks.create({ epicId, number: 'A-1', title: 'a' });
      tasks.updateJiraFields(a.id, {
        jiraStatus: 'To Do',
        estimateSeconds: null,
        component: null,
        syncedAt: '2026-05-26T00:00:00Z',
      });
      const cleared = tasks.clearJiraStatusExceptForProject(projectId, []);
      expect(cleared).toBe(1);
      expect(tasks.get(a.id)?.jiraStatus).toBeNull();
    });

    it('clearJiraStatusExceptForProject leaves tasks in other projects untouched', () => {
      const otherProjectId = seedProject(db, 'Other');
      const otherEpic = epics.create({ projectId: otherProjectId, name: 'X' });
      const here = tasks.create({ epicId, number: 'H-1', title: 'here' });
      const there = tasks.create({ epicId: otherEpic.id, number: 'T-1', title: 'there' });
      for (const id of [here.id, there.id]) {
        tasks.updateJiraFields(id, {
          jiraStatus: 'To Do',
          estimateSeconds: null,
          component: null,
          syncedAt: '2026-05-26T00:00:00Z',
        });
      }
      const cleared = tasks.clearJiraStatusExceptForProject(projectId, []);
      expect(cleared).toBe(1);
      expect(tasks.get(here.id)?.jiraStatus).toBeNull();
      expect(tasks.get(there.id)?.jiraStatus).toBe('To Do');
    });
  });
});

describe('migrations · v5 extends epics + tasks', () => {
  it('adds display_order / status / jira_epic_key / github_issue_url to epics', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(epics)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('display_order');
    expect(names).toContain('status');
    expect(names).toContain('jira_epic_key');
    expect(names).toContain('github_issue_url');
  });

  it('adds description to tasks', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('description');
  });

  it('bumps schema version to 8', () => {
    const db = freshDb();
    const row = db.prepare(`SELECT MAX(version) v FROM schema_version`).get() as { v: number };
    expect(row.v).toBe(8);
  });
});
