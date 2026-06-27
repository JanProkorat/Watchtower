// Pure helpers for ProjectDetailView — rate-window assignment and earnings rollup.
// No DOM, no React, no side-effects — safe to unit-test directly.

import type { ContractRow, WorklogRow } from '@watchtower/shared/billing/types.js';

// ---------------------------------------------------------------------------
// assignWorklogToContract
//
// Given a worklog's workDate and a list of contracts for that project,
// returns the contract whose window covers workDate.
//
// Assignment rule: the contract is the one with the latest effectiveFrom that
// is still <= workDate. If no contract qualifies, returns null.
// ---------------------------------------------------------------------------

export function assignWorklogToContract(
  workDate: string,
  contracts: ContractRow[],
): ContractRow | null {
  // Only include contracts whose effectiveFrom <= workDate.
  const eligible = contracts.filter((c) => c.effectiveFrom <= workDate);
  if (eligible.length === 0) return null;
  // Among eligible, pick the one with the latest effectiveFrom.
  eligible.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return eligible[0] ?? null;
}

// ---------------------------------------------------------------------------
// rateLabel — formats a contract's rate as a Czech string.
// e.g. hourly 1500 CZK → "1 500 Kč/h"
//      daily  8000 CZK → "8 000 Kč/MD"
// ---------------------------------------------------------------------------

// Narrow NBSP used in formatCzk — replicate without importing czFormat so
// this module has zero DOM dependencies.
const NBSP = ' ';

function formatAmount(amount: number): string {
  const formatted = new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(amount);
  return `${formatted}${NBSP}Kč`;
}

export function rateLabel(contract: ContractRow): string {
  const amount = formatAmount(contract.rateAmount);
  const unit = contract.rateType === 'hourly' ? '/h' : '/MD';
  return `${amount}${unit}`;
}

// ---------------------------------------------------------------------------
// ContractPeriodEarnings — one entry per contract in the project's history,
// with summed CZK earned by worklogs assigned to that contract window.
// ---------------------------------------------------------------------------

export interface ContractPeriodEarnings {
  contract: ContractRow;
  earnedCzk: number;
}

export function rollupEarningsByContract(
  worklogs: WorklogRow[], // already filtered to the project
  contracts: ContractRow[],
): ContractPeriodEarnings[] {
  // Sort contracts by effectiveFrom desc (most recent first — for display).
  const sorted = [...contracts].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? 1 : -1,
  );

  return sorted.map((contract) => {
    // Sum CZK earnedAmount from worklogs assigned to this contract.
    let earnedCzk = 0;
    for (const wl of worklogs) {
      if (wl.rateCurrency !== 'CZK') continue;
      if (wl.earnedAmount == null) continue;
      const assigned = assignWorklogToContract(wl.workDate, contracts);
      if (assigned === contract) {
        earnedCzk += wl.earnedAmount;
      }
    }
    return { contract, earnedCzk };
  });
}

// ---------------------------------------------------------------------------
// activeContract — the contract whose window contains today.
// ---------------------------------------------------------------------------

export function activeContract(contracts: ContractRow[], today: string): ContractRow | null {
  return assignWorklogToContract(today, contracts);
}
