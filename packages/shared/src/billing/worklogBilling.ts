// Per-worklog billing, mirroring orchestrator/db/reportsSql.ts SUM_EARNED.
// Pure (no I/O) so it is unit-testable; used by the sync push (Mac) and the
// iPad write path to compute the Postgres-only derived columns. Keep in
// lockstep with reportsSql's hourly/daily formula and LEAD-based rate window.

export interface ContractLite {
  effectiveFrom: string;          // 'YYYY-MM-DD'
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
}

export interface WorklogBilling {
  effectiveMinutes: number;
  resolvedRate: number | null;
  earnedAmount: number | null;
}

/**
 * Resolve the contract whose window contains `workDate`: the latest contract
 * with `effectiveFrom <= workDate`. Returns null when no contract starts on or
 * before the date.
 */
function resolveContract(workDate: string, contracts: ContractLite[]): ContractLite | null {
  let best: ContractLite | null = null;
  for (const c of contracts) {
    if (c.effectiveFrom <= workDate && (best === null || c.effectiveFrom > best.effectiveFrom)) {
      best = c;
    }
  }
  return best;
}

export function computeWorklogBilling(input: {
  minutes: number;
  reportedMinutes: number | null;
  workDate: string;
  contracts: ContractLite[];
}): WorklogBilling {
  const effectiveMinutes = input.reportedMinutes ?? input.minutes;
  const c = resolveContract(input.workDate, input.contracts);
  if (!c) {
    return { effectiveMinutes, resolvedRate: null, earnedAmount: null };
  }
  const earnedAmount =
    c.rateType === 'hourly'
      ? (effectiveMinutes * c.rateAmount) / 60
      : (effectiveMinutes / 60 / c.hoursPerDay) * c.rateAmount;
  return { effectiveMinutes, resolvedRate: c.rateAmount, earnedAmount };
}
