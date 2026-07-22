import type { HubConfig } from './hubConfig.js';

export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } }
  | { kind: 'spawnInstance'; payload: { cwd: string; args?: string[]; instanceKind?: import('./stateModel.js').InstanceKind } }
  | { kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { kind: 'terminalAttach'; payload: { instanceId: string } }
  | { kind: 'killInstance'; payload: { instanceId: string } }
  | { kind: 'removeInstance'; payload: { instanceId: string } }
  | { kind: 'restartInstance'; payload: { instanceId: string } }
  | { kind: 'reorderInstances'; payload: { orderedIds: string[] } }
  | { kind: 'listInstances'; payload: Record<string, never> }
  | { kind: 'chooseDirectory'; payload: { defaultPath?: string } }
  | { kind: 'getSetting'; payload: { key: string } }
  | { kind: 'setSetting'; payload: { key: string; value: string } }
  | { kind: 'hub:getConfig'; payload: Record<string, never> }
  | { kind: 'hub:setConfig'; payload: { config: HubConfig } }
  | { kind: 'cloudSync:getConfig'; payload: Record<string, never> }
  | { kind: 'cloudSync:setConfig'; payload: { enabled: boolean } }
  | { kind: 'previewHookInstall'; payload: Record<string, never> }
  | { kind: 'installHooks'; payload: Record<string, never> }
  | { kind: 'uninstallHooks'; payload: Record<string, never> }
  | { kind: 'snooze'; payload: { instanceId: string | '*'; untilMs: number } }
  | { kind: 'focusChanged'; payload: { instanceId: string | null } }
  | { kind: 'sendTestNotification'; payload: Record<string, never> }
  | { kind: 'projects:list'; payload: ProjectListFilterPayload }
  | { kind: 'projects:get'; payload: { id: number } }
  | { kind: 'projects:create'; payload: ProjectInputPayload }
  | { kind: 'projects:update'; payload: { id: number; input: Partial<ProjectInputPayload> } }
  | { kind: 'projects:archive'; payload: { id: number; archived: boolean } }
  | { kind: 'projects:delete'; payload: { id: number } }
  | { kind: 'notes:list'; payload: NoteListFilterPayload }
  | { kind: 'notes:create'; payload: NoteInputPayload }
  | { kind: 'notes:update'; payload: { id: number; input: Partial<NoteInputPayload> } }
  | { kind: 'notes:delete'; payload: { id: number } }
  | { kind: 'epics:list'; payload: { projectId: number } }
  | { kind: 'epics:listAll'; payload: Record<string, never> }
  | { kind: 'epics:create'; payload: EpicInputPayload }
  | { kind: 'epics:update'; payload: { id: number; input: Partial<EpicInputPayload> } }
  | { kind: 'epics:reorder'; payload: { projectId: number; orderedIds: number[] } }
  | { kind: 'epics:delete'; payload: { id: number } }
  | { kind: 'tasks:listForEpic'; payload: { epicId: number } }
  | { kind: 'tasks:listForProject'; payload: { projectId: number } }
  | { kind: 'tasks:findByNumber'; payload: { number: string } }
  | { kind: 'tasks:findById'; payload: { id: number } }
  | { kind: 'tasks:create'; payload: TaskInputPayload }
  | { kind: 'tasks:update'; payload: { id: number; input: Partial<TaskInputPayload> } }
  | { kind: 'tasks:delete'; payload: { id: number } }
  | { kind: 'worklogs:list'; payload: WorklogListFilterPayload }
  | { kind: 'worklogs:create'; payload: WorklogInputPayload }
  | { kind: 'worklogs:update'; payload: { id: number; input: Partial<WorklogInputPayload> } }
  | { kind: 'worklogs:delete'; payload: { id: number } }
  | { kind: 'contracts:listForProject'; payload: { projectId: number } }
  | { kind: 'contracts:create'; payload: ContractInputPayload }
  | { kind: 'contracts:update'; payload: { id: number; input: Partial<ContractInputPayload> } }
  | { kind: 'contracts:delete'; payload: { id: number } }
  | { kind: 'taskGrid:get'; payload: { year: number; month: number; projectIds?: number[] } }
  | { kind: 'daysOff:list'; payload: Record<string, never> }
  | { kind: 'daysOff:listInRange'; payload: { from: string; to: string } }
  | { kind: 'daysOff:upsert'; payload: DayOffInputPayload }
  | { kind: 'daysOff:delete'; payload: { date: string } }
  | { kind: 'holidays:list'; payload: { year: number } }
  | { kind: 'reports:trend'; payload: { from: string; to: string; granularity: 'day' | 'week' | 'month'; projectId?: number } }
  | { kind: 'reports:byProject'; payload: { from: string; to: string; projectId?: number } }
  | { kind: 'reports:earnings'; payload: { from: string; to: string; projectId?: number } }
  | { kind: 'reports:heatmap'; payload: { from: string; to: string; projectId?: number } }
  | { kind: 'reports:contracts'; payload: { projectId?: number } }
  | { kind: 'reports:rateChanges'; payload: { from: string; to: string; projectId?: number } }
  | { kind: 'dashboard:overview'; payload: DashboardOverviewRequestPayload }
  | { kind: 'instances:findByCwd'; payload: { cwd: string } }
  | { kind: 'instances:setTask'; payload: { instanceId: string; taskId: number | null } }
  | { kind: 'openInVSCode'; payload: { path: string } }
  | { kind: 'claudeSettings:read'; payload: { scope: 'global' | 'project'; projectPath?: string } }
  | { kind: 'claudeSettings:write'; payload: { scope: 'global' | 'project'; projectPath?: string; content: string } }
  | { kind: 'skills:list'; payload: Record<string, never> }
  | { kind: 'agents:list'; payload: Record<string, never> }
  | { kind: 'jira:syncPreview'; payload: JiraSyncRequestPayload }
  | { kind: 'jira:sync'; payload: JiraSyncRequestPayload }
  | { kind: 'board:authPing'; payload: Record<string, never> }
  | { kind: 'board:get'; payload: { projectId: number } }
  | { kind: 'board:sync'; payload: { projectId: number } }
  | { kind: 'board:signIn'; payload: Record<string, never> }
  | { kind: 'board:remove'; payload: { taskId: number; projectId: number } }
  | { kind: 'tokens:usage'; payload: Record<string, never> }
  | { kind: 'rateLimits:usage'; payload: Record<string, never> }
  | { kind: 'statuslineCapture:status'; payload: Record<string, never> }
  | { kind: 'statuslineCapture:set'; payload: { enabled: boolean } }
  | { kind: 'openExternalUrl'; payload: { url: string } }
  | { kind: 'teams:joinMeeting'; payload: { joinUrl: string } }
  | { kind: 'teams:focusCall'; payload: Record<string, never> }
  | { kind: 'meetings:listToday'; payload: Record<string, never> }
  | { kind: 'teams:close'; payload: Record<string, never> }
  | { kind: 'terminalFocus'; payload: { instanceId: string } }
  | { kind: 'push:registerDevice'; payload: { token: string; platform: string; bundleId?: string } }
  | { kind: 'prs:list'; payload: Record<string, never> }
  | { kind: 'prs:refresh'; payload: { devopsPats?: Record<string, string> } }
  | { kind: 'prs:diff'; payload: { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> } }
  | { kind: 'prs:comments'; payload: { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> } }
  | { kind: 'prs:merge'; payload: { host: PrHost; repoKey: string; prNumber: number; deleteBranch: boolean; devopsPats?: Record<string, string> } }
  | { kind: 'prs:reviewState'; payload: { host: PrHost; repoKey: string; number: number; devopsPats?: Record<string, string> } }
  | { kind: 'prs:approve'; payload: { host: PrHost; repoKey: string; number: number; devopsPats?: Record<string, string> } }
  | { kind: 'prs:close'; payload: { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> } }
  // Renderer signals it has mounted and subscribed to the 'deep-link' channel,
  // so electron-main flushes any deep-link buffered during a cold-start window.
  | { kind: 'deepLink:ready'; payload: Record<string, never> }
  | { kind: 'reviews:projectRepo'; payload: { projectId: number } }
  | { kind: 'prReview:start'; payload: { host: PrHost; repoKey: string; prNumber: number } }
  | { kind: 'prReview:get'; payload: { reviewId: number } }
  | { kind: 'prReview:list'; payload: { repoKey?: string } }
  | { kind: 'prReview:cancel'; payload: { reviewId: number } }
  | { kind: 'prReview:postComments'; payload: { reviewId: number; findingIndexes: number[]; devopsPats?: Record<string, string> } }
  | { kind: 'devops:setPat'; payload: { host: string; pat: string } }
  | { kind: 'devops:hasPat'; payload: { host: string } }
  | { kind: 'prWatch:setPats'; payload: { pats: Record<string, string> } }
  | { kind: 'prWatch:list'; payload: Record<string, never> }
  | { kind: 'prWatch:markSeen'; payload: { host: PrHost; repoKey: string; prNumber: number } }
  | { kind: 'appearance:set'; payload: { mode: 'dark' | 'light' } };

export interface RunningInstancePayload {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
  jiraKeyHint: string | null;
  taskId: number | null;
}

export interface TrendDatumPayload {
  bucket: string;
  minutes: number;
  mds: number;
  /** Total CZK earned in this bucket (0 when no billable contract applies). */
  earned: number;
}

export interface ByProjectDatumPayload {
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: number;
  minutes: number;
  mds: number;
  earnedAmount: number | null;
}

export interface EarningsByProjectPayload {
  project_id: number;
  project_name: string;
  project_color: string;
  minutes: number;
  mds: number;
  earned_amount: number | null;
}

export interface EarningsResponsePayload {
  billableMinutes: number;
  unbillableMinutes: number;
  timeOffMinutes: number;
  billableMds: number;
  unbillableMds: number;
  /** Total CZK earned across all billable projects in the range. */
  totalEarned: number;
  /** Average CZK/h across billable projects (0 when no billable minutes). */
  avgEffectiveHourlyRate: number;
  byProject: EarningsByProjectPayload[];
}

export interface HeatmapDatumPayload {
  date: string;
  minutes: number;
  mds: number;
}

export interface DashboardOverviewRequestPayload {
  /** @deprecated legacy single-project filter; null = all. Prefer projectIds. */
  projectId?: number | null;
  /** Multi-project filter; empty/absent = all projects. Wins over projectId. */
  projectIds?: number[];
  /** Any ISO date inside the target sprint (YYYY-MM-DD). Server computes the sprint window. */
  sprintAnchor: string;
  /** ISO YYYY-MM-DD in the user's local tz, sent by renderer so the orchestrator
   *  doesn't derive "today" from its own clock. */
  todayDate: string;
}

export interface DashboardSprintDayPayload {
  /** YYYY-MM-DD. */
  date: string;
  /** Sum of minutes for the day (respects projectId filter). */
  minutes: number;
  worklogs: DashboardSprintWorklogPayload[];
}

export interface DashboardSprintWorklogPayload {
  /** Worklog PK — used as React key. */
  id: number;
  /** Task key like "FIE1933-19084", or null for ad-hoc tasks without a number. */
  taskNumber: string | null;
  /** Task title, e.g. "Operace odebraná z EK se neposune do...". */
  taskTitle: string;
  projectName: string;
  projectColor: string | null;
  minutes: number;
  note: string | null;
}

export interface DashboardHeatmapStatsPayload {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  /** Total minutes / 30 * 7, rounded to nearest minute. */
  weeklyAvgMinutes: number;
  busiestDay: { date: string; minutes: number } | null;
}

export interface DashboardTopProjectPayload {
  projectId: number;
  projectName: string;
  projectColor: string | null;
  minutes: number;
}

export interface DashboardActiveContractPayload {
  projectId: number;
  projectName: string;
  projectColor: string;
  contract: ContractReportRowPayload['contract'];
  /**
   * Every project this contract covers. A solo contract has a single entry
   * (the same project as `projectId`); a pooled contract shared across
   * projects (same contract_group_id) lists all its live member projects,
   * sorted by name. The card renders one dot + name per entry.
   */
  groupProjects: { id: number; name: string; color: string | null }[];
}

export interface DashboardOverviewResponsePayload {
  today: { minutes: number; earned: number };
  month: { minutes: number; earned: number };
  sprint: {
    /** ISO YYYY-MM-DD of the first day of the sprint window. */
    fromDate: string;
    /** ISO YYYY-MM-DD of the last day of the sprint window (inclusive). */
    toDate: string;
    /** Sprint length in days = days.length. Kept explicit for renderer clarity. */
    lengthDays: number;
    /** Sum of minutes across the sprint, respecting projectId filter. */
    totalMinutes: number;
    /** Sprint-wide earned total in CZK. */
    totalEarned: number;
    /** Per-day list — exactly `lengthDays` entries. */
    days: DashboardSprintDayPayload[];
  };
  heatmap30d: {
    fromDate: string;
    toDate: string;
    days: { date: string; minutes: number }[];
    stats: DashboardHeatmapStatsPayload;
  };
  topProjects: DashboardTopProjectPayload[];
  /** Non-archived `work` projects with at least one active contract row. */
  activeContracts: DashboardActiveContractPayload[];
}

export interface ContractReportRowPayload {
  projectId: number;
  projectName: string;
  projectColor: string;
  archived: number;
  contract: {
    rateId: number;
    projectId: number;
    effectiveFrom: string;
    endDate: string | null;
    hoursPerDay: number;
    mdLimit: number | null;
    minutesLogged: number;
    mdsUsed: number;
    mdsRemaining: number | null;
    elapsedWorkdays: number;
    totalWorkdays: number | null;
    workdaysRemaining: number | null;
    projectedTotalMds: number | null;
    isActive: boolean;
    isCompleted: boolean;
  };
}

export interface RateChangeMarkerPayload {
  projectId: number;
  projectName: string;
  projectColor: string;
  effectiveFrom: string;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
}

export interface DayOffInputPayload {
  date: string;
  kind: 'vacation' | 'sick' | 'other' | 'holiday';
  note?: string | null;
}

export interface DayOffViewPayload {
  date: string;
  kind: 'vacation' | 'sick' | 'other' | 'holiday';
  note: string | null;
  createdAt: string;
}

export interface PublicHolidayPayload {
  date: string;
  name: string;
}

export interface TaskGridTaskPayload {
  taskId: number;
  taskNumber: string;
  taskTitle: string;
  status: 'open' | 'in_progress' | 'to_accept' | 'done';
  estimatedMinutes: number | null;
  totalTracked: number;
  totalReported: number;
  epicId: number;
  epicName: string;
  projectId: number;
  projectName: string;
  projectColor: string;
  /** Per-project task URL template (`{n}` substituted at link-build time). */
  projectTaskUrlTemplate: string | null;
  isBillable: boolean;
  perDayTracked: Record<number, number>;
  perDayReported: Record<number, number>;
}

export interface TaskGridEarningsRowPayload {
  perDay: Record<number, number>;
  totalAmount: number;
  /** workdays × MD rate target — what the user would earn working every workday. */
  expectedAmount: number;
}

export interface TaskGridResponsePayload {
  year: number;
  month: number;
  daysInMonth: number;
  tasks: TaskGridTaskPayload[];
  dailyTotalsTracked: Record<number, number>;
  dailyTotalsReported: Record<number, number>;
  earningsByCurrency: TaskGridEarningsRowPayload[];
  /** (Mon-Fri − Czech public holidays) × 8h, used as the capacity divisor. */
  monthCapacityMinutes: number;
  publicHolidays: Array<{ date: string; name: string }>;
  daysOff: DayOffViewPayload[];
}

export interface ContractInputPayload {
  projectId: number;
  /** Shared-contract member project ids. Omitted/length<=1 behaves as a solo contract. */
  projectIds?: number[];
  effectiveFrom: string;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay?: number;
  endDate?: string | null;
  mdLimit?: number | null;
}

export interface ContractViewPayload {
  id: number;
  projectId: number;
  effectiveFrom: string;
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
  createdAt: string;
  // Computed status fields (joined / derived):
  minutesLogged: number;
  mdsUsed: number;
  mdsRemaining: number | null;
  elapsedWorkdays: number;
  totalWorkdays: number | null;
  workdaysRemaining: number | null;
  projectedTotalMds: number | null;
  isActive: boolean;
  isCompleted: boolean;
  /** Shared-contract group id, or null for a solo (single-project) contract. */
  groupId: string | null;
  /** Member project ids — `[projectId]` for a solo contract. */
  projectIds: number[];
}

export interface WorklogListFilterPayload {
  projectId?: number;
  epicId?: number;
  taskId?: number;
  from?: string;
  to?: string;
  source?: string;
  search?: string;
}

export interface WorklogInputPayload {
  taskId: number;
  description?: string | null;
  workDate: string;
  minutes: number;
  reportedMinutes?: number | null;
  source?: string | null;
  externalId?: string | null;
  jiraUploaded?: boolean;
}

export interface WorklogViewPayload {
  id: number;
  taskId: number;
  description: string | null;
  workDate: string;
  minutes: number;
  reportedMinutes: number | null;
  source: string | null;
  externalId: string | null;
  jiraUploaded: boolean;
  createdAt: string;
  taskNumber: string;
  taskTitle: string;
  epicId: number;
  epicName: string;
  projectId: number;
  projectName: string;
  projectColor: string;
}

export interface EpicInputPayload {
  projectId: number;
  name: string;
  /** Substring matched against the linked Jira epic's name during board-sync
   *  routing. Empty/null opts this epic out of substring routing. */
  shortcut?: string | null;
  description?: string | null;
  status?: 'planned' | 'active' | 'done';
  jiraEpicKey?: string | null;
  githubIssueUrl?: string | null;
}

export interface EpicViewPayload {
  id: number;
  projectId: number;
  name: string;
  /** Substring matched against the linked Jira epic's name during board-sync
   *  routing. NULL → this epic doesn't participate in shortcut routing. */
  shortcut: string | null;
  description: string | null;
  status: 'planned' | 'active' | 'done';
  displayOrder: number;
  jiraEpicKey: string | null;
  githubIssueUrl: string | null;
  createdAt: string;
  taskCount: number;
  totalMinutes: number;
}

/** EpicViewPayload + joined project name/color, used by the Settings
 *  default-meetings-task picker which needs to span every project. */
export interface EpicWithProjectPayload extends EpicViewPayload {
  projectName: string;
  projectColor: string;
}

export interface TaskInputPayload {
  epicId: number;
  number: string;
  title: string;
  description?: string | null;
  status?: 'open' | 'in_progress' | 'to_accept' | 'done';
  estimatedMinutes?: number | null;
}

export interface TaskViewPayload {
  id: number;
  epicId: number;
  number: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'to_accept' | 'done';
  estimatedMinutes: number | null;
  createdAt: string;
  totalMinutes: number;
}

/** Task plus the project + epic context needed for the settings UI chip. */
export interface TaskByNumberPayload {
  id: number;
  number: string;
  title: string;
  status: 'open' | 'in_progress' | 'to_accept' | 'done';
  epicId: number;
  epicName: string;
  projectId: number;
  projectName: string;
  projectColor: string;
}

export interface ProjectListFilterPayload {
  archived?: boolean;
  kind?: 'work' | 'time_off';
  search?: string;
}

export interface ProjectInputPayload {
  name: string;
  color?: string;
  kind?: 'work' | 'time_off';
  isPinned?: boolean;
  folderPath?: string | null;
  jiraGlobs?: string[];
  jiraBoardUrl?: string | null;
  /** URL template for opening a task in its tracker. `{n}` → task number. */
  taskUrlTemplate?: string | null;
  description?: string | null;
  autoTrack?: boolean;
}

export interface ProjectViewPayload {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  kind: 'work' | 'time_off';
  isPinned: boolean;
  folderPath: string | null;
  jiraGlobs: string[];
  jiraBoardUrl: string | null;
  /** URL template for opening a task in its tracker. `{n}` → task number. */
  taskUrlTemplate: string | null;
  description: string | null;
  autoTrack: boolean;
  createdAt: string;
  epicCount: number;
  totalMinutes: number;
}

export type NotePriority = 'none' | 'low' | 'med' | 'high';
export type NoteDone = null | 0 | 1;

export interface NoteListFilterPayload {
  scope?: 'all' | 'global' | 'project';
  projectId?: number;
  search?: string;
  openTodosOnly?: boolean;
  dueSoon?: boolean;
  includeCompleted?: boolean;
}

export interface NoteInputPayload {
  title?: string;
  body?: string;
  done?: NoteDone;
  dueDate?: string | null;
  priority?: NotePriority;
  pinned?: boolean;
  projectId?: number | null;
}

export interface NoteViewPayload {
  id: number;
  title: string;
  body: string;
  done: NoteDone;
  doneAt: string | null;
  dueDate: string | null;
  priority: NotePriority;
  pinned: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Reviews (PR listing + diff) ───
export type PrHost = 'github' | 'azdo';

export interface PullRequestPayload {
  host: PrHost;
  repoKey: string;
  repoLabel: string;
  number: number;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  updatedAt: string;
  reviewable: boolean; // false when repo not cloned locally
}

export interface PrWatchInboxItem {
  host: PrHost;
  repoKey: string;
  repoLabel: string;
  prNumber: number;
  title: string;
  myRole: 'author' | 'reviewer';
  approved: boolean;
  mergeable: boolean;
  mergeBlockedReason: string | null;
  latestEvent: string;
  latestAt: string;
  unread: boolean;
}

export interface DiffLinePayload {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffFilePayload {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLinePayload[];
}

export interface PrCommentPayload { author: string; date: string; body: string; }
export interface PrCommentThreadPayload {
  id: string;
  file: string | null;   // repo-relative path, or null for general PR comments
  line: number | null;   // 1-based line (right side), or null
  status: string | null; // e.g. 'active' | 'fixed' | 'closed' (azdo); null for github
  comments: PrCommentPayload[];
}

export interface PrFindingPayload {
  file: string;
  line: number;
  severity: 'error' | 'warn' | 'info';
  category: string;
  summary: string;
  detail?: string;
  posted?: boolean;
}

export interface PrReviewPayload {
  id: number;
  host: PrHost;
  repoKey: string;
  prNumber: number;
  headSha: string;
  status: 'running' | 'done' | 'error';
  summary: string | null;
  findings: PrFindingPayload[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number; orch: number } }
  | { kind: 'spawnInstance'; payload: { instanceId: string | null; error?: string } }
  | { kind: 'ptyWrite'; payload: { ok: true } }
  | { kind: 'ptyResize'; payload: { ok: true } }
  | { kind: 'terminalAttach'; payload: { data: string; cols: number; rows: number } }
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'removeInstance'; payload: { ok: true } }
  | { kind: 'restartInstance'; payload: { ok: boolean } }
  | { kind: 'reorderInstances'; payload: { ok: true } }
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{
          id: string;
          cwd: string;
          status: string;
          lastActivityAt: number;
          kind: import('./stateModel.js').InstanceKind;
          taskId: number | null;
        }>;
      };
    }
  | { kind: 'chooseDirectory'; payload: { path: string | null } }
  | { kind: 'getSetting'; payload: { value: string | null } }
  | { kind: 'setSetting'; payload: { ok: true } }
  | { kind: 'hub:getConfig'; payload: { config: HubConfig } }
  | { kind: 'hub:setConfig'; payload: { ok: true } }
  | { kind: 'cloudSync:getConfig'; payload: { enabled: boolean; available: boolean } }
  | { kind: 'cloudSync:setConfig'; payload: { ok: true; needsRestart: boolean } }
  | {
      kind: 'previewHookInstall';
      payload: {
        settingsPath: string;
        helperPath: string;
        alreadyInstalled: boolean;
        entries: Array<{ event: string; command: string; alreadyPresent: boolean }>;
        preserved: Array<{ event: string; command: string }>;
      };
    }
  | { kind: 'installHooks'; payload: { changed: boolean; backedUp: string | null } }
  | { kind: 'uninstallHooks'; payload: { changed: boolean } }
  | { kind: 'snooze'; payload: { ok: true } }
  | { kind: 'focusChanged'; payload: { ok: true } }
  | { kind: 'sendTestNotification'; payload: { ok: true } }
  | { kind: 'projects:list'; payload: { projects: ProjectViewPayload[] } }
  | { kind: 'projects:get'; payload: { project: ProjectViewPayload | null } }
  | { kind: 'projects:create'; payload: { project: ProjectViewPayload } }
  | { kind: 'projects:update'; payload: { project: ProjectViewPayload } }
  | { kind: 'projects:archive'; payload: { ok: true } }
  | { kind: 'projects:delete'; payload: { ok: true } }
  | { kind: 'notes:list'; payload: { notes: NoteViewPayload[] } }
  | { kind: 'notes:create'; payload: { note: NoteViewPayload } }
  | { kind: 'notes:update'; payload: { note: NoteViewPayload } }
  | { kind: 'notes:delete'; payload: { ok: true } }
  | { kind: 'epics:list'; payload: { epics: EpicViewPayload[] } }
  | { kind: 'epics:listAll'; payload: { epics: EpicWithProjectPayload[] } }
  | { kind: 'epics:create'; payload: { epic: EpicViewPayload } }
  | { kind: 'epics:update'; payload: { epic: EpicViewPayload } }
  | { kind: 'epics:reorder'; payload: { ok: true } }
  | { kind: 'epics:delete'; payload: { ok: true } }
  | { kind: 'tasks:listForEpic'; payload: { tasks: TaskViewPayload[] } }
  | { kind: 'tasks:listForProject'; payload: { tasks: TaskViewPayload[] } }
  | { kind: 'tasks:findByNumber'; payload: { task: TaskByNumberPayload | null } }
  | { kind: 'tasks:findById'; payload: { task: TaskByNumberPayload | null } }
  | { kind: 'tasks:create'; payload: { task: TaskViewPayload } }
  | { kind: 'tasks:update'; payload: { task: TaskViewPayload } }
  | { kind: 'tasks:delete'; payload: { ok: true } }
  | { kind: 'worklogs:list'; payload: { worklogs: WorklogViewPayload[] } }
  | { kind: 'worklogs:create'; payload: { worklog: WorklogViewPayload } }
  | { kind: 'worklogs:update'; payload: { worklog: WorklogViewPayload } }
  | { kind: 'worklogs:delete'; payload: { ok: true } }
  | { kind: 'contracts:listForProject'; payload: { contracts: ContractViewPayload[] } }
  | { kind: 'contracts:create'; payload: { contract: ContractViewPayload } | { error: 'overlap'; conflictingId: number; conflictingFrom: string; conflictingTo: string | null; conflictingProjectId: number; conflictingProjectName: string } }
  | { kind: 'contracts:update'; payload: { contract: ContractViewPayload } | { error: 'overlap'; conflictingId: number; conflictingFrom: string; conflictingTo: string | null; conflictingProjectId: number; conflictingProjectName: string } }
  | { kind: 'contracts:delete'; payload: { ok: true } }
  | { kind: 'taskGrid:get'; payload: TaskGridResponsePayload }
  | { kind: 'daysOff:list'; payload: { daysOff: DayOffViewPayload[] } }
  | { kind: 'daysOff:listInRange'; payload: { daysOff: DayOffViewPayload[] } }
  | { kind: 'daysOff:upsert'; payload: { dayOff: DayOffViewPayload } }
  | { kind: 'daysOff:delete'; payload: { ok: true } }
  | { kind: 'holidays:list'; payload: { holidays: PublicHolidayPayload[] } }
  | { kind: 'reports:trend'; payload: { trend: TrendDatumPayload[] } }
  | { kind: 'reports:byProject'; payload: { byProject: ByProjectDatumPayload[] } }
  | { kind: 'reports:earnings'; payload: EarningsResponsePayload }
  | { kind: 'reports:heatmap'; payload: { heatmap: HeatmapDatumPayload[] } }
  | { kind: 'reports:contracts'; payload: { contracts: ContractReportRowPayload[] } }
  | { kind: 'reports:rateChanges'; payload: { rateChanges: RateChangeMarkerPayload[] } }
  | { kind: 'dashboard:overview'; payload: DashboardOverviewResponsePayload }
  | { kind: 'instances:findByCwd'; payload: { instances: RunningInstancePayload[] } }
  | { kind: 'instances:setTask'; payload: { ok: true } }
  | { kind: 'openInVSCode'; payload: { ok: boolean; error?: string } }
  | { kind: 'claudeSettings:read'; payload: ClaudeSettingsReadPayload }
  | { kind: 'claudeSettings:write'; payload: { ok: boolean; backupPath?: string; error?: string } }
  | { kind: 'skills:list'; payload: { skills: SkillRowPayload[] } }
  | { kind: 'agents:list'; payload: { agents: AgentRowPayload[] } }
  | { kind: 'jira:syncPreview'; payload: JiraSyncResultPayload }
  | { kind: 'jira:sync'; payload: JiraSyncResultPayload }
  | { kind: 'board:authPing'; payload: BoardAuthPingPayload }
  | { kind: 'board:get'; payload: BoardSnapshotPayload }
  | { kind: 'board:sync'; payload: { snapshot: BoardSnapshotPayload; result: BoardSyncResultPayload } }
  | { kind: 'board:signIn'; payload: { ok: boolean; error?: string } }
  | { kind: 'board:remove'; payload: { snapshot: BoardSnapshotPayload } }
  | { kind: 'tokens:usage'; payload: import('./tokenUsageFormat.js').TokenUsagePayload }
  | { kind: 'rateLimits:usage'; payload: import('./rateLimitsFormat.js').RateLimitsPayload }
  | { kind: 'statuslineCapture:status'; payload: { enabled: boolean; available: boolean } }
  | { kind: 'statuslineCapture:set'; payload: { ok: boolean; changed: boolean; backupPath: string | null; error?: string } }
  | { kind: 'openExternalUrl'; payload: { ok: boolean; error?: string } }
  | { kind: 'teams:joinMeeting'; payload: { ok: boolean } }
  | { kind: 'teams:focusCall'; payload: { ok: boolean } }
  | { kind: 'meetings:listToday'; payload: { meetings: import('./meetings.js').MeetingSummary[]; syncedAt: number | null } }
  | { kind: 'teams:close'; payload: { ok: boolean } }
  | { kind: 'terminalFocus'; payload: { ok: true } }
  | { kind: 'push:registerDevice'; payload: { ok: true } }
  | { kind: 'prs:list'; payload: { pullRequests: PullRequestPayload[]; syncedAt: string | null; warnings: string[] } }
  | { kind: 'prs:refresh'; payload: { pullRequests: PullRequestPayload[]; syncedAt: string | null; warnings: string[] } }
  | { kind: 'prs:diff'; payload: { files: DiffFilePayload[] } }
  | { kind: 'prs:comments'; payload: { threads: PrCommentThreadPayload[] } }
  | { kind: 'prs:merge'; payload: { ok: true } }
  | { kind: 'prs:reviewState'; payload: { amIAuthor: boolean; approved: boolean; mergeable: boolean; mergeBlockedReason: string | null } }
  | { kind: 'prs:approve'; payload: { ok: true } }
  | { kind: 'prs:close'; payload: { ok: true } }
  | { kind: 'deepLink:ready'; payload: { ok: true } }
  | { kind: 'reviews:projectRepo'; payload: { host: 'github' | 'azdo' | null; devopsHost: string | null; repoLabel: string | null } }
  | { kind: 'devops:setPat'; payload: { ok: true } }
  // `unreadable` is true when a PAT blob is stored for the host but can't be
  // decrypted (keychain key rotated after an unsigned-app rebuild) — the UI
  // prompts to re-enter rather than showing the misleading "not set" state.
  | { kind: 'devops:hasPat'; payload: { hasPat: boolean; unreadable: boolean } }
  | { kind: 'prWatch:setPats'; payload: { ok: true } }
  | { kind: 'prWatch:list'; payload: { items: PrWatchInboxItem[]; unread: number } }
  | { kind: 'prWatch:markSeen'; payload: { ok: true } }
  | { kind: 'prReview:start'; payload: { reviewId: number } }
  | { kind: 'prReview:get'; payload: { review: PrReviewPayload | null } }
  | { kind: 'prReview:list'; payload: { reviews: PrReviewPayload[] } }
  | { kind: 'prReview:cancel'; payload: { ok: true } }
  | { kind: 'prReview:postComments'; payload: { posted: number; skipped: number; errors: string[] } }
  | { kind: 'appearance:set'; payload: { ok: true } };

export interface AgentRowPayload {
  name: string;
  path: string;
  source: string;
  description: string;
  model: string;
  tools: string;
  body: string;
}

export interface SkillRowPayload {
  name: string;
  path: string;
  source: string;
  description: string;
  body: string;
}

export interface JiraSyncRequestPayload {
  /** Inclusive ISO YYYY-MM-DD. */
  from: string;
  /** Inclusive ISO YYYY-MM-DD. */
  to: string;
  /** Optional project filter; omit to sync across all projects. */
  projectId?: number;
  /** Skip worklogs already posted to Jira. Default true. */
  onlyUnposted?: boolean;
}

export type JiraSyncEntryStatus = 'posted' | 'skipped' | 'failed' | 'pending';

export interface JiraSyncEntryPayload {
  worklogId: number;
  taskId: number;
  taskNumber: string;
  taskTitle: string;
  workDate: string;
  minutes: number;
  /** Human-readable, e.g. "2h 30m" — Jira's `timeSpent` shape. */
  timeSpent: string;
  comment: string;
  status: JiraSyncEntryStatus;
  reason?: string;
  jiraWorklogId?: string;
  jiraWorklogUrl?: string;
  alreadyPosted?: boolean;
}

export interface JiraSyncResultPayload {
  totalCandidates: number;
  skippedNoJiraKey: number;
  skippedAlreadyPosted: number;
  skippedTaskNotOpen: number;
  attempted: number;
  posted: number;
  failed: number;
  tasksMarkedDone: number;
  neededBrowserRefresh: boolean;
  /** `true` for the preview endpoint, `false` for the actual sync run. */
  dryRun: boolean;
  /** Top-level message when the call could not even start (e.g. config missing). */
  error?: string;
  entries: JiraSyncEntryPayload[];
}

// ─── Board (Jira Kanban) ───
export interface BoardAuthPingPayload {
  /** JIRA_BASE_URL and JIRA_KEYCHAIN_ACCOUNT are both set. */
  configured: boolean;
  /** A non-empty cookie is stored in Keychain right now. */
  cookiePresent: boolean;
  /** baseUrl, or null when not configured — used for the "Open in Jira" link. */
  baseUrl: string | null;
}

export type BoardColumn = 'todo' | 'doing' | 'to_accept' | 'done';

export interface BoardCardPayload {
  taskId: number;
  jiraKey: string;
  title: string;
  /** Long-form description mirrored from Jira on every board sync. */
  description: string | null;
  /** Raw Jira status (e.g. "In Review"); preserved for tooltips. */
  jiraStatus: string;
  /** Pre-computed column from the merged Jira→Watchtower mapping. */
  column: BoardColumn;
  estimateSeconds: number | null;
  /** Total minutes logged locally against this task (sum of worklogs). */
  loggedMinutes: number;
  component: string | null;
  projectId: number;
  projectName: string;
  projectColor: string;
  epicId: number;
  epicName: string;
  syncedAt: string | null;
}

export interface BoardSnapshotPayload {
  cards: BoardCardPayload[];
  /** Newest jira_synced_at across all cards in the snapshot. */
  syncedAt: string | null;
  /** Result of the most recent sync call, if one ran in this session. */
  lastSyncResult: BoardSyncResultPayload | null;
}

export interface BoardSyncResultPayload {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  fetched: number;
  upserted: number;
  created: number;
  unrouted: number;
  unroutedKeys: string[];
  removedFromBoard: number;
  neededBrowserRefresh: boolean;
  /**
   * `true` when sync failed because Jira rejected the stored cookie
   * (302 to SSO, 401, 403). The UI uses this to flip the action button
   * from "Refresh" to "Sign in to Jira" even though a (now-stale)
   * cookie is still present in Keychain.
   */
  authFailed?: boolean;
  /** Top-level fatal error (config/auth/network). Per-card failures don't set this. */
  error?: string;
  /**
   * Non-fatal advisory shown to the user when the sync succeeded but degraded
   * (e.g. a quickFilter couldn't be applied and the board fell back to its
   * base filter). Absent when there is nothing to warn about.
   */
  warning?: string;
}

export interface ClaudeSettingsReadPayload {
  /** Absolute path that was read (or attempted). */
  path: string;
  /** True iff the file existed on disk. */
  exists: boolean;
  /** Raw file content as a string. Empty string when the file did not exist. */
  content: string;
}

export type IpcPush =
  | { kind: 'hello'; payload: { version: string } }
  | { kind: 'ptyData'; payload: { instanceId: string; chunk: string } }
  | { kind: 'ptyExit'; payload: { instanceId: string; code: number } }
  | { kind: 'stateChanged'; payload: { instanceId: string; status: string } }
  | {
      kind: 'notify';
      payload:
        | { target?: 'instance'; instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' }
        | {
            target: 'pr';
            host: PrHost;
            repoKey: string;
            prNumber: number;
            title: string;
            repoLabel: string;
            event: string; // WatchEvent['type']
            body: string; // ready-to-display notification body
          };
    }
  | { kind: 'clearAttention'; payload: { instanceId: string } }
  | { kind: 'authBlock'; payload: { instanceId: string; blocked: boolean; reason?: string } }
  | { kind: 'badge'; payload: { count: number } }
  | { kind: 'activateInstance'; payload: { instanceId: string } }
  | { kind: 'teamsStateChanged'; payload: import('./teamsState.js').TeamsPushState }
  | { kind: 'triggerNewInstance'; payload: Record<string, never> }
  | { kind: 'tokenUsage'; payload: import('./tokenUsageFormat.js').TokenUsagePayload }
  | { kind: 'rateLimitsUsage'; payload: import('./rateLimitsFormat.js').RateLimitsPayload }
  | {
      kind: 'orchestratorCrashed';
      payload: { code: number | null; restarting: boolean };
    }
  | { kind: 'prReviewProgress'; payload: { reviewId: number; status: 'running' | 'done' | 'error'; message: string } }
  | { kind: 'prReviewDone'; payload: { reviewId: number } }
  | { kind: 'prWatchEvent'; payload: { host: PrHost; repoKey: string; prNumber: number } }
  | { kind: 'prsChanged'; payload: Record<string, never> }
  // Sent by electron/ipc.ts's macOS notification click handler directly on the
  // 'deep-link' webContents channel (not multiplexed through 'watchtower:push'),
  // so the preload bridges it separately — see electron/preload.ts.
  | { kind: 'deep-link'; payload: { module: 'reviews'; host: PrHost; repoKey: string; prNumber: number } };

export const ELECTRON_ONLY_KINDS: ReadonlySet<IpcRequest['kind']> = new Set([
  'chooseDirectory',
  'sendTestNotification',
  'openInVSCode',
  'openExternalUrl',
  'board:signIn',
  'appearance:set',
  'devops:setPat',
  'devops:hasPat',
  'cloudSync:getConfig',
  'cloudSync:setConfig',
  'deepLink:ready',
  'teams:joinMeeting',
  'teams:focusCall',
  'teams:close',
]);

export interface WatchtowerBridge {
  invoke<T extends IpcRequest['kind']>(
    kind: T,
    payload: Extract<IpcRequest, { kind: T }>['payload'],
  ): Promise<Extract<IpcResponse, { kind: T }>['payload']>;
  on<T extends IpcPush['kind']>(
    kind: T,
    handler: (payload: Extract<IpcPush, { kind: T }>['payload']) => void,
  ): () => void;
}
