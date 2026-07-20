export type InstanceStatus =
  | 'spawning'
  | 'working'
  | 'waiting-permission'
  | 'waiting-input'
  | 'idle-notify'
  | 'finished'
  | 'crashed'
  | 'suspended'
  | 'resuming';

export const LIVE_STATUSES: ReadonlyArray<InstanceStatus> = [
  'spawning',
  'working',
  'waiting-permission',
  'waiting-input',
  'idle-notify',
];

export type TerminationReason =
  | 'session-end'
  | 'user-kill'
  | 'app-quit-suspend'
  | 'crash'
  | 'resume-failed'
  | 'no-session-id';

export type InstanceKind = 'claude' | 'shell';

export interface InstanceRow {
  id: string;
  cwd: string;
  status: InstanceStatus;
  claudeSessionId: string | null;
  spawnedAt: number;
  lastActivityAt: number;
  exitCode: number | null;
  terminationReason: TerminationReason | null;
  resumedFromInstanceId: string | null;
  jiraKeyHint: string | null;
  argsJson: string | null;
  kind: InstanceKind;
  taskId: number | null;
  /** For a Reviews "implement comments" session: the dedicated git worktree the
   *  session runs in, so closing the instance can clean it up. Null otherwise. */
  worktreePath: string | null;
}
