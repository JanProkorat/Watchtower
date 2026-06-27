// Denormalized worklog row as read from Supabase (worklog + derived billing
// fields + embedded project/task refs). Dates are 'YYYY-MM-DD' strings.
export interface WorklogRow {
  syncId: string;
  workDate: string;          // YYYY-MM-DD
  minutes: number;           // raw tracked minutes
  effectiveMinutes: number;  // derived: reported ?? minutes
  earnedAmount: number | null;
  rateCurrency: string | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;       // 'work' | 'personal' | 'time_off' (...)
  isBillable: boolean;
  taskNumber: string | null;
  taskTitle: string | null;
}

export interface ContractRow {
  projectId: number;
  effectiveFrom: string;     // YYYY-MM-DD
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  currency: string;
  hoursPerDay: number;
  mdLimit: number | null;
}

export interface DayOffRow { date: string; kind: string }
