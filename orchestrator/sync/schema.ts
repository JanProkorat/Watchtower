import { v5 as uuidv5 } from 'uuid';
import { createWorklogDeriver } from './derive.js';

export type ColKind = 'text' | 'int' | 'bool' | 'numeric' | 'date' | 'ts' | 'json';

export interface SyncColumn {
  name: string;
  kind: ColKind;
  /** When true, the column is Postgres-only: omitted from the SQLite SELECT,
   *  and its value is supplied by the table's DERIVER before upsert. */
  derived?: boolean;
}

export interface SyncTable {
  /** Table name (identical in SQLite and Postgres). */
  name: string;
  pgTable: string;
  /** The local key column used to iterate rows; never sent as a sync key. */
  keyCol: 'id' | 'date';
  columns: SyncColumn[];
}

/** Fixed namespace so ETL UUIDv5s are stable across machines and re-runs. */
const NS = '6f1a0b9e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';

export function deterministicSyncId(table: string, pk: string | number): string {
  return uuidv5(`${table}:${pk}`, NS);
}

export function toPgValue(kind: ColKind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'bool':
      return v === 1 || v === true;
    case 'json':
      return typeof v === 'string' ? JSON.parse(v) : v;
    case 'numeric':
      return typeof v === 'string' ? Number(v) : v;
    default:
      // text/int/date/ts pass through; pg accepts ISO strings for date/ts.
      return v;
  }
}

export function toSqliteValue(kind: ColKind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'bool':
      return v === true || v === 1 ? 1 : 0;
    case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v);
    case 'numeric':
      return typeof v === 'string' ? Number(v) : v;
    case 'date': {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      // pg may return 'YYYY-MM-DD' string already.
      return String(v).slice(0, 10);
    }
    case 'ts': {
      if (v instanceof Date) return v.toISOString();
      return new Date(String(v)).toISOString();
    }
    default:
      return v;
  }
}

export const SYNCED_TABLES: SyncTable[] = [
  {
    name: 'projects', pgTable: 'projects', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'name', kind: 'text' },
      { name: 'base_url', kind: 'text' },
      { name: 'color', kind: 'text' },
      { name: 'archived', kind: 'bool' },
      { name: 'is_billable', kind: 'bool' },
      { name: 'kind', kind: 'text' },
      { name: 'rate_type', kind: 'text' },
      { name: 'rate_amount', kind: 'numeric' },
      { name: 'hours_per_day', kind: 'numeric' },
      { name: 'is_pinned', kind: 'bool' },
      { name: 'folder_path', kind: 'text' },
      { name: 'jira_globs', kind: 'json' },
      { name: 'description', kind: 'text' },
      { name: 'jira_board_url', kind: 'text' },
      { name: 'task_url_template', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'epics', pgTable: 'epics', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'project_sync_id', kind: 'text' }, // resolved FK — see note below
      { name: 'name', kind: 'text' },
      { name: 'description', kind: 'text' },
      { name: 'status', kind: 'text' },
      { name: 'display_order', kind: 'int' },
      { name: 'jira_epic_key', kind: 'text' },
      { name: 'shortcut', kind: 'text' },
      { name: 'github_issue_url', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'tasks', pgTable: 'tasks', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'epic_sync_id', kind: 'text' },
      { name: 'number', kind: 'text' },
      { name: 'title', kind: 'text' },
      { name: 'status', kind: 'text' },
      { name: 'estimated_minutes', kind: 'int' },
      { name: 'description', kind: 'text' },
      { name: 'jira_status', kind: 'text' },
      { name: 'jira_estimate_secs', kind: 'int' },
      { name: 'jira_component', kind: 'text' },
      { name: 'jira_synced_at', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'worklogs', pgTable: 'worklogs', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'task_sync_id', kind: 'text' },
      { name: 'description', kind: 'text' },
      { name: 'work_date', kind: 'date' },
      { name: 'minutes', kind: 'int' },
      { name: 'reported_minutes', kind: 'int' },
      { name: 'source', kind: 'text' },
      { name: 'external_id', kind: 'text' },
      { name: 'jira_uploaded', kind: 'bool' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
      // Postgres-only derived billing columns — never read from SQLite.
      { name: 'effective_minutes', kind: 'int', derived: true },
      { name: 'resolved_rate', kind: 'numeric', derived: true },
      { name: 'earned_amount', kind: 'numeric', derived: true },
    ],
  },
  {
    name: 'contracts', pgTable: 'contracts', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'project_sync_id', kind: 'text' },
      { name: 'effective_from', kind: 'date' },
      { name: 'rate_type', kind: 'text' },
      { name: 'rate_amount', kind: 'numeric' },
      { name: 'hours_per_day', kind: 'numeric' },
      { name: 'end_date', kind: 'date' },
      { name: 'md_limit', kind: 'numeric' },
      { name: 'contract_group_id', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'days_off', pgTable: 'days_off', keyCol: 'date',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'date', kind: 'date' },
      { name: 'kind', kind: 'text' },
      { name: 'note', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
];

/**
 * Map of table name → deriver factory. A deriver factory takes the SQLite db
 * handle and returns a per-row function that computes the derived (Postgres-only)
 * column values for a given raw SQLite row.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DERIVERS: Record<string, (db: any) => (row: Record<string, unknown>) => Record<string, unknown>> = {
  worklogs: createWorklogDeriver,
};
