export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } }
  | { kind: 'spawnInstance'; payload: { cwd: string; args?: string[] } }
  | { kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { kind: 'killInstance'; payload: { instanceId: string } }
  | { kind: 'removeInstance'; payload: { instanceId: string } }
  | { kind: 'reorderInstances'; payload: { orderedIds: string[] } }
  | { kind: 'listInstances'; payload: Record<string, never> }
  | { kind: 'chooseDirectory'; payload: { defaultPath?: string } }
  | { kind: 'getSetting'; payload: { key: string } }
  | { kind: 'setSetting'; payload: { key: string; value: string } }
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
  | { kind: 'epics:create'; payload: EpicInputPayload }
  | { kind: 'epics:update'; payload: { id: number; input: Partial<EpicInputPayload> } }
  | { kind: 'epics:reorder'; payload: { projectId: number; orderedIds: number[] } }
  | { kind: 'epics:delete'; payload: { id: number } }
  | { kind: 'tasks:listForEpic'; payload: { epicId: number } }
  | { kind: 'tasks:listForProject'; payload: { projectId: number } }
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
  | { kind: 'reports:trend'; payload: { from: string; to: string; granularity: 'day' | 'week' | 'month' } }
  | { kind: 'reports:byProject'; payload: { from: string; to: string } }
  | { kind: 'reports:earnings'; payload: { from: string; to: string } }
  | { kind: 'reports:heatmap'; payload: { from: string; to: string } }
  | { kind: 'reports:contracts'; payload: Record<string, never> }
  | { kind: 'reports:rateChanges'; payload: { from: string; to: string } };

export interface TrendDatumPayload {
  bucket: string;
  minutes: number;
  earnedByCurrency: Record<string, number>;
}

export interface ByProjectDatumPayload {
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: number;
  currency: string | null;
  minutes: number;
  earnedAmount: number | null;
}

export interface EarningsByProjectPayload {
  project_id: number;
  project_name: string;
  project_color: string;
  currency: string | null;
  minutes: number;
  earned_amount: number | null;
}

export interface EarningsResponsePayload {
  billableMinutes: number;
  unbillableMinutes: number;
  timeOffMinutes: number;
  totalEarned: Record<string, number>;
  avgEffectiveHourlyRate: Record<string, number>;
  byProject: EarningsByProjectPayload[];
}

export interface HeatmapDatumPayload {
  date: string;
  minutes: number;
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
  status: 'open' | 'in_progress' | 'done';
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

export interface TaskGridEarningsRowPayload {
  currency: string;
  perDay: Record<number, number>;
  totalAmount: number;
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
  currency: string;
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
  currency: string;
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

export interface TaskInputPayload {
  epicId: number;
  number: string;
  title: string;
  description?: string | null;
  status?: 'open' | 'in_progress' | 'done';
  estimatedMinutes?: number | null;
}

export interface TaskViewPayload {
  id: number;
  epicId: number;
  number: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'done';
  estimatedMinutes: number | null;
  createdAt: string;
  totalMinutes: number;
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
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'removeInstance'; payload: { ok: true } }
  | { kind: 'reorderInstances'; payload: { ok: true } }
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{ id: string; cwd: string; status: string; lastActivityAt: number }>;
      };
    }
  | { kind: 'chooseDirectory'; payload: { path: string | null } }
  | { kind: 'getSetting'; payload: { value: string | null } }
  | { kind: 'setSetting'; payload: { ok: true } }
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
  | { kind: 'epics:create'; payload: { epic: EpicViewPayload } }
  | { kind: 'epics:update'; payload: { epic: EpicViewPayload } }
  | { kind: 'epics:reorder'; payload: { ok: true } }
  | { kind: 'epics:delete'; payload: { ok: true } }
  | { kind: 'tasks:listForEpic'; payload: { tasks: TaskViewPayload[] } }
  | { kind: 'tasks:listForProject'; payload: { tasks: TaskViewPayload[] } }
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
  | { kind: 'reports:rateChanges'; payload: { rateChanges: RateChangeMarkerPayload[] } };

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
  | { kind: 'badge'; payload: { count: number } }
  | { kind: 'activateInstance'; payload: { instanceId: string } }
  | { kind: 'triggerNewInstance'; payload: Record<string, never> }
  | {
      kind: 'orchestratorCrashed';
      payload: { code: number | null; restarting: boolean };
    };

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
