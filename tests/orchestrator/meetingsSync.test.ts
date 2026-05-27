import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import { MeetingsSyncService } from '../../orchestrator/services/meetingsSync.js';
import {
  MsGraphAuthService,
  NotAuthenticatedError,
} from '../../orchestrator/services/msGraphAuth.js';

function freshDb(): SqliteLike {
  const db = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(db);
  db.prepare(`INSERT INTO projects (name) VALUES ('Default')`).run();
  db.prepare(`INSERT INTO epics (project_id, name) VALUES (1, 'Sprint')`).run();
  db.prepare(
    `INSERT INTO tasks (epic_id, number, title) VALUES (1, 'GREEN-345', 'Sprint task')`,
  ).run();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('meetings.default_task_id', '1')`,
  ).run();
  return db;
}

describe('MeetingsSyncService', () => {
  beforeEach(() => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
  });

  it('returns needsAuth=true when not signed in', async () => {
    const auth = {
      getValidAccessToken: vi.fn(async () => {
        throw new NotAuthenticatedError();
      }),
    } as unknown as MsGraphAuthService;
    const svc = new MeetingsSyncService(freshDb(), {
      auth,
      fetchEvents: vi.fn(),
    });
    const r = await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    expect(r.needsAuth).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('inserts a worklog for a Graph event and returns a summary', async () => {
    const db = freshDb();
    const auth = { getValidAccessToken: vi.fn(async () => 'AT') } as unknown as MsGraphAuthService;
    const fetchEvents = vi.fn(async () => [
      {
        id: 'evt-1',
        subject: 'Backlog grooming',
        isAllDay: false,
        responseStatus: { response: 'accepted' },
        start: { dateTime: '2026-05-14T09:00:00.0000000', timeZone: 'Europe/Prague' },
        end: { dateTime: '2026-05-14T10:00:00.0000000', timeZone: 'Europe/Prague' },
      },
    ]);
    const svc = new MeetingsSyncService(db, { auth, fetchEvents });
    const r = await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    expect(r.ok).toBe(true);
    expect(r.logged).toBe(1);
    const row = db
      .prepare('SELECT task_id, source, minutes FROM worklogs WHERE external_id = ?')
      .get('evt-1') as { task_id: number; source: string; minutes: number };
    expect(row.source).toBe('outlook');
    expect(row.task_id).toBe(1);
    expect(row.minutes).toBe(60);
  });

  it('treats duplicate event id as `duplicate`, not an error', async () => {
    const db = freshDb();
    const event = {
      id: 'evt-dup',
      subject: 'Backlog grooming',
      isAllDay: false,
      responseStatus: { response: 'accepted' },
      start: { dateTime: '2026-05-14T09:00:00.0000000', timeZone: 'Europe/Prague' },
      end: { dateTime: '2026-05-14T10:00:00.0000000', timeZone: 'Europe/Prague' },
    };
    const auth = { getValidAccessToken: vi.fn(async () => 'AT') } as unknown as MsGraphAuthService;
    const fetchEvents = vi.fn(async () => [event]);
    const svc = new MeetingsSyncService(db, { auth, fetchEvents });
    await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    const r2 = await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    expect(r2.logged).toBe(0);
    expect(r2.duplicate).toBe(1);
  });
});
