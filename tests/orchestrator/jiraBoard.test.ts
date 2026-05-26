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

  it('orders cards by estimate desc (NULLs last) then key asc', () => {
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

// ─── sync ───────────────────────────────────────────────────────────────────

function makeFetchDeps(opts: {
  cookies: string[];
  responses: Array<{ status: number; body?: unknown }>;
  refresh?: () => Promise<void>;
  calls?: Array<{ url: string; body?: unknown }>;
}): BoardSyncDeps {
  let ci = 0;
  let fi = 0;
  return {
    readCookie: () => opts.cookies[Math.min(ci++, opts.cookies.length - 1)] ?? '',
    runRefresh: opts.refresh ?? (async () => {}),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const r = opts.responses[Math.min(fi, opts.responses.length - 1)]!;
      fi += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      opts.calls?.push({ url: String(input), body });
      return new Response(
        r.body !== undefined ? JSON.stringify(r.body) : null,
        { status: r.status },
      );
    }) as typeof fetch,
    now: () => new Date('2026-05-26T14:32:00Z'),
  };
}

function jiraIssue(
  key: string,
  summary: string,
  status: string,
  estimateSecs: number | null,
  labels: string[] = [],
) {
  return {
    key,
    fields: {
      summary,
      status: { name: status },
      timeoriginalestimate: estimateSecs,
      labels,
      components: [],
    },
  };
}

describe('JiraBoardService.sync', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let pps: ReturnType<ProjectsRepo['create']>;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    pps = projects.create({
      name: 'PPS',
      color: '#7aa7ff',
      jiraGlobs: ['FIE1933-*'],
    });
  });

  it('creates new tasks under auto-created epics by area code', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        calls,
        responses: [
          {
            status: 200,
            body: {
              issues: [
                jiraIssue('FIE1933-19796', '[VYR] Požadavky na Materiál', 'In Review', 14400, ['VYR-Logistika']),
                jiraIssue('FIE1933-19845', '[TEH] Požadavek na Změnu',    'To Do',     21600, ['TEH-Změny']),
              ],
            },
          },
        ],
      }),
    });

    const r = await svc.sync();
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(2);
    expect(r.created).toBe(2);
    expect(r.upserted).toBe(2);
    expect(r.unrouted).toBe(0);
    expect(r.removedFromBoard).toBe(0);
    expect(calls[0]!.url).toContain('/rest/api/2/search');

    const vyr = tasks.findByNumber('FIE1933-19796')!;
    const teh = tasks.findByNumber('FIE1933-19845')!;
    expect(vyr.jiraStatus).toBe('In Review');
    expect(vyr.jiraEstimateSecs).toBe(14400);
    expect(vyr.jiraComponent).toBe('VYR-Logistika');
    expect(teh.jiraStatus).toBe('To Do');

    const allEpics = epics.listForProject(pps.id);
    expect(allEpics.map((e) => e.name).sort()).toEqual(['TEH', 'VYR']);
  });

  it('updates an existing task without re-routing its epic', async () => {
    const original = epics.create({ projectId: pps.id, name: 'PreExisting' });
    const t = tasks.create({ epicId: original.id, number: 'FIE1933-1', title: 'old title' });

    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: { issues: [jiraIssue('FIE1933-1', '[TEH] new title', 'In Progress', 3600)] },
          },
        ],
      }),
    });
    const r = await svc.sync();
    expect(r.created).toBe(0);
    expect(r.upserted).toBe(1);
    const updated = tasks.get(t.id)!;
    expect(updated.title).toBe('[TEH] new title');
    expect(updated.epicId).toBe(original.id);
    expect(updated.jiraStatus).toBe('In Progress');
    expect(updated.status).toBe('in_progress');
  });

  it('counts and lists unrouted keys when no project glob matches', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          { status: 200, body: { issues: [jiraIssue('OTHER-1', '[X] foo', 'To Do', null)] } },
        ],
      }),
    });
    const r = await svc.sync();
    expect(r.unrouted).toBe(1);
    expect(r.unroutedKeys).toEqual(['OTHER-1']);
    expect(tasks.findByNumber('OTHER-1')).toBeNull();
  });

  it('clears jira_status on tasks that fell off the board', async () => {
    const epic = epics.create({ projectId: pps.id, name: 'TEH' });
    const t = tasks.create({ epicId: epic.id, number: 'FIE1933-OLD', title: 'old' });
    tasks.updateJiraFields(t.id, {
      jiraStatus: 'To Do',
      estimateSeconds: null,
      component: null,
      syncedAt: '2026-05-25T10:00:00Z',
    });

    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          { status: 200, body: { issues: [jiraIssue('FIE1933-NEW', '[TEH] new', 'To Do', null)] } },
        ],
      }),
    });
    const r = await svc.sync();
    expect(r.removedFromBoard).toBe(1);
    expect(tasks.get(t.id)!.jiraStatus).toBeNull();
  });

  it('returns an auth error on 401 (does NOT auto-refresh)', async () => {
    let refreshed = 0;
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['stale'],
        refresh: async () => {
          refreshed += 1;
        },
        responses: [{ status: 401 }],
      }),
    });
    const r = await svc.sync();
    expect(refreshed).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sign in/i);
    expect(r.neededBrowserRefresh).toBe(false);
  });

  it('returns an auth error when no cookie is stored (signed out)', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: [''],
        responses: [{ status: 200, body: { issues: [] } }],
      }),
    });
    const r = await svc.sync();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sign in/i);
    expect(r.fetched).toBe(0);
  });

  it('returns ok=false with an error when not configured', async () => {
    const svc = new JiraBoardService(db, {
      config: { ...CONFIG, baseUrl: '' },
      deps: makeFetchDeps({ cookies: [''], responses: [{ status: 200 }] }),
    });
    const r = await svc.sync();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });

  it('prefers a Jira components entry over a label for the chip', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        calls,
        responses: [
          {
            status: 200,
            body: {
              issues: [
                {
                  key: 'FIE1933-2',
                  fields: {
                    summary: '[TEH] foo',
                    status: { name: 'To Do' },
                    timeoriginalestimate: 3600,
                    labels: ['LabelOnly'],
                    components: [{ name: 'TEH-Vzory' }],
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    await svc.sync();
    expect(tasks.findByNumber('FIE1933-2')!.jiraComponent).toBe('TEH-Vzory');
  });
});
