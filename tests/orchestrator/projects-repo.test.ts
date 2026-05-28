import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('ProjectsRepo', () => {
  let db: SqliteLike;
  let repo: ProjectsRepo;

  beforeEach(() => {
    db = freshDb();
    repo = new ProjectsRepo(db);
  });

  describe('create', () => {
    it('inserts a minimal project with sensible defaults', () => {
      const p = repo.create({ name: 'Watchtower' });
      expect(p.id).toBeGreaterThan(0);
      expect(p.name).toBe('Watchtower');
      expect(p.color).toBe('#1976d2');
      expect(p.kind).toBe('work');
      expect(p.archived).toBe(false);
      expect(p.isDefault).toBe(false);
      expect(p.folderPath).toBeNull();
      expect(p.jiraGlobs).toEqual([]);
      expect(p.jiraBoardUrl).toBeNull();
      expect(p.taskUrlTemplate).toBeNull();
      expect(p.description).toBeNull();
      expect(p.epicCount).toBe(0);
      expect(p.totalMinutes).toBe(0);
    });

    it('round-trips jiraGlobs as a JSON array', () => {
      const p = repo.create({ name: 'PPS', jiraGlobs: ['FIE1933-*', 'KP-*'] });
      expect(p.jiraGlobs).toEqual(['FIE1933-*', 'KP-*']);
      // Re-read from DB to confirm persisted shape (not just in-memory copy)
      const fresh = repo.get(p.id);
      expect(fresh?.jiraGlobs).toEqual(['FIE1933-*', 'KP-*']);
    });

    it('persists folderPath and description', () => {
      const p = repo.create({
        name: 'Watchtower',
        folderPath: '/Users/jan/Projects/Watchtower',
        description: 'Claude Code platform',
      });
      expect(p.folderPath).toBe('/Users/jan/Projects/Watchtower');
      expect(p.description).toBe('Claude Code platform');
    });

    it('kind=work sets is_billable=1; kind=time_off sets is_billable=0', () => {
      repo.create({ name: 'Work', kind: 'work' });
      repo.create({ name: 'Vacation', kind: 'time_off' });
      const rows = db.prepare('SELECT name, is_billable FROM projects ORDER BY name').all() as Array<{ name: string; is_billable: number }>;
      expect(rows).toEqual([
        { name: 'Vacation', is_billable: 0 },
        { name: 'Work', is_billable: 1 },
      ]);
    });
  });

  describe('default flag', () => {
    it('only one project can be default at a time — second create clears the first', () => {
      const a = repo.create({ name: 'A', isDefault: true });
      const b = repo.create({ name: 'B', isDefault: true });
      expect(repo.get(a.id)?.isDefault).toBe(false);
      expect(repo.get(b.id)?.isDefault).toBe(true);
    });

    it('update can promote another project to default (clears previous in the same txn)', () => {
      const a = repo.create({ name: 'A', isDefault: true });
      const b = repo.create({ name: 'B' });
      repo.update(b.id, { isDefault: true });
      expect(repo.get(a.id)?.isDefault).toBe(false);
      expect(repo.get(b.id)?.isDefault).toBe(true);
    });

    it('archiving the default project clears the flag', () => {
      const a = repo.create({ name: 'A', isDefault: true });
      repo.archive(a.id, true);
      const fresh = repo.get(a.id);
      expect(fresh?.archived).toBe(true);
      expect(fresh?.isDefault).toBe(false);
    });
  });

  describe('update', () => {
    it('updates the fields the caller passes, leaves the rest', () => {
      const p = repo.create({
        name: 'Watchtower',
        color: '#7aa7ff',
        description: 'first',
        jiraGlobs: ['WT-*'],
      });
      const updated = repo.update(p.id, { description: 'updated' });
      expect(updated.name).toBe('Watchtower');
      expect(updated.color).toBe('#7aa7ff');
      expect(updated.description).toBe('updated');
      expect(updated.jiraGlobs).toEqual(['WT-*']);
    });

    it('switching kind=time_off→work also flips is_billable', () => {
      const p = repo.create({ name: 'X', kind: 'time_off' });
      let row = db.prepare(`SELECT is_billable FROM projects WHERE id = ?`).get(p.id) as { is_billable: number };
      expect(row.is_billable).toBe(0);

      repo.update(p.id, { kind: 'work' });
      row = db.prepare(`SELECT is_billable FROM projects WHERE id = ?`).get(p.id) as { is_billable: number };
      expect(row.is_billable).toBe(1);
    });

    it('clearing jiraGlobs persists as NULL (not an empty JSON array)', () => {
      const p = repo.create({ name: 'P', jiraGlobs: ['WT-*'] });
      repo.update(p.id, { jiraGlobs: [] });
      const raw = db.prepare(`SELECT jira_globs FROM projects WHERE id = ?`).get(p.id) as { jira_globs: string | null };
      expect(raw.jira_globs).toBeNull();
      expect(repo.get(p.id)?.jiraGlobs).toEqual([]);
    });

    it('round-trips jiraBoardUrl, trimming whitespace and treating empty strings as NULL', () => {
      const url = 'https://jira.skoda.vwgroup.com/secure/RapidBoard.jspa?rapidView=51682&quickFilter=84114';
      const p = repo.create({ name: 'FIE', jiraBoardUrl: `  ${url}  ` });
      expect(p.jiraBoardUrl).toBe(url);
      expect(repo.get(p.id)?.jiraBoardUrl).toBe(url);

      repo.update(p.id, { jiraBoardUrl: '   ' });
      const raw = db.prepare(`SELECT jira_board_url FROM projects WHERE id = ?`).get(p.id) as { jira_board_url: string | null };
      expect(raw.jira_board_url).toBeNull();
      expect(repo.get(p.id)?.jiraBoardUrl).toBeNull();
    });

    it('round-trips taskUrlTemplate, trimming whitespace and treating empty strings as NULL', () => {
      const tpl = 'https://jira.skoda.vwgroup.com/browse/{n}';
      const p = repo.create({ name: 'FIE', taskUrlTemplate: `  ${tpl}  ` });
      expect(p.taskUrlTemplate).toBe(tpl);
      expect(repo.get(p.id)?.taskUrlTemplate).toBe(tpl);

      repo.update(p.id, { taskUrlTemplate: '   ' });
      const raw = db.prepare(`SELECT task_url_template FROM projects WHERE id = ?`).get(p.id) as { task_url_template: string | null };
      expect(raw.task_url_template).toBeNull();
      expect(repo.get(p.id)?.taskUrlTemplate).toBeNull();
    });
  });

  describe('list + filters', () => {
    beforeEach(() => {
      repo.create({ name: 'Watchtower', color: '#7aa7ff', kind: 'work', isDefault: true });
      repo.create({ name: 'PPS Capacity Planning', color: '#f0a868', kind: 'work' });
      repo.create({ name: 'Personal Time off', color: '#9e9e9e', kind: 'time_off' });
      const archived = repo.create({ name: 'Old Project', color: '#444' });
      repo.archive(archived.id, true);
    });

    it('lists active projects by default, default-first then alphabetical', () => {
      const rows = repo.list({ archived: false });
      expect(rows.map((r) => r.name)).toEqual(['Watchtower', 'Personal Time off', 'PPS Capacity Planning']);
    });

    it('archived=true filters down to archived projects only', () => {
      const rows = repo.list({ archived: true });
      expect(rows.map((r) => r.name)).toEqual(['Old Project']);
    });

    it('kind=work narrows to billable projects', () => {
      const rows = repo.list({ archived: false, kind: 'work' });
      expect(rows.map((r) => r.name)).toEqual(['Watchtower', 'PPS Capacity Planning']);
    });

    it('search is case-insensitive substring match on name', () => {
      const rows = repo.list({ archived: false, search: 'pps' });
      expect(rows.map((r) => r.name)).toEqual(['PPS Capacity Planning']);
    });

    it('search + kind combine as AND', () => {
      const rows = repo.list({ archived: false, kind: 'time_off', search: 'personal' });
      expect(rows.map((r) => r.name)).toEqual(['Personal Time off']);
      const empty = repo.list({ archived: false, kind: 'work', search: 'personal' });
      expect(empty).toEqual([]);
    });

    it('empty search string is ignored (does not filter to nothing)', () => {
      const rows = repo.list({ archived: false, search: '   ' });
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('epic + total counts (joined)', () => {
    it('reports zero counts until epics/worklogs land', () => {
      const p = repo.create({ name: 'Watchtower' });
      expect(repo.get(p.id)?.epicCount).toBe(0);
      expect(repo.get(p.id)?.totalMinutes).toBe(0);
    });

    it('counts epics for the project (and only that project)', () => {
      const a = repo.create({ name: 'A' });
      const b = repo.create({ name: 'B' });
      db.prepare(`INSERT INTO epics (project_id, name) VALUES (?, ?)`).run(a.id, 'Phase 1');
      db.prepare(`INSERT INTO epics (project_id, name) VALUES (?, ?)`).run(a.id, 'Phase 2');
      db.prepare(`INSERT INTO epics (project_id, name) VALUES (?, ?)`).run(b.id, 'Solo');
      expect(repo.get(a.id)?.epicCount).toBe(2);
      expect(repo.get(b.id)?.epicCount).toBe(1);
    });

    it('sums minutes across worklogs joined through tasks/epics', () => {
      const p = repo.create({ name: 'P' });
      const epicInfo = db
        .prepare(`INSERT INTO epics (project_id, name) VALUES (?, ?)`)
        .run(p.id, 'E') as { lastInsertRowid: number | bigint };
      const epicId = Number(epicInfo.lastInsertRowid);
      const taskInfo = db
        .prepare(`INSERT INTO tasks (epic_id, number, title) VALUES (?, ?, ?)`)
        .run(epicId, 'T-1', 'Task') as { lastInsertRowid: number | bigint };
      const taskId = Number(taskInfo.lastInsertRowid);
      db.prepare(`INSERT INTO worklogs (task_id, work_date, minutes) VALUES (?, '2026-05-01', 60)`).run(taskId);
      db.prepare(`INSERT INTO worklogs (task_id, work_date, minutes) VALUES (?, '2026-05-02', 30)`).run(taskId);
      expect(repo.get(p.id)?.totalMinutes).toBe(90);
    });
  });

  describe('delete', () => {
    it('removes the row and cascades to epics', () => {
      const p = repo.create({ name: 'X' });
      db.prepare(`INSERT INTO epics (project_id, name) VALUES (?, ?)`).run(p.id, 'E');
      repo.delete(p.id);
      expect(repo.get(p.id)).toBeNull();
      const epicRows = db.prepare(`SELECT * FROM epics`).all();
      expect(epicRows).toEqual([]);
    });
  });
});

describe('migrations · v4 adds folder_path / jira_globs / description', () => {
  it('extends the projects table with the three columns', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('folder_path');
    expect(names).toContain('jira_globs');
    expect(names).toContain('description');
  });

  it('bumps schema version to at least 4', () => {
    // Phase 15 (migration v5) extends the schema further; this assertion
    // just guards against v4 being skipped.
    const db = freshDb();
    const row = db.prepare(`SELECT MAX(version) v FROM schema_version`).get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(4);
  });
});
