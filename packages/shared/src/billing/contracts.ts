/**
 * Contract burn / MD projection.
 *
 * Ported from orchestrator/db/contractStatus.ts (forRate method, lines ~62–143).
 * Math mirrors the orchestrator exactly so the iPad billing dashboard shows
 * the same numbers as the desktop ContractsTab.
 */

import { countWorkdays } from './workdays.js';
import type { ContractRow, DayOffRow, WorklogRow } from './types.js';

export interface ContractBurn {
  projectId: number;
  projectName: string;
  mdsUsed: number;
  mdLimit: number | null;
  mdsRemaining: number | null;
  projectedMds: number | null;
  workdaysRemaining: number | null;
  totalWorkdays: number | null;
  endDate: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return ymd(dt);
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Compute burn / projection for each *active* contract.
 * Active = `effectiveFrom <= today` AND (`endDate` null OR `endDate >= today`).
 * Mirrors orchestrator/db/contractStatus.ts:forRate (lines 62–143).
 *
 * @param contracts  One entry per project_rate row (all time windows).
 * @param rows       Denormalised worklog rows (incl. effectiveMinutes).
 * @param daysOff    User-marked days off — all kinds contribute to extraNonWorking.
 * @param opts       `{ today }` — YYYY-MM-DD string (injected for testability).
 */
export function contractBurn(
  contracts: ContractRow[],
  rows: WorklogRow[],
  daysOff: DayOffRow[],
  opts: { today: string },
): ContractBurn[] {
  const { today } = opts;

  // Build a lookup of projectName from worklog rows (best-effort — use first match).
  const projectNames = new Map<number, string>();
  for (const r of rows) {
    if (!projectNames.has(r.projectId)) {
      projectNames.set(r.projectId, r.projectName);
    }
  }

  // Pre-build the extra-non-working set from all daysOff (source lines 94–100).
  const extraNonWorking = new Set(daysOff.map((d) => d.date));

  const result: ContractBurn[] = [];

  for (const rate of contracts) {
    // Active filter (source lines 123–124):
    // isActive = today >= effectiveFrom && (endDate null || today <= endDate)
    const effectiveTo = rate.endDate ?? null;
    const isActive =
      today >= rate.effectiveFrom && (effectiveTo == null || today <= effectiveTo);
    if (!isActive) continue;

    // periodEnd: for elapsed we cap at today when open-ended (source line 64).
    const periodEnd = rate.endDate ?? today;

    // minutesLogged = sum effectiveMinutes for this project within [effectiveFrom, periodEnd]
    // (source lines 72–87 — the SQL is replaced by an in-memory filter here).
    let minutesLogged = 0;
    for (const r of rows) {
      if (
        r.projectId === rate.projectId &&
        r.workDate >= rate.effectiveFrom &&
        r.workDate <= periodEnd
      ) {
        minutesLogged += r.effectiveMinutes;
      }
    }

    // mdsUsed (source line 88)
    const mdsUsed = round2(minutesLogged / 60 / rate.hoursPerDay);

    // mdsRemaining (source line 89)
    const mdsRemaining = rate.mdLimit != null ? round2(rate.mdLimit - mdsUsed) : null;

    // elapsedWorkdays (source lines 102–106): countWorkdays(effectiveFrom, min(today, periodEnd))
    const elapsedWorkdays = countWorkdays(
      rate.effectiveFrom,
      minDate(today, periodEnd),
      extraNonWorking,
    );

    // totalWorkdays (source lines 107–109): null when open-ended
    const totalWorkdays = effectiveTo
      ? countWorkdays(rate.effectiveFrom, effectiveTo, extraNonWorking)
      : null;

    // workdaysRemaining (source lines 110–115):
    // endDate exists && today <= endDate → countWorkdays(tomorrow, endDate)
    // endDate exists && today > endDate → 0
    // no endDate → null
    const workdaysRemaining =
      effectiveTo && today <= effectiveTo
        ? countWorkdays(addDay(today), effectiveTo, extraNonWorking)
        : effectiveTo
          ? 0
          : null;

    // projectedMds (source lines 117–120): mirror projectedTotalMds
    const projectedMds =
      totalWorkdays != null && elapsedWorkdays > 0
        ? round2((mdsUsed / elapsedWorkdays) * totalWorkdays)
        : null;

    result.push({
      projectId: rate.projectId,
      projectName: projectNames.get(rate.projectId) ?? '',
      mdsUsed,
      mdLimit: rate.mdLimit,
      mdsRemaining,
      projectedMds,
      workdaysRemaining,
      totalWorkdays,
      endDate: rate.endDate,
    });
  }

  return result;
}
