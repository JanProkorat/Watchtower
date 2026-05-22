import type { SqliteLike } from '../migrations.js';
import type { InstanceRow, InstanceStatus, TerminationReason } from '../../../shared/stateModel.js';
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
  };
}

export class InstancesRepo {
  constructor(private db: SqliteLike) {}

  insert(row: InstanceRow): void {
    this.db
      .prepare(
        `INSERT INTO instances (id, cwd, status, claude_session_id, spawned_at, last_activity_at, exit_code, termination_reason, resumed_from_instance_id, jira_key_hint, args_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
  }

  get(id: string): InstanceRow | null {
    const row = this.db.prepare(`SELECT * FROM instances WHERE id = ?`).get(id) as DbInstanceRow | undefined;
    return row ? toRow(row) : null;
  }

  listAll(): InstanceRow[] {
    // ASC so new spawns append to the right of the tab strip, matching
    // browser-tab idioms.
    return (this.db.prepare(`SELECT * FROM instances ORDER BY spawned_at ASC`).all() as DbInstanceRow[]).map(toRow);
  }

  listLive(): InstanceRow[] {
    const placeholders = LIVE_STATUSES.map(() => '?').join(',');
    return (this.db
      .prepare(`SELECT * FROM instances WHERE status IN (${placeholders}) ORDER BY spawned_at`)
      .all(...LIVE_STATUSES) as DbInstanceRow[]).map(toRow);
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

  delete(id: string): void {
    this.db.prepare(`DELETE FROM instances WHERE id = ?`).run(id);
  }
}
