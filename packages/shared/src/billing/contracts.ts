/**
 * Contract burn / MD projection.
 *
 * Ported from orchestrator/db/contractStatus.ts (forRate method, lines ~62–143).
 * Math mirrors the orchestrator exactly so the iPad billing dashboard shows
 * the same numbers as the desktop ContractsTab.
 */

import { countWorkdays } from './workdays.js';
import type { ContractRow, DayOffRow, ProjectRow, WorklogRow } from './types.js';

export interface ContractBurn {
  projectId: number;
  projectName: string;
  projectColor: string | null;
  mdsUsed: number;
  mdLimit: number | null;
  mdsRemaining: number | null;
  projectedMds: number | null;
  workdaysRemaining: number | null;
  totalWorkdays: number | null;
  endDate: string | null;
  /**
   * Shared-contract group id — null for a solo (non-pooled) contract.
   * A pooled group returns one ContractBurn PER member project, all
   * carrying the same pooled mdsUsed/mdLimit — consumers that render a
   * card per entry (e.g. the iPad dashboard) must dedupe on this field,
   * mirroring orchestrator/db/dashboardOverview.ts's seenGroups pattern.
   */
  contractGroupId: string | null;
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
 * @param projects   Full project list — used to resolve projectName/projectColor.
 * @param opts       `{ today }` — YYYY-MM-DD string (injected for testability).
 */
export function contractBurn(
  contracts: ContractRow[],
  rows: WorklogRow[],
  daysOff: DayOffRow[],
  projects: ProjectRow[],
  opts: { today: string },
): ContractBurn[] {
  const { today } = opts;

  // Build a lookup of project metadata from the projects list.
  const projectMap = new Map<number, ProjectRow>();
  for (const p of projects) {
    projectMap.set(p.id, p);
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

    // A shared contract's md_limit is one budget pooled across every project
    // linked to the group — sum worklogs across all member ids, not just this
    // rate's own project. Solo contracts (no group) fall back to the single
    // project id (mirrors orchestrator/db/contractStatus.ts:forRate lines 67–73).
    const memberIds = rate.contractGroupId
      ? contracts.filter((c) => c.contractGroupId === rate.contractGroupId).map((c) => c.projectId)
      : [rate.projectId];

    // minutesLogged = sum effectiveMinutes across member projects within [effectiveFrom, periodEnd]
    // (source lines 72–87 — the SQL is replaced by an in-memory filter here).
    let minutesLogged = 0;
    for (const r of rows) {
      if (
        memberIds.includes(r.projectId) &&
        r.workDate >= rate.effectiveFrom &&
        r.workDate <= periodEnd &&
        r.projectKind === 'work'
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

    const proj = projectMap.get(rate.projectId);
    result.push({
      projectId: rate.projectId,
      projectName: proj?.name ?? '',
      projectColor: proj?.color ?? null,
      mdsUsed,
      mdLimit: rate.mdLimit,
      mdsRemaining,
      projectedMds,
      workdaysRemaining,
      totalWorkdays,
      endDate: rate.endDate,
      contractGroupId: rate.contractGroupId,
    });
  }

  return result;
}
