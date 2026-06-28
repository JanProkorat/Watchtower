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
  | { kind: 'taskGrid:get'; payload: { year: number; month: number; projectId?: number } }
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
  | { kind: 'openExternalUrl'; payload: { url: string } }
  | { kind: 'terminalFocus'; payload: { instanceId: string } }
  | { kind: 'push:registerDevice'; payload: { token: string; platform: string } };

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
  earnedByCurrency: Record<string, number>;
}

export interface ByProjectDatumPayload {
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: number;
  currency: string | null;
  minutes: number;
  mds: number;
  earnedAmount: number | null;
}

export interface EarningsByProjectPayload {
  project_id: number;
  project_name: string;
  project_color: string;
  currency: string | null;
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
  totalEarned: Record<string, number>;
  avgEffectiveHourlyRate: Record<string, number>;
  byProject: EarningsByProjectPayload[];
}

export interface HeatmapDatumPayload {
  date: string;
  minutes: number;
  mds: number;
}

export interface DashboardOverviewRequestPayload {
  /** Optional project filter; null = all projects. */
  projectId: number | null;
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
  currency: string | null;
  contract: ContractReportRowPayload['contract'];
}

export interface DashboardOverviewResponsePayload {
  today: { minutes: number; earned: Record<string, number> };
  month: { minutes: number; earned: Record<string, number> };
  sprint: {
    /** ISO YYYY-MM-DD of the first day of the sprint window. */
    fromDate: string;
    /** ISO YYYY-MM-DD of the last day of the sprint window (inclusive). */
    toDate: string;
    /** Sprint length in days = days.length. Kept explicit for renderer clarity. */
    lengthDays: number;
    /** Sum of minutes across the sprint, respecting projectId filter. */
    totalMinutes: number;
    /** Sprint-wide earned totals keyed by currency. */
    totalEarned: Record<string, number>;
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
  currency: string;
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
  currency: string;
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
  description?: string | null;
  status?: 'planned' | 'active' | 'done';
  jiraEpicKey?: string | null;
  githubIssueUrl?: string | null;
}

export interface EpicViewPayload {
  id: number;
  projectId: number;
  name: string;
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
  isDefault?: boolean;
  folderPath?: string | null;
  jiraGlobs?: string[];
  jiraBoardUrl?: string | null;
  /** URL template for opening a task in its tracker. `{n}` → task number. */
  taskUrlTemplate?: string | null;
  description?: string | null;
}

export interface ProjectViewPayload {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  kind: 'work' | 'time_off';
  isDefault: boolean;
  folderPath: string | null;
  jiraGlobs: string[];
  jiraBoardUrl: string | null;
  /** URL template for opening a task in its tracker. `{n}` → task number. */
  taskUrlTemplate: string | null;
  description: string | null;
  createdAt: string;
  epicCount: number;
  totalMinutes: number;
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
  | { kind: 'contracts:create'; payload: { contract: ContractViewPayload } | { error: 'overlap'; conflictingId: number; conflictingFrom: string; conflictingTo: string | null } }
  | { kind: 'contracts:update'; payload: { contract: ContractViewPayload } | { error: 'overlap'; conflictingId: number; conflictingFrom: string; conflictingTo: string | null } }
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
  | { kind: 'openExternalUrl'; payload: { ok: boolean; error?: string } }
  | { kind: 'terminalFocus'; payload: { ok: true } }
  | { kind: 'push:registerDevice'; payload: { ok: true } };

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
      payload: { instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' };
    }
  | { kind: 'clearAttention'; payload: { instanceId: string } }
  | { kind: 'authBlock'; payload: { instanceId: string; blocked: boolean; reason?: string } }
  | { kind: 'badge'; payload: { count: number } }
  | { kind: 'activateInstance'; payload: { instanceId: string } }
  | { kind: 'triggerNewInstance'; payload: Record<string, never> }
  | { kind: 'tokenUsage'; payload: import('./tokenUsageFormat.js').TokenUsagePayload }
  | {
      kind: 'orchestratorCrashed';
      payload: { code: number | null; restarting: boolean };
    };

export const ELECTRON_ONLY_KINDS: ReadonlySet<IpcRequest['kind']> = new Set([
  'chooseDirectory',
  'sendTestNotification',
  'openInVSCode',
  'openExternalUrl',
  'board:signIn',
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
