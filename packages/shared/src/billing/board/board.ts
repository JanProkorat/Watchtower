import type { TaskRow, WorklogRow } from '../types.js';

export type BoardColumn = 'todo' | 'doing' | 'to_accept' | 'done';

/**
 * Raw Jira status → merged board column. Ported verbatim from the orchestrator
 * board sync (`orchestrator/services/jiraBoard.ts`) so the iPad/iPhone board
 * groups cards exactly like the desktop board.
 */
export const STATUS_TO_COLUMN: Record<string, BoardColumn> = {
  New: 'todo',
  'To Do': 'todo',
  'In Progress': 'doing',
  'In Review': 'doing',
  'In Test': 'to_accept',
  'To Accept': 'to_accept',
  Done: 'done',
};

/** Statuses hidden from the board even if Jira still surfaces them. */
export const HIDDEN_STATUSES: ReadonlySet<string> = new Set(['Waiting', 'Done']);

/** Unknown-but-not-hidden statuses fall here (matches desktop jiraBoard). */
const DEFAULT_COLUMN: BoardColumn = 'doing';

/** Columns shown, in order. `done` is excluded — finished work leaves the board. */
export const VISIBLE_COLUMNS: readonly { key: BoardColumn; title: string }[] = [
  { key: 'todo', title: 'To Do' },
  { key: 'doing', title: 'Rozpracované' },
  { key: 'to_accept', title: 'K akceptaci' },
];

export function columnForStatus(jiraStatus: string): BoardColumn {
  return STATUS_TO_COLUMN[jiraStatus] ?? DEFAULT_COLUMN;
}

export interface BoardCard {
  taskNumber: string | null;
  taskTitle: string;
  jiraStatus: string;
  column: BoardColumn;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  /** Manual estimate, or the pulled Jira estimate as fallback (from mapTaskRow). */
  estimateMinutes: number | null;
  /** Sum of `worklogs.minutes` for this task's number. */
  loggedMinutes: number;
}

export interface BoardColumnData {
  key: BoardColumn;
  title: string;
  cards: BoardCard[];
}

export interface BoardResult {
  columns: BoardColumnData[];
}

/**
 * Build the read-only board from the tasks + worklogs the client already holds
 * (Supabase billing dataset). A task appears only if it carries a `jiraStatus`
 * (i.e. it was pulled from a board); hidden statuses (`Waiting`, `Done`) and the
 * `done` column are dropped. Logged time per card is summed from worklogs by
 * `taskNumber`. Pure — no I/O, safe to run on iPad and iPhone.
 */
export function buildBoard(
  tasks: TaskRow[],
  worklogs: WorklogRow[],
  opts?: { projectId?: number },
): BoardResult {
  const projectId = opts?.projectId;

  const loggedByTask = new Map<string, number>();
  for (const w of worklogs) {
    if (w.taskNumber == null) continue;
    loggedByTask.set(w.taskNumber, (loggedByTask.get(w.taskNumber) ?? 0) + w.minutes);
  }

  const cards: BoardCard[] = [];
  for (const t of tasks) {
    if (t.jiraStatus == null) continue; // not on a board
    if (HIDDEN_STATUSES.has(t.jiraStatus)) continue; // Waiting / Done
    if (projectId !== undefined && t.projectId !== projectId) continue;
    const column = columnForStatus(t.jiraStatus);
    if (column === 'done') continue; // finished work is not shown
    cards.push({
      taskNumber: t.taskNumber,
      taskTitle: t.taskTitle,
      jiraStatus: t.jiraStatus,
      column,
      projectId: t.projectId,
      projectName: t.projectName,
      projectColor: t.projectColor,
      estimateMinutes: t.estimatedMinutes,
      loggedMinutes: t.taskNumber != null ? loggedByTask.get(t.taskNumber) ?? 0 : 0,
    });
  }

  // Natural-numeric sort within each column so FIE-19000 precedes FIE-19100.
  cards.sort((a, b) =>
    (a.taskNumber ?? '').localeCompare(b.taskNumber ?? '', undefined, { numeric: true }),
  );

  return {
    columns: VISIBLE_COLUMNS.map((c) => ({
      key: c.key,
      title: c.title,
      cards: cards.filter((card) => card.column === c.key),
    })),
  };
}
