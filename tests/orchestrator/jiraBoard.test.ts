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
  parseJiraBoardUrl,
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

const BOARD_URL =
  'https://jira.test/secure/RapidBoard.jspa?rapidView=51682&projectKey=FIE1933';
const BOARD_URL_WITH_QF =
  'https://jira.test/secure/RapidBoard.jspa?rapidView=51682&projectKey=FIE1933&quickFilter=84114';

function fakeDeps(overrides: Partial<BoardSyncDeps> = {}): BoardSyncDeps {
  return {
    readCookie: () => 'session=abc',
    runRefresh: async () => {},
    fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    now: () => new Date('2026-05-26T14:32:00Z'),
    ...overrides,
  };
}

describe('parseJiraBoardUrl', () => {
  it('reads rapidView as the board id', () => {
    expect(parseJiraBoardUrl(BOARD_URL)).toEqual({ boardId: 51682, quickFilterId: null });
  });
  it('reads quickFilter when present', () => {
    expect(parseJiraBoardUrl(BOARD_URL_WITH_QF)).toEqual({
      boardId: 51682,
      quickFilterId: 84114,
    });
  });
  it('returns null for nonsense', () => {
    expect(parseJiraBoardUrl(null)).toBeNull();
    expect(parseJiraBoardUrl('')).toBeNull();
    expect(parseJiraBoardUrl('not a url')).toBeNull();
    expect(parseJiraBoardUrl('https://jira.test/browse/FIE-1')).toBeNull();
    expect(parseJiraBoardUrl('https://jira.test/?rapidView=notnumeric')).toBeNull();
  });
  it('trims whitespace before parsing', () => {
    expect(parseJiraBoardUrl(`  ${BOARD_URL}  `)).toEqual({ boardId: 51682, quickFilterId: null });
  });
});

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
  let pps: ReturnType<ProjectsRepo['create']>;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    pps = projects.create({ name: 'PPS', color: '#7aa7ff', jiraBoardUrl: BOARD_URL });
  });

  it('returns only tasks with jira_status set, mapped to columns', () => {
    const e = epics.create({ projectId: pps.id, name: 'TEH' });
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
    const snap = svc.getSnapshot(pps.id);
    expect(snap.cards.map((x) => x.jiraKey).sort()).toEqual(['FIE-1', 'FIE-2']);
    const m = Object.fromEntries(snap.cards.map((x) => [x.jiraKey, x.column]));
    expect(m['FIE-1']).toBe('todo');
    expect(m['FIE-2']).toBe('doing');
    expect(snap.syncedAt).toBe('2026-05-26T14:32:00Z');
  });

  it('returns only the requested project\'s tasks', () => {
    const other = projects.create({ name: 'Other', color: '#000', jiraBoardUrl: BOARD_URL });
    const eHere = epics.create({ projectId: pps.id, name: 'A' });
    const eThere = epics.create({ projectId: other.id, name: 'B' });
    const here = tasks.create({ epicId: eHere.id, number: 'H-1', title: 'here' });
    const there = tasks.create({ epicId: eThere.id, number: 'T-1', title: 'there' });
    for (const t of [here, there]) {
      tasks.updateJiraFields(t.id, {
        jiraStatus: 'To Do',
        estimateSeconds: null,
        component: null,
        syncedAt: '2026-05-26T14:32:00Z',
      });
    }
    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    expect(svc.getSnapshot(pps.id).cards.map((c) => c.jiraKey)).toEqual(['H-1']);
    expect(svc.getSnapshot(other.id).cards.map((c) => c.jiraKey)).toEqual(['T-1']);
  });

  it('maps every documented Jira status to the right column', () => {
    const e = epics.create({ projectId: pps.id, name: 'TEH' });
    const cases: Array<[string, 'todo' | 'doing' | 'done']> = [
      ['New', 'todo'],
      ['To Do', 'todo'],
      ['In Progress', 'doing'],
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
    const snap = svc.getSnapshot(pps.id);
    const byStatus = Object.fromEntries(
      snap.cards.map((x) => [x.jiraStatus, x.column]),
    );
    for (const [status, col] of cases) expect(byStatus[status]).toBe(col);
  });

  it('hides tasks whose jira_status is "Waiting" from the snapshot', () => {
    const e = epics.create({ projectId: pps.id, name: 'TEH' });
    const visible = tasks.create({ epicId: e.id, number: 'V-1', title: 'visible' });
    const hidden = tasks.create({ epicId: e.id, number: 'W-1', title: 'waiting' });
    tasks.updateJiraFields(visible.id, {
      jiraStatus: 'In Progress',
      estimateSeconds: null,
      component: null,
      syncedAt: '2026-05-26T14:32:00Z',
    });
    tasks.updateJiraFields(hidden.id, {
      jiraStatus: 'Waiting',
      estimateSeconds: null,
      component: null,
      syncedAt: '2026-05-26T14:32:00Z',
    });
    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    expect(svc.getSnapshot(pps.id).cards.map((c) => c.jiraKey)).toEqual(['V-1']);
  });

  it('orders cards by estimate desc (NULLs last) then key asc', () => {
    const e = epics.create({ projectId: pps.id, name: 'TEH' });
    const a = tasks.create({ epicId: e.id, number: 'AAA-1', title: 'a' });
    const b = tasks.create({ epicId: e.id, number: 'BBB-1', title: 'b' });
    const c = tasks.create({ epicId: e.id, number: 'CCC-1', title: 'c' });
    tasks.updateJiraFields(a.id, { jiraStatus: 'To Do', estimateSeconds: 3600, component: null, syncedAt: 's' });
    tasks.updateJiraFields(b.id, { jiraStatus: 'To Do', estimateSeconds: 14400, component: null, syncedAt: 's' });
    tasks.updateJiraFields(c.id, { jiraStatus: 'To Do', estimateSeconds: 3600, component: null, syncedAt: 's' });
    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    expect(svc.getSnapshot(pps.id).cards.map((x) => x.jiraKey)).toEqual(['BBB-1', 'AAA-1', 'CCC-1']);
  });
});

// ─── sync ───────────────────────────────────────────────────────────────────

function makeFetchDeps(opts: {
  cookies: string[];
  responses: Array<{ status: number; body?: unknown }>;
  refresh?: () => Promise<void>;
  calls?: Array<{ url: string; method: string; body?: unknown }>;
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
      opts.calls?.push({ url: String(input), method: init?.method ?? 'GET', body });
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
      jiraBoardUrl: BOARD_URL,
    });
  });

  it('hits the Agile board endpoint and creates new tasks under auto-created epics', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
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
              isLast: true,
            },
          },
        ],
      }),
    });

    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(2);
    expect(r.created).toBe(2);
    expect(r.upserted).toBe(2);
    expect(r.unrouted).toBe(0);
    expect(r.removedFromBoard).toBe(0);
    expect(calls[0]!.url).toContain('/rest/agile/1.0/board/51682/issue');
    expect(calls[0]!.method).toBe('GET');
    // JQL always narrows to current user even without a quickFilter
    expect(new URL(calls[0]!.url).searchParams.get('jql')).toBe(
      'sprint in openSprints() AND assignee = currentUser()',
    );

    const vyr = tasks.findByNumber('FIE1933-19796')!;
    const teh = tasks.findByNumber('FIE1933-19845')!;
    expect(vyr.jiraStatus).toBe('In Review');
    expect(vyr.jiraEstimateSecs).toBe(14400);
    expect(vyr.jiraComponent).toBe('VYR-Logistika');
    expect(teh.jiraStatus).toBe('To Do');

    const allEpics = epics.listForProject(pps.id);
    expect(allEpics.map((e) => e.name).sort()).toEqual(['TEH', 'VYR']);
  });

  it('lists the board quickfilters and forwards the matching JQL to the board issue endpoint (array response)', async () => {
    projects.update(pps.id, { jiraBoardUrl: BOARD_URL_WITH_QF });
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        calls,
        responses: [
          // 1. /board/51682/quickfilter — raw array shape (older Jira Server)
          {
            status: 200,
            body: [
              { id: 12345, name: 'Other filter', jql: 'project = OTHER' },
              { id: 84114, name: 'My quick filter', jql: 'priority = Highest OR labels = urgent' },
            ],
          },
          // 2. /board/51682/issue — board search
          { status: 200, body: { issues: [jiraIssue('FIE1933-1', '[TEH] foo', 'To Do', null)], isLast: true } },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(true);
    const qfUrl = new URL(calls[0]!.url);
    expect(qfUrl.pathname).toBe('/rest/agile/1.0/board/51682/quickfilter');
    expect(calls[0]!.method).toBe('GET');
    const boardCallUrl = new URL(calls[1]!.url);
    expect(boardCallUrl.pathname).toBe('/rest/agile/1.0/board/51682/issue');
    // Quickfilter JQL parenthesised so its OR doesn't bleed past the AND
    expect(boardCallUrl.searchParams.get('jql')).toBe(
      '(priority = Highest OR labels = urgent) AND sprint in openSprints() AND assignee = currentUser()',
    );
  });

  it('accepts the paginated {values: [...]} shape of the quickfilter list', async () => {
    projects.update(pps.id, { jiraBoardUrl: BOARD_URL_WITH_QF });
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: {
              isLast: true,
              startAt: 0,
              maxResults: 50,
              total: 1,
              values: [{ id: 84114, name: 'qf', jql: 'sprint in openSprints()' }],
            },
          },
          { status: 200, body: { issues: [], isLast: true } },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(true);
  });

  it('proceeds with a warning when the quickFilter is not on this board', async () => {
    projects.update(pps.id, { jiraBoardUrl: BOARD_URL_WITH_QF });
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        calls,
        responses: [
          // LIST returns OK but doesn't include 84114
          { status: 200, body: [{ id: 99999, name: 'something else', jql: 'foo = bar' }] },
          // The board issue call still happens
          { status: 200, body: { issues: [jiraIssue('FIE1933-1', '[TEH] foo', 'To Do', null)], isLast: true } },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/quickFilter 84114/);
    expect(r.warning).toMatch(/base filter/);
    // The board issue call still narrows to current user + open sprints
    // even when the quickFilter couldn't be applied — only the quickFilter
    // overlay drops.
    const boardCallUrl = new URL(calls[1]!.url);
    expect(boardCallUrl.searchParams.get('jql')).toBe(
      'sprint in openSprints() AND assignee = currentUser()',
    );
  });

  it('proceeds with a warning when the quickFilter list endpoint 404s entirely', async () => {
    projects.update(pps.id, { jiraBoardUrl: BOARD_URL_WITH_QF });
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          // LIST returns 404 — Skoda's Jira doesn't expose this endpoint
          { status: 404, body: { message: 'HTTP 404 Not Found', 'status-code': 404 } },
          { status: 200, body: { issues: [jiraIssue('FIE1933-1', '[TEH] foo', 'To Do', null)], isLast: true } },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/quickFilter 84114/);
    expect(r.fetched).toBe(1);
  });

  it('paginates the board endpoint until isLast', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const page1Issues = Array.from({ length: 200 }, (_, i) =>
      jiraIssue(`FIE1933-${i + 1}`, `[TEH] t${i}`, 'To Do', null),
    );
    const page2Issues = [jiraIssue('FIE1933-201', '[TEH] t201', 'To Do', null)];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        calls,
        responses: [
          { status: 200, body: { issues: page1Issues, isLast: false } },
          { status: 200, body: { issues: page2Issues, isLast: true } },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(201);
    expect(new URL(calls[0]!.url).searchParams.get('startAt')).toBe('0');
    expect(new URL(calls[1]!.url).searchParams.get('startAt')).toBe('200');
  });

  it('routes to an existing epic whose shortcut appears in the Jira epic name', async () => {
    // Pre-existing local epic with a user-configured shortcut.
    const technology = epics.create({
      projectId: pps.id,
      name: 'Technology',
      shortcut: 'TEH',
    });

    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: 'customfield_10006',
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: {
              issues: [{
                key: 'FIE1933-99',
                fields: {
                  summary: 'Něco důležitého',
                  status: { name: 'In Progress' },
                  timeoriginalestimate: 3600,
                  labels: [],
                  components: [],
                  customfield_10006: 'TEH-456',
                },
              }],
              isLast: true,
            },
          },
          {
            status: 200,
            body: {
              issues: [
                { key: 'TEH-456', fields: { summary: 'TEH - Technologický postup' } },
              ],
            },
          },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.created).toBe(1);

    const task = tasks.findByNumber('FIE1933-99')!;
    expect(task.epicId).toBe(technology.id);
    // Did NOT create a sibling epic — the existing "Technology" was reused
    expect(epics.listForProject(pps.id)).toHaveLength(1);
  });

  it('creates a new epic with shortcut auto-populated when nothing matches', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: 'customfield_10006',
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: {
              issues: [{
                key: 'FIE1933-99',
                fields: {
                  summary: 'foo',
                  status: { name: 'In Progress' },
                  timeoriginalestimate: 3600,
                  labels: [],
                  components: [],
                  customfield_10006: 'TEH-456',
                },
              }],
              isLast: true,
            },
          },
          {
            status: 200,
            body: {
              issues: [
                { key: 'TEH-456', fields: { summary: 'TEH - Technologický postup' } },
              ],
            },
          },
        ],
      }),
    });
    await svc.sync(pps.id);

    const epic = epics.get(tasks.findByNumber('FIE1933-99')!.epicId)!;
    expect(epic.name).toBe('TEH');
    expect(epic.shortcut).toBe('TEH');
    // Categorical epic, no per-Jira-key mirroring.
    expect(epic.jiraEpicKey).toBeNull();
  });

  it('routes multiple tasks linked to different Jira epics with the same shortcut into one local epic', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: 'customfield_10006',
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: {
              issues: [
                {
                  key: 'FIE1933-1',
                  fields: {
                    summary: 'task a', status: { name: 'To Do' },
                    timeoriginalestimate: null, labels: [], components: [],
                    customfield_10006: 'TEH-456',
                  },
                },
                {
                  key: 'FIE1933-2',
                  fields: {
                    summary: 'task b', status: { name: 'To Do' },
                    timeoriginalestimate: null, labels: [], components: [],
                    customfield_10006: 'TEH-789',
                  },
                },
              ],
              isLast: true,
            },
          },
          {
            status: 200,
            body: {
              issues: [
                { key: 'TEH-456', fields: { summary: 'TEH - Postup A' } },
                { key: 'TEH-789', fields: { summary: 'TEH - Postup B' } },
              ],
            },
          },
        ],
      }),
    });
    await svc.sync(pps.id);
    const allEpics = epics.listForProject(pps.id);
    expect(allEpics.filter((e) => e.name === 'TEH')).toHaveLength(1);
    const teh = allEpics.find((e) => e.name === 'TEH')!;
    expect(tasks.findByNumber('FIE1933-1')!.epicId).toBe(teh.id);
    expect(tasks.findByNumber('FIE1933-2')!.epicId).toBe(teh.id);
  });

  it('preserves mixed-case shortcuts like Infrastruktura', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: 'customfield_10006',
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: {
              issues: [{
                key: 'FIE1933-50',
                fields: {
                  summary: 'patch', status: { name: 'To Do' },
                  timeoriginalestimate: null, labels: [], components: [],
                  customfield_10006: 'INFRA-12',
                },
              }],
              isLast: true,
            },
          },
          {
            status: 200,
            body: { issues: [{ key: 'INFRA-12', fields: { summary: 'Infrastruktura - Síť' } }] },
          },
        ],
      }),
    });
    await svc.sync(pps.id);
    const epic = epics.get(tasks.findByNumber('FIE1933-50')!.epicId)!;
    expect(epic.name).toBe('Infrastruktura');
  });

  it('reuses an existing local epic with the same shortcut name (no duplicate created)', async () => {
    // Pre-existing local "TEH" epic — could've been created manually or by
    // a prior sync. The shortcut router must find it, not create a sibling.
    const existing = epics.create({ projectId: pps.id, name: 'TEH' });
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: 'customfield_10006',
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          {
            status: 200,
            body: {
              issues: [{
                key: 'FIE1933-77',
                fields: {
                  summary: 'foo', status: { name: 'To Do' },
                  timeoriginalestimate: null, labels: [], components: [],
                  customfield_10006: 'TEH-456',
                },
              }],
              isLast: true,
            },
          },
          {
            status: 200,
            body: { issues: [{ key: 'TEH-456', fields: { summary: 'TEH - foo' } }] },
          },
        ],
      }),
    });
    await svc.sync(pps.id);
    const allEpics = epics.listForProject(pps.id);
    expect(allEpics).toHaveLength(1);
    expect(allEpics[0]!.id).toBe(existing.id);
    expect(tasks.findByNumber('FIE1933-77')!.epicId).toBe(existing.id);
  });

  it('clears jira_status on tasks that fell off the board, scoped to the project', async () => {
    const epic = epics.create({ projectId: pps.id, name: 'TEH' });
    const t = tasks.create({ epicId: epic.id, number: 'FIE1933-OLD', title: 'old' });
    tasks.updateJiraFields(t.id, {
      jiraStatus: 'To Do',
      estimateSeconds: null,
      component: null,
      syncedAt: '2026-05-25T10:00:00Z',
    });
    // A task in another project should stay untouched.
    const other = projects.create({ name: 'Other', color: '#000', jiraBoardUrl: BOARD_URL });
    const otherEpic = epics.create({ projectId: other.id, name: 'Z' });
    const stranger = tasks.create({ epicId: otherEpic.id, number: 'OTHER-1', title: 'untouched' });
    tasks.updateJiraFields(stranger.id, {
      jiraStatus: 'To Do',
      estimateSeconds: null,
      component: null,
      syncedAt: '2026-05-25T10:00:00Z',
    });

    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          { status: 200, body: { issues: [jiraIssue('FIE1933-NEW', '[TEH] new', 'To Do', null)], isLast: true } },
        ],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.removedFromBoard).toBe(1);
    expect(tasks.get(t.id)!.jiraStatus).toBeNull();
    expect(tasks.get(stranger.id)!.jiraStatus).toBe('To Do');
  });

  it('returns an auth error on 401 (does NOT auto-refresh)', async () => {
    let refreshed = 0;
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['stale'],
        refresh: async () => {
          refreshed += 1;
        },
        responses: [{ status: 401 }],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(refreshed).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sign in/i);
    expect(r.neededBrowserRefresh).toBe(false);
  });

  it('returns an auth error when no cookie is stored (signed out)', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: [''],
        responses: [{ status: 200, body: { issues: [] } }],
      }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sign in/i);
    expect(r.fetched).toBe(0);
  });

  it('returns ok=false with an error when not configured', async () => {
    const svc = new JiraBoardService(db, {
      config: { ...CONFIG, baseUrl: '' },
      epicLinkFieldId: null,
      deps: makeFetchDeps({ cookies: [''], responses: [{ status: 200 }] }),
    });
    const r = await svc.sync(pps.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });

  it('returns ok=false when the project has no board URL', async () => {
    const other = projects.create({ name: 'NoBoard', color: '#000' });
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({ cookies: ['session=abc'], responses: [{ status: 200 }] }),
    });
    const r = await svc.sync(other.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no jira board url/i);
  });

  it('returns ok=false when the project URL is malformed', async () => {
    const bad = projects.create({
      name: 'Bad',
      color: '#000',
      jiraBoardUrl: 'https://jira.test/browse/FIE-1',
    });
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({ cookies: ['session=abc'], responses: [{ status: 200 }] }),
    });
    const r = await svc.sync(bad.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid/i);
  });

  it('prefers a Jira components entry over a label for the chip', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      epicLinkFieldId: null,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
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
              isLast: true,
            },
          },
        ],
      }),
    });
    await svc.sync(pps.id);
    expect(tasks.findByNumber('FIE1933-2')!.jiraComponent).toBe('TEH-Vzory');
  });
});
