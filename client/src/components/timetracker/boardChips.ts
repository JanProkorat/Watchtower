/**
 * Area-code chip styling for the Jira Kanban board.
 *
 * Curated palette per known Skoda Green Code project area code, derived
 * from the prototype's `chip-*` classes. Unknown codes fall back to a
 * neutral grey so a new area shows up clearly without breaking layout.
 */

export interface ChipColours {
  bg: string;
  fg: string;
}

const PALETTE: Record<string, ChipColours> = {
  TEH:      { bg: '#7c3aed', fg: '#ffffff' },
  VYR:      { bg: '#d97706', fg: '#1f1300' },
  KP:       { bg: '#2563eb', fg: '#ffffff' },
  INFRA:    { bg: '#0ea5e9', fg: '#ffffff' },
  LOG:      { bg: '#16a34a', fg: '#ffffff' },
  KONTROLA: { bg: '#ef4444', fg: '#ffffff' },
  STR:      { bg: '#6366f1', fg: '#ffffff' },
};

const FALLBACK: ChipColours = { bg: '#4b5563', fg: '#ffffff' };

export function areaCodeColours(areaCode: string | null): ChipColours {
  if (!areaCode) return FALLBACK;
  return PALETTE[areaCode] ?? FALLBACK;
}

/**
 * Strip the area-code prefix off a component label.
 * `"TEH-Technologický postup"` → `"TEH"`.
 */
export function areaCodeFromComponent(component: string | null): string | null {
  if (!component) return null;
  const m = /^([A-Z][A-Z0-9]*)/.exec(component);
  return m?.[1] ?? null;
}
