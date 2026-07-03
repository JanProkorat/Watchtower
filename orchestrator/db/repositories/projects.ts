import type { SqliteLike } from '../migrations.js';
import { nowIso, newSyncId } from '../syncColumns.js';

export type ProjectKind = 'work' | 'time_off';

export interface ProjectRow {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  kind: ProjectKind;
  isDefault: boolean;
  folderPath: string | null;
  jiraGlobs: string[];
  jiraBoardUrl: string | null;
  /** URL template for opening a task in its issue tracker. `{n}` → task number. */
  taskUrlTemplate: string | null;
  description: string | null;
  /** Per-project opt-in: auto-log instance active time to this project. */
  autoTrack: boolean;
  createdAt: string;
  /** epic_count joined at list time — 0 until Phase 15 lands epics CRUD. */
  epicCount: number;
  /** sum(minutes) over the project's worklogs — 0 until Phase 16. */
  totalMinutes: number;
}

export interface ProjectInput {
  name: string;
  color?: string;
  kind?: ProjectKind;
  isDefault?: boolean;
  folderPath?: string | null;
  jiraGlobs?: string[];
  jiraBoardUrl?: string | null;
  taskUrlTemplate?: string | null;
  description?: string | null;
  autoTrack?: boolean;
}

export interface ProjectListFilter {
  archived?: boolean;
  kind?: ProjectKind;
  /** Case-insensitive substring match against project name. */
  search?: string;
}

type DbRow = {
  id: number;
  name: string;
  color: string;
  archived: number;
  kind: ProjectKind;
  is_default: number;
  folder_path: string | null;
  jira_globs: string | null;
  jira_board_url: string | null;
  task_url_template: string | null;
  description: string | null;
  auto_track: number;
  created_at: string;
  epic_count: number;
  total_minutes: number;
};

/**
 * Trim incoming Jira board URLs; treat empty / whitespace-only strings as
 * "unset" so the DB stores a clean NULL. Validation (rapidView present,
 * numeric) happens lazily in the sync service — pasting nonsense in the
 * drawer should still save and surface the error on next sync rather than
 * blocking the save.
 */
function normaliseBoardUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Trim incoming task URL templates and treat empty / whitespace-only strings
 * as "unset". The `{n}` placeholder is validated lazily at link build time
 * (helper in client/src/util/format.ts) — pasting a malformed template still
 * saves so the user can fix it in place.
 */
function normaliseTaskUrlTemplate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGlobs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function toRow(r: DbRow): ProjectRow {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    archived: r.archived === 1,
    kind: r.kind,
    isDefault: r.is_default === 1,
    folderPath: r.folder_path,
    jiraGlobs: parseGlobs(r.jira_globs),
    jiraBoardUrl: r.jira_board_url,
    taskUrlTemplate: r.task_url_template,
    description: r.description,
    autoTrack: r.auto_track === 1,
    createdAt: r.created_at,
    epicCount: r.epic_count,
    totalMinutes: r.total_minutes,
  };
}

/**
 * Default values for the columns the drawer doesn't expose directly. Kept here
 * so the repo can fully populate a row from a minimal {name} input.
 */
const DEFAULTS = {
  color: '#1976d2',
  kind: 'work' as ProjectKind,
} as const;

const LIST_SQL = `
  SELECT
    p.id, p.name, p.color, p.archived, p.kind, p.is_default,
    p.folder_path, p.jira_globs, p.jira_board_url, p.task_url_template, p.description, p.auto_track, p.created_at,
    (SELECT COUNT(*) FROM epics e WHERE e.project_id = p.id AND e.deleted_at IS NULL) AS epic_count,
    (SELECT COALESCE(SUM(w.minutes), 0)
       FROM worklogs w
       JOIN tasks t ON t.id = w.task_id
       JOIN epics e ON e.id = t.epic_id
      WHERE e.project_id = p.id AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL) AS total_minutes
  FROM projects p
`;

export class ProjectsRepo {
  constructor(private db: SqliteLike) {}

  list(filter: ProjectListFilter = {}): ProjectRow[] {
    const where: string[] = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filter.archived !== undefined) {
      where.push('p.archived = ?');
      params.push(filter.archived ? 1 : 0);
    }
    if (filter.kind) {
      where.push('p.kind = ?');
      params.push(filter.kind);
    }
    if (filter.search && filter.search.trim()) {
      where.push("LOWER(p.name) LIKE '%' || LOWER(?) || '%'");
      params.push(filter.search.trim());
    }

    const sql =
      LIST_SQL +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      // Default project first, then alphabetical — matches the prototype's row
      // ordering ("default" project pinned to the top).
      ` ORDER BY p.is_default DESC, LOWER(p.name) ASC, p.id ASC`;

    return (this.db.prepare(sql).all(...params) as DbRow[]).map(toRow);
  }

  get(id: number): ProjectRow | null {
    const row = this.db.prepare(LIST_SQL + ' WHERE p.id = ? AND p.deleted_at IS NULL').get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: ProjectInput): ProjectRow {
    const color = input.color ?? DEFAULTS.color;
    const kind = input.kind ?? DEFAULTS.kind;
    const isDefault = input.isDefault ? 1 : 0;
    // work-kind projects are billable; time_off projects are not. The boolean
    // column survives from TT and is used by repo/report queries that haven't
    // been refactored yet — keeping it in sync with `kind` avoids drift.
    const isBillable = kind === 'work' ? 1 : 0;
    const globs = input.jiraGlobs ? JSON.stringify(input.jiraGlobs) : null;
    const boardUrl = normaliseBoardUrl(input.jiraBoardUrl);
    const taskUrl = normaliseTaskUrlTemplate(input.taskUrlTemplate);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (isDefault) this.clearDefault();
      const info = this.db
        .prepare(
          `INSERT INTO projects (name, color, archived, is_billable, kind, is_default, folder_path, jira_globs, jira_board_url, task_url_template, description, auto_track, sync_id, updated_at)
           VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, color, isBillable, kind, isDefault,
          input.folderPath ?? null, globs, boardUrl, taskUrl, input.description ?? null,
          input.autoTrack ? 1 : 0,
          newSyncId(), nowIso(),
        ) as { lastInsertRowid: number | bigint };
      this.db.exec('COMMIT');
      const id = Number(info.lastInsertRowid);
      return this.get(id)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  update(id: number, input: Partial<ProjectInput>): ProjectRow {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };

    if (input.name !== undefined) push('name', input.name);
    if (input.color !== undefined) push('color', input.color);
    if (input.kind !== undefined) {
      push('kind', input.kind);
      push('is_billable', input.kind === 'work' ? 1 : 0);
    }
    if (input.folderPath !== undefined) push('folder_path', input.folderPath);
    if (input.jiraGlobs !== undefined) {
      push('jira_globs', input.jiraGlobs.length ? JSON.stringify(input.jiraGlobs) : null);
    }
    if (input.jiraBoardUrl !== undefined) {
      push('jira_board_url', normaliseBoardUrl(input.jiraBoardUrl));
    }
    if (input.taskUrlTemplate !== undefined) {
      push('task_url_template', normaliseTaskUrlTemplate(input.taskUrlTemplate));
    }
    if (input.description !== undefined) push('description', input.description);
    if (input.autoTrack !== undefined) push('auto_track', input.autoTrack ? 1 : 0);

    if (input.isDefault !== undefined) {
      // The is_default change has to happen inside the same transaction as the
      // clearDefault() above so the partial unique index never sees two rows
      // with is_default = 1 simultaneously.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (input.isDefault) this.clearDefault();
        push('is_default', input.isDefault ? 1 : 0);
        push('updated_at', nowIso());
        params.push(id);
        if (sets.length > 0) {
          this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    } else {
      push('updated_at', nowIso());
      params.push(id);
      this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }

    const row = this.get(id);
    if (!row) throw new Error(`project ${id} not found after update`);
    return row;
  }

  archive(id: number, archived: boolean): void {
    const ts = nowIso();
    if (archived) {
      this.db.prepare(`UPDATE projects SET archived = 1, is_default = 0, updated_at = ? WHERE id = ?`).run(ts, id);
    } else {
      this.db.prepare(`UPDATE projects SET archived = 0, updated_at = ? WHERE id = ?`).run(ts, id);
    }
  }

  delete(id: number): void {
    // Soft-delete + explicit cascade (FK ON DELETE CASCADE no longer fires —
    // these are tombstones the sync propagates). Order: leaves first.
    const ts = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        `UPDATE worklogs SET deleted_at = ?, updated_at = ?
           WHERE deleted_at IS NULL AND task_id IN (
             SELECT t.id FROM tasks t JOIN epics e ON e.id = t.epic_id WHERE e.project_id = ?)`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE tasks SET deleted_at = ?, updated_at = ?
           WHERE deleted_at IS NULL AND epic_id IN (SELECT id FROM epics WHERE project_id = ?)`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE epics SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND project_id = ?`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE contracts SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND project_id = ?`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      ).run(ts, ts, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Internal helper — must be called inside an explicit transaction. */
  private clearDefault(): void {
    this.db.prepare(`UPDATE projects SET is_default = 0, updated_at = ? WHERE is_default = 1`).run(nowIso());
  }
}
