// Denormalized worklog row as read from Supabase (worklog + derived billing
// fields + embedded project/task refs). Dates are 'YYYY-MM-DD' strings.
export interface WorklogRow {
  syncId: string;
  workDate: string;          // YYYY-MM-DD
  minutes: number;           // raw tracked minutes
  reportedMinutes: number | null; // billable-rounded override (null = use minutes)
  effectiveMinutes: number;  // derived: reported ?? minutes
  earnedAmount: number | null;
  description: string | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;       // 'work' | 'personal' | 'time_off' (...)
  isBillable: boolean;
  taskNumber: string | null;
  taskTitle: string | null;
  source: string | null;     // 'manual' | 'watchtower-auto' | 'jira-sync' | null
}

export interface TaskRow {
  taskId: number;
  syncId: string;
  epicId: number;
  taskNumber: string | null;
  taskTitle: string;
  status: string;
  estimatedMinutes: number | null;
  description: string | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;
  isBillable: boolean;
  /** Raw Jira status the task was last pulled with (null = not on a board). */
  jiraStatus: string | null;
}

export interface ContractRow {
  syncId: string;
  projectId: number;
  effectiveFrom: string;     // YYYY-MM-DD
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
  /** Shared-contract group id — null for a solo (non-pooled) contract. */
  contractGroupId: string | null;
}

export interface DayOffRow { date: string; kind: string; syncId: string }

export interface ProjectRow { id: number; name: string; color: string | null; kind: string; isBillable: boolean }

export interface EpicRow { epicId: number; name: string; projectId: number; status: string }

export interface ProjectEarning {
  projectId: number;
  name: string;
  color: string | null;
  minutes: number;
  earnedCzk: number;
}
