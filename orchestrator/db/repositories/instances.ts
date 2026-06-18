import type { SqliteLike } from '../migrations.js';
import type { InstanceRow, InstanceKind, InstanceStatus, TerminationReason } from '../../../shared/stateModel.js';
import { LIVE_STATUSES } from '../../../shared/stateModel.js';

type DbInstanceRow = {
  id: string;
  cwd: string;
  status: InstanceStatus;
  claude_session_id: string | null;
  spawned_at: number;
  last_activity_at: number;
  exit_code: number | null;
  termination_reason: TerminationReason | null;
  resumed_from_instance_id: string | null;
  jira_key_hint: string | null;
  args_json: string | null;
  kind: InstanceKind;
  task_id: number | null;
};

function toRow(r: DbInstanceRow): InstanceRow {
  return {
    id: r.id,
    cwd: r.cwd,
    status: r.status,
    claudeSessionId: r.claude_session_id,
    spawnedAt: r.spawned_at,
    lastActivityAt: r.last_activity_at,
    exitCode: r.exit_code,
    terminationReason: r.termination_reason,
    resumedFromInstanceId: r.resumed_from_instance_id,
    jiraKeyHint: r.jira_key_hint,
    argsJson: r.args_json,
    kind: r.kind,
    taskId: r.task_id,
  };
}

export class InstancesRepo {
  constructor(private db: SqliteLike) {}

  insert(row: InstanceRow): void {
    // Append at the end of the user's tab order. Steps of 1000 leave room to
    // splice between two rows later without renumbering everything.
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM instances')
      .get() as { m: number };
    const displayOrder = (maxRow.m ?? 0) + 1000;
    this.db
      .prepare(
        `INSERT INTO instances (id, cwd, status, claude_session_id, spawned_at, last_activity_at, exit_code, termination_reason, resumed_from_instance_id, jira_key_hint, args_json, kind, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.cwd,
        row.status,
        row.claudeSessionId,
        row.spawnedAt,
        row.lastActivityAt,
        row.exitCode,
        row.terminationReason,
        row.resumedFromInstanceId,
        row.jiraKeyHint,
        row.argsJson,
        row.kind,
        displayOrder,
      );
  }

  get(id: string): InstanceRow | null {
    const row = this.db.prepare(`SELECT * FROM instances WHERE id = ?`).get(id) as DbInstanceRow | undefined;
    return row ? toRow(row) : null;
  }

  listAll(): InstanceRow[] {
    // ASC so new spawns append to the right of the tab strip. display_order
    // is set on insert (and rewritten on user reorder) so this reflects the
    // user's tab layout; spawned_at is a fallback for any pre-v2 rows that
    // somehow ended up with NULL.
    return (
      this.db
        .prepare(
          `SELECT * FROM instances ORDER BY COALESCE(display_order, spawned_at) ASC, spawned_at ASC`,
        )
        .all() as DbInstanceRow[]
    ).map(toRow);
  }

  listLive(): InstanceRow[] {
    const placeholders = LIVE_STATUSES.map(() => '?').join(',');
    return (this.db
      .prepare(`SELECT * FROM instances WHERE status IN (${placeholders}) ORDER BY spawned_at`)
      .all(...LIVE_STATUSES) as DbInstanceRow[]).map(toRow);
  }

  /**
   * Returns every live instance whose `cwd` equals the given path (after the
   * caller normalises `~`). Used by the TimeTracker → Instances launch
   * bridge to decide between "open existing" and "spawn new".
   */
  liveByCwd(cwd: string): InstanceRow[] {
    const placeholders = LIVE_STATUSES.map(() => '?').join(',');
    return (
      this.db
        .prepare(
          `SELECT * FROM instances
            WHERE status IN (${placeholders})
              AND cwd = ?
            ORDER BY spawned_at`,
        )
        .all(...LIVE_STATUSES, cwd) as DbInstanceRow[]
    ).map(toRow);
  }

  updateStatus(id: string, status: InstanceStatus, now: number): void {
    this.db
      .prepare(`UPDATE instances SET status = ?, last_activity_at = ? WHERE id = ?`)
      .run(status, now, id);
  }

  setClaudeSessionId(id: string, sessionId: string): void {
    this.db.prepare(`UPDATE instances SET claude_session_id = ? WHERE id = ?`).run(sessionId, id);
  }

  setTermination(id: string, reason: TerminationReason | null, exitCode: number | null): void {
    this.db
      .prepare(`UPDATE instances SET termination_reason = ?, exit_code = ? WHERE id = ?`)
      .run(reason, exitCode, id);
  }

  setTask(id: string, taskId: number | null): void {
    this.db.prepare(`UPDATE instances SET task_id = ? WHERE id = ?`).run(taskId, id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM instances WHERE id = ?`).run(id);
  }

  reorder(orderedIds: string[]): void {
    // Normalize: rows in the supplied order get display_order = 1000, 2000, ...
    // Anything missing from the array keeps its current value, but in practice
    // the renderer always sends the full list of live ids.
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare(`UPDATE instances SET display_order = ? WHERE id = ?`);
      orderedIds.forEach((id, i) => {
        stmt.run((i + 1) * 1000, id);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
