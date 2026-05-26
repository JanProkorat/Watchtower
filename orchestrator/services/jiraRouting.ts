import type { ProjectViewPayload } from '../../shared/ipcContract.js';

const SUMMARY_TAG = /^\s*\[([A-Z][A-Z0-9]*)\]/;
const EPIC_PREFIX = /^([A-Z][A-Z0-9]*)[-\s]/;

/**
 * Extract an area code (`TEH`, `VYR`, `KP`, `INFRA`, …) from a Jira
 * ticket. Same precedence as the `jira-fetch` skill — summary bracket
 * tag wins; falls back to the epic-summary prefix.
 */
export function detectAreaCode(
  summary: string,
  epicSummary: string | null,
): string | null {
  const m1 = SUMMARY_TAG.exec(summary);
  if (m1) return m1[1] ?? null;
  if (epicSummary) {
    const m2 = EPIC_PREFIX.exec(epicSummary);
    if (m2) return m2[1] ?? null;
  }
  return null;
}

/**
 * Match a Jira issue key against each active project's `jiraGlobs`,
 * returning the first project whose glob matches. Archived projects
 * are skipped. Globs use a tiny shell-style matcher (`*` only).
 */
export function pickProjectForKey(
  key: string,
  projects: ProjectViewPayload[],
): ProjectViewPayload | null {
  for (const p of projects) {
    if (p.archived) continue;
    for (const g of p.jiraGlobs) {
      if (matchesGlob(key, g)) return p;
    }
  }
  return null;
}

function matchesGlob(value: string, pattern: string): boolean {
  // Escape regex specials except `*`, then turn `*` into `.*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$').test(value);
}
