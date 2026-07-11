import type { HubConfig } from './hubConfig.js';

export type OrchRequest =
  | { id: string; kind: 'ping'; payload: { now: number } }
  | { id: string; kind: 'spawnInstance'; payload: { cwd: string; args?: string[]; instanceKind?: import('./stateModel.js').InstanceKind } }
  | { id: string; kind: 'restartInstance'; payload: { instanceId: string } }
  | { id: string; kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { id: string; kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { id: string; kind: 'terminalAttach'; payload: { instanceId: string } }
  | { id: string; kind: 'killInstance'; payload: { instanceId: string } }
  | { id: string; kind: 'removeInstance'; payload: { instanceId: string } }
  | { id: string; kind: 'reorderInstances'; payload: { orderedIds: string[] } }
  | { id: string; kind: 'listInstances'; payload: Record<string, never> }
  | { id: string; kind: 'getSetting'; payload: { key: string } }
  | { id: string; kind: 'setSetting'; payload: { key: string; value: string } }
  | { id: string; kind: 'hub:getConfig'; payload: Record<string, never> }
  | { id: string; kind: 'hub:setConfig'; payload: { config: HubConfig } }
  | { id: string; kind: 'windowFocusChanged'; payload: { focused: boolean } }
  | { id: string; kind: 'previewHookInstall'; payload: Record<string, never> }
  | { id: string; kind: 'installHooks'; payload: Record<string, never> }
  | { id: string; kind: 'uninstallHooks'; payload: Record<string, never> }
  | { id: string; kind: 'snooze'; payload: { instanceId: string | '*'; untilMs: number } }
  | { id: string; kind: 'focusChanged'; payload: { instanceId: string | null } }
  | { id: string; kind: 'projects:list'; payload: OrchProjectListFilter }
  | { id: string; kind: 'projects:get'; payload: { id: number } }
  | { id: string; kind: 'projects:create'; payload: OrchProjectInput }
  | { id: string; kind: 'projects:update'; payload: { id: number; input: Partial<OrchProjectInput> } }
  | { id: string; kind: 'projects:archive'; payload: { id: number; archived: boolean } }
  | { id: string; kind: 'projects:delete'; payload: { id: number } }
  | { id: string; kind: 'epics:list'; payload: { projectId: number } }
  | { id: string; kind: 'epics:listAll'; payload: Record<string, never> }
  | { id: string; kind: 'epics:create'; payload: OrchEpicInput }
  | { id: string; kind: 'epics:update'; payload: { id: number; input: Partial<OrchEpicInput> } }
  | { id: string; kind: 'epics:reorder'; payload: { projectId: number; orderedIds: number[] } }
  | { id: string; kind: 'epics:delete'; payload: { id: number } }
  | { id: string; kind: 'tasks:listForEpic'; payload: { epicId: number } }
  | { id: string; kind: 'tasks:listForProject'; payload: { projectId: number } }
  | { id: string; kind: 'tasks:findByNumber'; payload: { number: string } }
  | { id: string; kind: 'tasks:findById'; payload: { id: number } }
  | { id: string; kind: 'tasks:create'; payload: OrchTaskInput }
  | { id: string; kind: 'tasks:update'; payload: { id: number; input: Partial<OrchTaskInput> } }
  | { id: string; kind: 'tasks:delete'; payload: { id: number } }
  | { id: string; kind: 'worklogs:list'; payload: OrchWorklogListFilter }
  | { id: string; kind: 'worklogs:create'; payload: OrchWorklogInput }
  | { id: string; kind: 'worklogs:update'; payload: { id: number; input: Partial<OrchWorklogInput> } }
  | { id: string; kind: 'worklogs:delete'; payload: { id: number } }
  | { id: string; kind: 'contracts:listForProject'; payload: { projectId: number } }
  | { id: string; kind: 'contracts:create'; payload: OrchContractInput }
  | { id: string; kind: 'contracts:update'; payload: { id: number; input: Partial<OrchContractInput> } }
  | { id: string; kind: 'contracts:delete'; payload: { id: number } }
  | { id: string; kind: 'taskGrid:get'; payload: { year: number; month: number; projectIds?: number[] } }
  | { id: string; kind: 'daysOff:list'; payload: Record<string, never> }
  | { id: string; kind: 'daysOff:listInRange'; payload: { from: string; to: string } }
  | { id: string; kind: 'daysOff:upsert'; payload: OrchDayOffInput }
  | { id: string; kind: 'daysOff:delete'; payload: { date: string } }
  | { id: string; kind: 'holidays:list'; payload: { year: number } }
  | { id: string; kind: 'reports:trend'; payload: { from: string; to: string; granularity: 'day' | 'week' | 'month'; projectId?: number } }
  | { id: string; kind: 'reports:byProject'; payload: { from: string; to: string; projectId?: number } }
  | { id: string; kind: 'reports:earnings'; payload: { from: string; to: string; projectId?: number } }
  | { id: string; kind: 'reports:heatmap'; payload: { from: string; to: string; projectId?: number } }
  | { id: string; kind: 'reports:contracts'; payload: { projectId?: number } }
  | { id: string; kind: 'reports:rateChanges'; payload: { from: string; to: string; projectId?: number } }
  | { id: string; kind: 'dashboard:overview'; payload: import('./ipcContract.js').DashboardOverviewRequestPayload }
  | { id: string; kind: 'instances:findByCwd'; payload: { cwd: string } }
  | { id: string; kind: 'instances:setTask'; payload: { instanceId: string; taskId: number | null } }
  | { id: string; kind: 'claudeSettings:read'; payload: { scope: 'global' | 'project'; projectPath?: string } }
  | { id: string; kind: 'claudeSettings:write'; payload: { scope: 'global' | 'project'; projectPath?: string; content: string } }
  | { id: string; kind: 'skills:list'; payload: Record<string, never> }
  | { id: string; kind: 'agents:list'; payload: Record<string, never> }
  | { id: string; kind: 'jira:syncPreview'; payload: OrchJiraSyncRequest }
  | { id: string; kind: 'jira:sync'; payload: OrchJiraSyncRequest }
  | { id: string; kind: 'board:authPing'; payload: Record<string, never> }
  | { id: string; kind: 'board:get'; payload: { projectId: number } }
  | { id: string; kind: 'board:sync'; payload: { projectId: number } }
  | { id: string; kind: 'board:remove'; payload: { taskId: number; projectId: number } }
  | { id: string; kind: 'tokens:usage'; payload: Record<string, never> }
  | { id: string; kind: 'terminalFocus'; payload: { instanceId: string } }
  | { id: string; kind: 'push:registerDevice'; payload: { token: string; platform: string } }
  | { id: string; kind: 'prs:list'; payload: Record<string, never> }
  | { id: string; kind: 'prs:refresh'; payload: { devopsPats?: Record<string, string> } }
  | {
      id: string;
      kind: 'prs:diff';
      payload: {
        host: import('./ipcContract.js').PrHost;
        repoKey: string;
        prNumber: number;
        devopsPats?: Record<string, string>;
      };
    }
  | {
      id: string;
      kind: 'prs:comments';
      payload: {
        host: import('./ipcContract.js').PrHost;
        repoKey: string;
        prNumber: number;
        devopsPats?: Record<string, string>;
      };
    }
  | { id: string; kind: 'reviews:projectRepo'; payload: { projectId: number } }
  | {
      id: string;
      kind: 'prReview:start';
      payload: { host: import('./ipcContract.js').PrHost; repoKey: string; prNumber: number };
    }
  | { id: string; kind: 'prReview:get'; payload: { reviewId: number } }
  | { id: string; kind: 'prReview:list'; payload: { repoKey?: string } };

export interface OrchRunningInstance {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
  jiraKeyHint: string | null;
  taskId: number | null;
}

export interface OrchTrendDatum {
  bucket: string;
  minutes: number;
  /** Total CZK earned in this bucket (0 when no billable contract applies). */
  earned: number;
}

export interface OrchByProjectDatum {
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: number;
  minutes: number;
  earnedAmount: number | null;
}

export interface OrchEarningsByProject {
  project_id: number;
  project_name: string;
  project_color: string;
  minutes: number;
  earned_amount: number | null;
}

export interface OrchEarningsResponse {
  billableMinutes: number;
  unbillableMinutes: number;
  timeOffMinutes: number;
  /** Total CZK earned across all billable projects in the range. */
  totalEarned: number;
  /** Average CZK/h across billable projects (0 when no billable minutes). */
  avgEffectiveHourlyRate: number;
  byProject: OrchEarningsByProject[];
}

export interface OrchHeatmapDatum {
  date: string;
  minutes: number;
}

export interface OrchContractReportRow {
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

export interface OrchRateChangeMarker {
  projectId: number;
  projectName: string;
  projectColor: string;
  effectiveFrom: string;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
}

export interface OrchDayOffInput {
  date: string;
  kind: 'vacation' | 'sick' | 'other' | 'holiday';
  note?: string | null;
}

export interface OrchDayOffView {
  date: string;
  kind: 'vacation' | 'sick' | 'other' | 'holiday';
  note: string | null;
  createdAt: string;
}

export interface OrchPublicHoliday {
  date: string;
  name: string;
}

export interface OrchTaskGridTask {
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
  isBillable: boolean;
  perDayTracked: Record<number, number>;
  perDayReported: Record<number, number>;
}

export interface OrchTaskGridEarningsRow {
  perDay: Record<number, number>;
  totalAmount: number;
}

export interface OrchTaskGridResponse {
  year: number;
  month: number;
  daysInMonth: number;
  tasks: OrchTaskGridTask[];
  dailyTotalsTracked: Record<number, number>;
  dailyTotalsReported: Record<number, number>;
  earningsByCurrency: OrchTaskGridEarningsRow[];
  monthCapacityMinutes: number;
  publicHolidays: Array<{ date: string; name: string }>;
  daysOff: OrchDayOffView[];
}

export interface OrchContractInput {
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

export interface OrchContractView {
  id: number;
  projectId: number;
  effectiveFrom: string;
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
  createdAt: string;
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

export interface OrchOverlapError {
  error: 'overlap';
  conflictingId: number;
  conflictingFrom: string;
  conflictingTo: string | null;
  conflictingProjectId: number;
  conflictingProjectName: string;
}

export interface OrchWorklogListFilter {
  projectId?: number;
  epicId?: number;
  taskId?: number;
  from?: string;
  to?: string;
  source?: string;
  search?: string;
}

export interface OrchWorklogInput {
  taskId: number;
  description?: string | null;
  workDate: string;
  minutes: number;
  reportedMinutes?: number | null;
  source?: string | null;
  externalId?: string | null;
  jiraUploaded?: boolean;
}

export interface OrchWorklogView {
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

export interface OrchEpicInput {
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

export interface OrchEpicView {
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

export interface OrchEpicWithProject extends OrchEpicView {
  projectName: string;
  projectColor: string;
}

export interface OrchTaskInput {
  epicId: number;
  number: string;
  title: string;
  description?: string | null;
  status?: 'open' | 'in_progress' | 'to_accept' | 'done';
  estimatedMinutes?: number | null;
}

export interface OrchTaskView {
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

export interface OrchTaskByNumber {
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

export interface OrchJiraSyncRequest {
  from: string;
  to: string;
  projectId?: number;
  onlyUnposted?: boolean;
}

export type OrchJiraSyncEntryStatus = 'posted' | 'skipped' | 'failed' | 'pending';

export interface OrchJiraSyncEntry {
  worklogId: number;
  taskId: number;
  taskNumber: string;
  taskTitle: string;
  workDate: string;
  minutes: number;
  timeSpent: string;
  comment: string;
  status: OrchJiraSyncEntryStatus;
  reason?: string;
  jiraWorklogId?: string;
  jiraWorklogUrl?: string;
  alreadyPosted?: boolean;
}

export interface OrchJiraSyncResult {
  totalCandidates: number;
  skippedNoJiraKey: number;
  skippedAlreadyPosted: number;
  skippedTaskNotOpen: number;
  attempted: number;
  posted: number;
  failed: number;
  tasksMarkedDone: number;
  neededBrowserRefresh: boolean;
  dryRun: boolean;
  error?: string;
  entries: OrchJiraSyncEntry[];
}

export interface OrchProjectListFilter {
  archived?: boolean;
  kind?: 'work' | 'time_off';
  search?: string;
}

export interface OrchProjectInput {
  name: string;
  color?: string;
  kind?: 'work' | 'time_off';
  isPinned?: boolean;
  folderPath?: string | null;
  jiraGlobs?: string[];
  description?: string | null;
}

export interface OrchProjectView {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  kind: 'work' | 'time_off';
  isPinned: boolean;
  folderPath: string | null;
  jiraGlobs: string[];
  description: string | null;
  createdAt: string;
  epicCount: number;
  totalMinutes: number;
}

export type OrchResponse =
  | { kind: 'ping'; payload: { now: number; orch: number } }
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
  | { kind: 'getSetting'; payload: { value: string | null } }
  | { kind: 'setSetting'; payload: { ok: true } }
  | { kind: 'hub:getConfig'; payload: { config: HubConfig } }
  | { kind: 'hub:setConfig'; payload: { ok: true } }
  | { kind: 'windowFocusChanged'; payload: { ok: true } }
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
  | { kind: 'projects:list'; payload: { projects: OrchProjectView[] } }
  | { kind: 'projects:get'; payload: { project: OrchProjectView | null } }
  | { kind: 'projects:create'; payload: { project: OrchProjectView } }
  | { kind: 'projects:update'; payload: { project: OrchProjectView } }
  | { kind: 'projects:archive'; payload: { ok: true } }
  | { kind: 'projects:delete'; payload: { ok: true } }
  | { kind: 'epics:list'; payload: { epics: OrchEpicView[] } }
  | { kind: 'epics:listAll'; payload: { epics: OrchEpicWithProject[] } }
  | { kind: 'epics:create'; payload: { epic: OrchEpicView } }
  | { kind: 'epics:update'; payload: { epic: OrchEpicView } }
  | { kind: 'epics:reorder'; payload: { ok: true } }
  | { kind: 'epics:delete'; payload: { ok: true } }
  | { kind: 'tasks:listForEpic'; payload: { tasks: OrchTaskView[] } }
  | { kind: 'tasks:listForProject'; payload: { tasks: OrchTaskView[] } }
  | { kind: 'tasks:findByNumber'; payload: { task: OrchTaskByNumber | null } }
  | { kind: 'tasks:findById'; payload: { task: OrchTaskByNumber | null } }
  | { kind: 'tasks:create'; payload: { task: OrchTaskView } }
  | { kind: 'tasks:update'; payload: { task: OrchTaskView } }
  | { kind: 'tasks:delete'; payload: { ok: true } }
  | { kind: 'worklogs:list'; payload: { worklogs: OrchWorklogView[] } }
  | { kind: 'worklogs:create'; payload: { worklog: OrchWorklogView } }
  | { kind: 'worklogs:update'; payload: { worklog: OrchWorklogView } }
  | { kind: 'worklogs:delete'; payload: { ok: true } }
  | { kind: 'contracts:listForProject'; payload: { contracts: OrchContractView[] } }
  | { kind: 'contracts:create'; payload: { contract: OrchContractView } | OrchOverlapError }
  | { kind: 'contracts:update'; payload: { contract: OrchContractView } | OrchOverlapError }
  | { kind: 'contracts:delete'; payload: { ok: true } }
  | { kind: 'taskGrid:get'; payload: OrchTaskGridResponse }
  | { kind: 'daysOff:list'; payload: { daysOff: OrchDayOffView[] } }
  | { kind: 'daysOff:listInRange'; payload: { daysOff: OrchDayOffView[] } }
  | { kind: 'daysOff:upsert'; payload: { dayOff: OrchDayOffView } }
  | { kind: 'daysOff:delete'; payload: { ok: true } }
  | { kind: 'holidays:list'; payload: { holidays: OrchPublicHoliday[] } }
  | { kind: 'reports:trend'; payload: { trend: OrchTrendDatum[] } }
  | { kind: 'reports:byProject'; payload: { byProject: OrchByProjectDatum[] } }
  | { kind: 'reports:earnings'; payload: OrchEarningsResponse }
  | { kind: 'reports:heatmap'; payload: { heatmap: OrchHeatmapDatum[] } }
  | { kind: 'reports:contracts'; payload: { contracts: OrchContractReportRow[] } }
  | { kind: 'reports:rateChanges'; payload: { rateChanges: OrchRateChangeMarker[] } }
  | { kind: 'dashboard:overview'; payload: import('./ipcContract.js').DashboardOverviewResponsePayload }
  | { kind: 'instances:findByCwd'; payload: { instances: OrchRunningInstance[] } }
  | { kind: 'instances:setTask'; payload: { ok: true } }
  | { kind: 'claudeSettings:read'; payload: { path: string; exists: boolean; content: string } }
  | { kind: 'claudeSettings:write'; payload: { ok: boolean; backupPath?: string; error?: string } }
  | { kind: 'skills:list'; payload: { skills: Array<{ name: string; path: string; source: string; description: string; body: string }> } }
  | { kind: 'agents:list'; payload: { agents: Array<{ name: string; path: string; source: string; description: string; model: string; tools: string; body: string }> } }
  | { kind: 'jira:syncPreview'; payload: OrchJiraSyncResult }
  | { kind: 'jira:sync'; payload: OrchJiraSyncResult }
  | { kind: 'board:authPing'; payload: import('./ipcContract.js').BoardAuthPingPayload }
  | { kind: 'board:get'; payload: import('./ipcContract.js').BoardSnapshotPayload }
  | {
      kind: 'board:sync';
      payload: {
        snapshot: import('./ipcContract.js').BoardSnapshotPayload;
        result: import('./ipcContract.js').BoardSyncResultPayload;
      };
    }
  | {
      kind: 'board:remove';
      payload: { snapshot: import('./ipcContract.js').BoardSnapshotPayload };
    }
  | { kind: 'tokens:usage'; payload: import('./tokenUsageFormat.js').TokenUsagePayload }
  | { kind: 'terminalFocus'; payload: { ok: true } }
  | { kind: 'push:registerDevice'; payload: { ok: true } }
  | {
      kind: 'prs:list';
      payload: { pullRequests: import('./ipcContract.js').PullRequestPayload[]; syncedAt: string | null };
    }
  | {
      kind: 'prs:refresh';
      payload: { pullRequests: import('./ipcContract.js').PullRequestPayload[]; syncedAt: string | null };
    }
  | { kind: 'prs:diff'; payload: { files: import('./ipcContract.js').DiffFilePayload[] } }
  | { kind: 'prs:comments'; payload: { threads: import('./ipcContract.js').PrCommentThreadPayload[] } }
  | {
      kind: 'reviews:projectRepo';
      payload: { host: 'github' | 'azdo' | null; devopsHost: string | null; repoLabel: string | null };
    }
  | { kind: 'prReview:start'; payload: { reviewId: number } }
  | { kind: 'prReview:get'; payload: { review: import('./ipcContract.js').PrReviewPayload | null } }
  | { kind: 'prReview:list'; payload: { reviews: import('./ipcContract.js').PrReviewPayload[] } };

export type OrchPush =
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
  | { kind: 'tokenUsage'; payload: import('./tokenUsageFormat.js').TokenUsagePayload }
  | { kind: 'prReviewProgress'; payload: { reviewId: number; status: 'running' | 'done' | 'error'; message: string } }
  | { kind: 'prReviewDone'; payload: { reviewId: number } };

type AnyPort = {
  postMessage(data: unknown): void;
  on?: (event: 'message', handler: (msg: { data: unknown }) => void) => void;
  addEventListener?: (event: 'message', handler: (msg: MessageEvent) => void) => void;
  start?: () => void;
};

type ResponseEnvelope = {
  id: string;
  kind: OrchResponse['kind'];
  payload: unknown;
  _response: true;
  // Present when the request handler threw. Carries the message so the caller
  // can reject its invoke() promise instead of hanging forever (a thrown
  // handler used to neither resolve nor reject — the renderer's Save button
  // would simply do nothing).
  _error?: { message: string };
};
type RequestEnvelope = OrchRequest;
type Envelope = ResponseEnvelope | RequestEnvelope | OrchPush;

export class PortApi {
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private requestHandler: ((req: OrchRequest) => Promise<unknown>) | null = null;
  // onPush is event-emitter-style: every call to .onPush() registers an
  // additional subscriber. Previously this was a single-handler setter, which
  // silently broke when two callers (electron/ipc.ts forwarding to the
  // renderer + electron/main.ts driving the tray) both wanted notifications.
  private pushHandlers: Array<(msg: OrchPush) => void> = [];

  constructor(private port: AnyPort) {
    if (port.on) {
      port.on('message', (msg) => this.handle(msg.data));
    } else if (port.addEventListener) {
      port.addEventListener('message', (msg) => this.handle(msg.data));
    }
    port.start?.();
  }

  invoke<T extends OrchRequest['kind']>(
    kind: T,
    payload: Extract<OrchRequest, { kind: T }>['payload'],
  ): Promise<Extract<OrchResponse, { kind: T }>['payload']> {
    const id = randomId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.port.postMessage({ id, kind, payload } as OrchRequest);
    });
  }

  push(message: OrchPush): void {
    this.port.postMessage(message);
  }

  onRequest(handler: (req: OrchRequest) => Promise<unknown>): void {
    this.requestHandler = handler;
  }

  onPush(handler: (msg: OrchPush) => void): () => void {
    this.pushHandlers.push(handler);
    return () => {
      this.pushHandlers = this.pushHandlers.filter((h) => h !== handler);
    };
  }

  private async handle(data: unknown): Promise<void> {
    const msg = data as Envelope;
    if (typeof msg !== 'object' || msg === null) return;

    if ('_response' in msg && msg._response) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg._error) pending.reject(new Error(msg._error.message));
        else pending.resolve(msg.payload);
      }
      return;
    }

    if ('id' in msg && 'kind' in msg && !('_response' in msg)) {
      if (!this.requestHandler) return;
      const req = msg as OrchRequest;
      let response: ResponseEnvelope;
      try {
        const payload = await this.requestHandler(req);
        response = {
          id: req.id,
          kind: req.kind as OrchResponse['kind'],
          payload,
          _response: true,
        };
      } catch (err) {
        // A throwing handler (e.g. assertTaskNotDone / WorklogLockedError) must
        // still produce a response, otherwise the caller's invoke() promise
        // hangs forever. Forward the message so the renderer can surface it.
        response = {
          id: req.id,
          kind: req.kind as OrchResponse['kind'],
          payload: undefined,
          _response: true,
          _error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
      this.port.postMessage(response);
      return;
    }

    if ('kind' in msg) {
      const push = msg as OrchPush;
      for (const handler of this.pushHandlers) {
        try {
          handler(push);
        } catch (err) {
          console.error('[PortApi] push handler threw:', err);
        }
      }
    }
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
