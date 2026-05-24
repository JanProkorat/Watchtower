import type { SqliteLike } from '../migrations.js';

export type TaskStatus = 'open' | 'in_progress' | 'done';

export interface TaskRow {
  id: number;
  epicId: number;
  /** TimeTracker's `number` column — task identifier like "WT-T37" or a Jira key. */
  number: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  estimatedMinutes: number | null;
  createdAt: string;
  /** Joined: total minutes logged against this task. */
  totalMinutes: number;
}

export interface TaskInput {
  epicId: number;
  number: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  estimatedMinutes?: number | null;
}

type DbRow = {
  id: number;
  epic_id: number;
  number: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  estimated_minutes: number | null;
  created_at: string;
  total_minutes: number;
};

function toRow(r: DbRow): TaskRow {
  return {
    id: r.id,
    epicId: r.epic_id,
    number: r.number,
    title: r.title,
    description: r.description,
    status: r.status,
    estimatedMinutes: r.estimated_minutes,
    createdAt: r.created_at,
    totalMinutes: r.total_minutes,
  };
}

const LIST_SQL = `
  SELECT
    t.id, t.epic_id, t.number, t.title, t.description, t.status,
    t.estimated_minutes, t.created_at,
    (SELECT COALESCE(SUM(w.minutes), 0) FROM worklogs w WHERE w.task_id = t.id) AS total_minutes
  FROM tasks t
`;

export class TasksRepo {
  constructor(private db: SqliteLike) {}

  listForEpic(epicId: number): TaskRow[] {
    return (
      this.db
        .prepare(
          LIST_SQL +
            ` WHERE t.epic_id = ?
             ORDER BY t.id ASC`,
        )
        .all(epicId) as DbRow[]
    ).map(toRow);
  }

  listForProject(projectId: number): TaskRow[] {
    return (
      this.db
        .prepare(
          LIST_SQL +
            ` JOIN epics e ON e.id = t.epic_id
             WHERE e.project_id = ?
             ORDER BY e.display_order ASC, t.id ASC`,
        )
        .all(projectId) as DbRow[]
    ).map(toRow);
  }

  get(id: number): TaskRow | null {
    const row = this.db.prepare(LIST_SQL + ' WHERE t.id = ?').get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: TaskInput): TaskRow {
    const info = this.db
      .prepare(
        `INSERT INTO tasks (epic_id, number, title, description, status, estimated_minutes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.epicId,
        input.number,
        input.title,
        input.description ?? null,
        input.status ?? 'open',
        input.estimatedMinutes ?? null,
      ) as { lastInsertRowid: number | bigint };
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<TaskInput>): TaskRow {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };
    if (input.epicId !== undefined) push('epic_id', input.epicId);
    if (input.number !== undefined) push('number', input.number);
    if (input.title !== undefined) push('title', input.title);
    if (input.description !== undefined) push('description', input.description);
    if (input.status !== undefined) push('status', input.status);
    if (input.estimatedMinutes !== undefined) push('estimated_minutes', input.estimatedMinutes);

    if (sets.length > 0) {
      params.push(id);
      this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    const row = this.get(id);
    if (!row) throw new Error(`task ${id} not found after update`);
    return row;
  }

  delete(id: number): void {
    // worklogs cascade via ON DELETE CASCADE on the schema FK
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  }
}
