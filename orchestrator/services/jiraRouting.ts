import type { ProjectViewPayload } from '../../shared/ipcContract.js';

const SUMMARY_TAG = /^\s*\[([A-Z][A-Z0-9]*)\]/;
const EPIC_PREFIX = /^([A-Z][A-Z0-9]*)[-\s]/;
/**
 * Delimiters that separate the "shortcut" from the rest of an epic
 * summary: ASCII hyphen-minus, en-dash, em-dash, colon, or forward slash.
 * Surrounding whitespace is consumed. The slash also covers the
 * "FOO/something" style used in a few Skoda epic names.
 */
const EPIC_SHORTCUT_SPLIT = /\s*[-–—:/]\s*/;

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

/**
 * Pull the categorical "shortcut" out of a Jira epic's summary (or, when
 * the summary lookup failed, its key). The shortcut is whatever sits
 * before the first delimiter — works for both UPPERCASE codes ("TEH",
 * "VYR", "KP", "KK", "SZ") and area-name styles ("Infrastruktura"):
 *
 *   "TEH - Technologický postup"        → "TEH"
 *   "VYR — Výroba"                      → "VYR"
 *   "Infrastruktura"                    → "Infrastruktura"
 *   "KP/Capacity Planning"              → "KP"
 *   "TEH-456" (epic key as fallback)    → "TEH"
 *
 * Returns null for empty / whitespace-only input so callers can fall
 * back to the task's own `[AREA]` summary tag and finally to "Other".
 */
export function extractEpicShortcut(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const first = trimmed.split(EPIC_SHORTCUT_SPLIT)[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}

function matchesGlob(value: string, pattern: string): boolean {
  // Escape regex specials except `*`, then turn `*` into `.*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$').test(value);
}
