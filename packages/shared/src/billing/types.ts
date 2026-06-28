// Denormalized worklog row as read from Supabase (worklog + derived billing
// fields + embedded project/task refs). Dates are 'YYYY-MM-DD' strings.
export interface WorklogRow {
  syncId: string;
  workDate: string;          // YYYY-MM-DD
  minutes: number;           // raw tracked minutes
  effectiveMinutes: number;  // derived: reported ?? minutes
  earnedAmount: number | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;       // 'work' | 'personal' | 'time_off' (...)
  isBillable: boolean;
  taskNumber: string | null;
  taskTitle: string | null;
  source: string | null;     // 'manual' | 'watchtower-auto' | 'jira-sync' | null
}

export interface ContractRow {
  projectId: number;
  effectiveFrom: string;     // YYYY-MM-DD
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
}

export interface DayOffRow { date: string; kind: string; syncId: string }

export interface ProjectRow { id: number; name: string; color: string | null }

export interface ProjectEarning {
  projectId: number;
  name: string;
  color: string | null;
  minutes: number;
  earnedCzk: number;
}
