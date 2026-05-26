import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import {
  JiraBoardService,
  type BoardSyncDeps,
} from '../../orchestrator/services/jiraBoard.js';
import type { JiraConfig } from '../../orchestrator/services/jiraSync.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

const CONFIG: JiraConfig = {
  baseUrl: 'https://jira.test',
  keychainService: 'test-service',
  keychainAccount: 'test-account',
  refreshScript: '/tmp/refresh.js',
};

function fakeDeps(overrides: Partial<BoardSyncDeps> = {}): BoardSyncDeps {
  return {
    readCookie: () => 'session=abc',
    runRefresh: async () => {},
    fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    now: () => new Date('2026-05-26T14:32:00Z'),
    ...overrides,
  };
}

describe('JiraBoardService.authPing', () => {
  it('reports configured + cookiePresent when env and Keychain are set', () => {
    const svc = new JiraBoardService(freshDb(), { config: CONFIG, deps: fakeDeps() });
    const r = svc.authPing();
    expect(r.configured).toBe(true);
    expect(r.cookiePresent).toBe(true);
    expect(r.baseUrl).toBe('https://jira.test');
  });

  it('reports cookiePresent=false when Keychain entry is missing', () => {
    const svc = new JiraBoardService(freshDb(), {
      config: CONFIG,
      deps: fakeDeps({ readCookie: () => '' }),
    });
    expect(svc.authPing().cookiePresent).toBe(false);
  });

  it('reports configured=false when baseUrl or account is empty', () => {
    const svc = new JiraBoardService(freshDb(), {
      config: { ...CONFIG, baseUrl: '' },
      deps: fakeDeps(),
    });
    const r = svc.authPing();
    expect(r.configured).toBe(false);
    expect(r.cookiePresent).toBe(false);
    expect(r.baseUrl).toBeNull();
  });
});

describe('JiraBoardService.getSnapshot', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
  });

  it('returns only tasks with jira_status set, mapped to columns', () => {
    const p = projects.create({ name: 'PPS', color: '#7aa7ff' });
    const e = epics.create({ projectId: p.id, name: 'TEH' });
    const a = tasks.create({ epicId: e.id, number: 'FIE-1', title: 'a' });
    const b = tasks.create({ epicId: e.id, number: 'FIE-2', title: 'b' });
    /* c has no jira_status — must NOT appear */
    tasks.create({ epicId: e.id, number: 'FIE-3', title: 'c' });
    tasks.updateJiraFields(a.id, {
      jiraStatus: 'To Do',
      estimateSeconds: 21600,
      component: 'TEH-X',
      syncedAt: '2026-05-26T14:32:00Z',
    });
    tasks.updateJiraFields(b.id, {
      jiraStatus: 'In Progress',
      estimateSeconds: 7200,
      component: null,
      syncedAt: '2026-05-26T14:32:00Z',
    });

    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    const snap = svc.getSnapshot();
    expect(snap.cards.map((x) => x.jiraKey).sort()).toEqual(['FIE-1', 'FIE-2']);
    const m = Object.fromEntries(snap.cards.map((x) => [x.jiraKey, x.column]));
    expect(m['FIE-1']).toBe('todo');
    expect(m['FIE-2']).toBe('doing');
    expect(snap.syncedAt).toBe('2026-05-26T14:32:00Z');
  });

  it('maps every documented Jira status to the right column', () => {
    const p = projects.create({ name: 'PPS', color: '#7aa7ff' });
    const e = epics.create({ projectId: p.id, name: 'TEH' });
    const cases: Array<[string, 'todo' | 'doing' | 'done']> = [
      ['To Do', 'todo'],
      ['In Progress', 'doing'],
      ['Waiting', 'doing'],
      ['In Review', 'doing'],
      ['In Test', 'done'],
      ['To Accept', 'done'],
      ['Done', 'done'],
    ];
    cases.forEach(([status], i) => {
      const t = tasks.create({ epicId: e.id, number: `K-${i}`, title: status });
      tasks.updateJiraFields(t.id, {
        jiraStatus: status,
        estimateSeconds: null,
        component: null,
        syncedAt: '2026-05-26T14:32:00Z',
      });
    });
    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    const snap = svc.getSnapshot();
    const byStatus = Object.fromEntries(
      snap.cards.map((x) => [x.jiraStatus, x.column]),
    );
    for (const [status, col] of cases) expect(byStatus[status]).toBe(col);
  });

  it('orders cards by estimate desc then key asc within a snapshot', () => {
    const p = projects.create({ name: 'PPS', color: '#7aa7ff' });
    const e = epics.create({ projectId: p.id, name: 'TEH' });
    const a = tasks.create({ epicId: e.id, number: 'AAA-1', title: 'a' });
    const b = tasks.create({ epicId: e.id, number: 'BBB-1', title: 'b' });
    const c = tasks.create({ epicId: e.id, number: 'CCC-1', title: 'c' });
    tasks.updateJiraFields(a.id, { jiraStatus: 'To Do', estimateSeconds: 3600, component: null, syncedAt: 's' });
    tasks.updateJiraFields(b.id, { jiraStatus: 'To Do', estimateSeconds: 14400, component: null, syncedAt: 's' });
    tasks.updateJiraFields(c.id, { jiraStatus: 'To Do', estimateSeconds: 3600, component: null, syncedAt: 's' });
    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    expect(svc.getSnapshot().cards.map((x) => x.jiraKey)).toEqual(['BBB-1', 'AAA-1', 'CCC-1']);
  });
});
