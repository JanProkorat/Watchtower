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
  JiraSyncService,
  type JiraConfig,
  type JiraSyncDeps,
} from '../../orchestrator/services/jiraSync.js';

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

interface FakeFetchCall {
  url: string;
  body: { timeSpent: string; started: string; comment: string };
}

interface FakeFetchOptions {
  // Per-call sequenced responses. Each call consumes one entry; if the list is
  // exhausted, the last entry is reused (useful for "always succeed" cases).
  responses: Array<{ status: number; body?: unknown }>;
  calls?: FakeFetchCall[];
}

function makeDeps(opts: {
  cookies: string[];
  fetch: FakeFetchOptions;
  refresh?: () => Promise<void>;
}): JiraSyncDeps {
  // Use a 09:00+0100 anchor so the `started` string is deterministic across
  // environments (CI may run in UTC). This stubs only what the service reads
  // off `now()` — actual Date math isn't needed.
  const pinned = new Date('2026-05-24T09:00:00+01:00');
  Object.defineProperty(pinned, 'getTimezoneOffset', { value: () => -60 });

  let cookieIdx = 0;
  let fetchIdx = 0;
  return {
    readCookie: () => opts.cookies[Math.min(cookieIdx++, opts.cookies.length - 1)],
    runRefresh: opts.refresh ?? (async () => {}),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const r = opts.fetch.responses[Math.min(fetchIdx, opts.fetch.responses.length - 1)];
      fetchIdx += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      opts.fetch.calls?.push({ url: String(input), body });
      return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, {
        status: r.status,
      });
    }) as typeof fetch,
    now: () => pinned,
  };
}

describe('JiraSyncService', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let worklogs: WorklogsRepo;

  let projectId: number;
  let epicId: number;
  let validTaskId: number;
  let nonJiraTaskId: number;
  let doneTaskId: number;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);

    projectId = projects.create({ name: 'PPS', color: '#7aa7ff' }).id;
    epicId = epics.create({ projectId, name: 'FIE' }).id;
    validTaskId = tasks.create({ epicId, number: 'FIE1933-18887', title: 'Refactor' }).id;
    nonJiraTaskId = tasks.create({ epicId, number: 'local-1', title: 'No Jira key' }).id;
    doneTaskId = tasks.create({
      epicId,
      number: 'FIE1933-19000',
      title: 'Old task',
      status: 'done',
    }).id;

    worklogs.create({ taskId: validTaskId, workDate: '2026-05-22', minutes: 90, description: 'Code review' });
    worklogs.create({ taskId: validTaskId, workDate: '2026-05-23', minutes: 60 });
    worklogs.create({ taskId: nonJiraTaskId, workDate: '2026-05-22', minutes: 30 });
    worklogs.create({ taskId: doneTaskId, workDate: '2026-05-22', minutes: 45 });
  });

  describe('preview', () => {
    it('reports candidate counts and breakdown', () => {
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({ cookies: ['c=1'], fetch: { responses: [{ status: 200, body: { id: '1' } }] } }),
      });
      const r = svc.preview({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.dryRun).toBe(true);
      expect(r.totalCandidates).toBe(4);
      expect(r.skippedNoJiraKey).toBe(1);
      // Task status (open/in_progress/done) no longer gates worklog eligibility;
      // the per-worklog jira_uploaded flag is the only filter.
      expect(r.skippedTaskNotOpen).toBe(0);
      expect(r.skippedAlreadyPosted).toBe(0);
      expect(r.attempted).toBe(3);
      expect(r.entries.map((e) => e.taskNumber)).toEqual([
        'FIE1933-18887',
        'FIE1933-19000',
        'FIE1933-18887',
      ]);
      expect(r.entries[0].timeSpent).toBe('1h 30m');
      expect(r.entries[0].comment).toBe('Code review');
      expect(r.entries[2].comment).toBe('Práce na úkolu');
    });

    it('returns an error when not configured', () => {
      const svc = new JiraSyncService(db, {
        config: { ...CONFIG, baseUrl: '' },
        deps: makeDeps({ cookies: [''], fetch: { responses: [{ status: 200 }] } }),
      });
      const r = svc.preview({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.error).toMatch(/not configured/i);
      expect(r.totalCandidates).toBe(0);
    });
  });

  describe('sync', () => {
    it('posts unposted worklogs, marks them, and posts to /rest/api/2/issue/.../worklog', async () => {
      const calls: FakeFetchCall[] = [];
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              { status: 201, body: { id: 'w-100' } },
              { status: 201, body: { id: 'w-200' } },
              { status: 201, body: { id: 'w-101' } },
            ],
            calls,
          },
        }),
      });

      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });

      expect(r.dryRun).toBe(false);
      expect(r.posted).toBe(3);
      expect(r.failed).toBe(0);
      expect(r.neededBrowserRefresh).toBe(false);
      expect(calls).toHaveLength(3);
      expect(calls[0].url).toBe('https://jira.test/rest/api/2/issue/FIE1933-18887/worklog');
      expect(calls[0].body.timeSpent).toBe('1h 30m');
      expect(calls[0].body.comment).toBe('Code review');
      expect(calls[0].body.started).toBe('2026-05-22T09:00:00.000+0100');

      // Posted worklogs are marked.
      const rows = worklogs.list({ taskId: validTaskId });
      const posted = rows.filter((w) => w.jiraUploaded);
      expect(posted).toHaveLength(2);
      expect(posted.map((w) => w.externalId).sort()).toEqual(['w-100', 'w-101']);
      expect(posted.every((w) => w.source === 'jira')).toBe(true);

      // The 'done'-task worklog also reaches Jira now that task status no
      // longer gates eligibility.
      const doneRows = worklogs.list({ taskId: doneTaskId });
      expect(doneRows.filter((w) => w.jiraUploaded)).toHaveLength(1);
    });

    it('marks the worklog uploaded even when Jira 2xx response has no parseable id', async () => {
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              // Jira responds 201 with no body / no id field — prevent the
              // double-post that the previous code triggered on retry.
              { status: 201, body: {} },
              { status: 201, body: { id: 'w-101' } },
              { status: 201, body: { id: 'w-200' } },
            ],
          },
        }),
      });

      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.posted).toBe(3);
      expect(r.failed).toBe(0);

      // All worklogs are marked uploaded; the one with no parseable id has an
      // empty external_id but jira_uploaded=1 so a second run won't re-post it.
      const all = worklogs.list({ taskId: validTaskId });
      expect(all.every((w) => w.jiraUploaded)).toBe(true);
    });

    it('accepts numeric worklog ids returned by Jira on-prem', async () => {
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              { status: 201, body: { id: 12345 } },
              { status: 201, body: { id: 12346 } },
              { status: 201, body: { id: 12347 } },
            ],
          },
        }),
      });

      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.posted).toBe(3);
      const posted = worklogs.list({ taskId: validTaskId }).filter((w) => w.jiraUploaded);
      expect(posted.map((w) => w.externalId).sort()).toEqual(['12345', '12347']);
    });

    it('skips already-posted entries on a second run', async () => {
      // Add a third unposted worklog so the task does NOT auto-close after the
      // first sync — that way the re-run path goes through the "already
      // posted" skip.
      worklogs.create({ taskId: validTaskId, workDate: '2026-05-24', minutes: 30 });

      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              { status: 500, body: 'boom' }, // validTaskId@5-22 fails
              { status: 201, body: { id: 'w-done' } }, // doneTaskId@5-22 succeeds
              { status: 201, body: { id: 'w-101' } }, // validTaskId@5-23 succeeds
              { status: 201, body: { id: 'w-102' } }, // validTaskId@5-24 succeeds
              // Retry of the still-pending validTaskId@5-22 worklog in run #2.
              { status: 201, body: { id: 'w-100' } },
            ],
          },
        }),
      });

      const first = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(first.posted).toBe(3);
      expect(first.failed).toBe(1);
      expect(first.tasksMarkedDone).toBe(0); // validTaskId still has unposted id=1

      const second = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      // 5 total - 1 no-jira-key = 4 valid candidates;
      // 3 were posted in run #1 (skippedAlreadyPosted), 1 retried + posted.
      expect(second.skippedAlreadyPosted).toBe(3);
      expect(second.posted).toBe(1);
      expect(second.failed).toBe(0);
      expect(second.entries.filter((e) => e.status === 'pending')).toHaveLength(0);
      // Sync never marks tasks done — task lifecycle is user-driven.
      expect(second.tasksMarkedDone).toBe(0);
    });

    it('leaves the task status alone after posting all its worklogs', async () => {
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              { status: 201, body: { id: 'w-100' } },
              { status: 201, body: { id: 'w-done' } },
              { status: 201, body: { id: 'w-101' } },
            ],
          },
        }),
      });

      const taskBefore = tasks.get(validTaskId);
      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.tasksMarkedDone).toBe(0);

      const task = tasks.get(validTaskId);
      expect(task?.status).toBe(taskBefore?.status);
    });

    it('refreshes the cookie via Playwright when the first POST returns 401', async () => {
      let refreshed = 0;
      const calls: FakeFetchCall[] = [];
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['stale', 'fresh'],
          refresh: async () => {
            refreshed += 1;
          },
          fetch: {
            responses: [
              { status: 401 }, // first attempt fails auth
              { status: 201, body: { id: 'w-100' } }, // retry succeeds
              { status: 201, body: { id: 'w-done' } }, // doneTask worklog
              { status: 201, body: { id: 'w-101' } }, // last validTask worklog
            ],
            calls,
          },
        }),
      });

      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(refreshed).toBe(1);
      expect(r.neededBrowserRefresh).toBe(true);
      expect(r.posted).toBe(3);
      expect(r.failed).toBe(0);
      expect(calls).toHaveLength(4);
    });

    it('treats a 302 redirect (stale SSO cookie) as an auth failure and refreshes', async () => {
      let refreshed = 0;
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['stale', 'fresh'],
          refresh: async () => {
            refreshed += 1;
          },
          fetch: {
            responses: [
              { status: 302 }, // Jira bounces to SSO login
              { status: 201, body: { id: 'w-100' } },
              { status: 201, body: { id: 'w-done' } },
              { status: 201, body: { id: 'w-101' } },
            ],
          },
        }),
      });

      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(refreshed).toBe(1);
      expect(r.neededBrowserRefresh).toBe(true);
      expect(r.posted).toBe(3);
      expect(r.failed).toBe(0);
    });

    it('reports a per-entry failure on HTTP 500 and leaves the worklog unmarked', async () => {
      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              { status: 500, body: 'boom' },
              { status: 201, body: { id: 'w-done' } },
              { status: 201, body: { id: 'w-101' } },
            ],
          },
        }),
      });

      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.posted).toBe(2);
      expect(r.failed).toBe(1);
      const failed = r.entries.find((e) => e.status === 'failed');
      expect(failed?.reason).toMatch(/HTTP 500/);

      // The failing worklog is not marked uploaded, so a retry would still
      // pick it up.
      const unposted = worklogs
        .list({ taskId: validTaskId })
        .filter((w) => !w.jiraUploaded);
      expect(unposted).toHaveLength(1);
    });

    it('returns an error when not configured', async () => {
      const svc = new JiraSyncService(db, {
        config: { ...CONFIG, keychainAccount: '' },
        deps: makeDeps({ cookies: [''], fetch: { responses: [{ status: 200 }] } }),
      });
      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.error).toMatch(/not configured/i);
      expect(r.posted).toBe(0);
    });

    it('bumps updated_at when marking a worklog posted (LWW key advances)', async () => {
      // Capture the pre-sync updated_at for the FIE1933-18887@5-22 worklog.
      const target = worklogs
        .list({ taskId: validTaskId })
        .find((w) => w.workDate === '2026-05-22');
      expect(target).toBeDefined();
      const before = (
        db.prepare('SELECT updated_at FROM worklogs WHERE id = ?').get(target!.id) as {
          updated_at: string;
        }
      ).updated_at;

      // markPosted uses real wall-clock nowIso(); wait so the ISO string differs.
      await new Promise((r) => setTimeout(r, 5));

      const svc = new JiraSyncService(db, {
        config: CONFIG,
        deps: makeDeps({
          cookies: ['session=abc'],
          fetch: {
            responses: [
              { status: 201, body: { id: 'w-100' } },
              { status: 201, body: { id: 'w-done' } },
              { status: 201, body: { id: 'w-101' } },
            ],
          },
        }),
      });
      const r = await svc.sync({ from: '2026-05-01', to: '2026-05-31' });
      expect(r.posted).toBe(3);

      const after = (
        db.prepare('SELECT updated_at FROM worklogs WHERE id = ?').get(target!.id) as {
          updated_at: string;
        }
      ).updated_at;
      expect(after > before).toBe(true);
    });
  });
});
