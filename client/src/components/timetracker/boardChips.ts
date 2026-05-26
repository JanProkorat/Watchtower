/**
 * Epic chip styling for the Jira Kanban board.
 *
 * Maps an epic name to a deterministic colour from a small curated palette
 * — same name always gets the same chip colour, so a user can recognise
 * "their" epics at a glance across syncs.
 */

export interface ChipColours {
  bg: string;
  fg: string;
}

// Eight slots, each with a foreground colour chosen for legibility against
// the background. Slot order is stable; do not reorder without invalidating
// the visual pairing every user has learned.
const PALETTE: ChipColours[] = [
  { bg: '#7c3aed', fg: '#ffffff' }, // violet
  { bg: '#d97706', fg: '#1f1300' }, // amber
  { bg: '#2563eb', fg: '#ffffff' }, // blue
  { bg: '#0ea5e9', fg: '#ffffff' }, // sky
  { bg: '#16a34a', fg: '#ffffff' }, // green
  { bg: '#ef4444', fg: '#ffffff' }, // red
  { bg: '#6366f1', fg: '#ffffff' }, // indigo
  { bg: '#ea580c', fg: '#1f1300' }, // orange
];

const FALLBACK: ChipColours = { bg: '#4b5563', fg: '#ffffff' };

function hashString(s: string): number {
  // FNV-1a-ish — small, fast, well-distributed enough for an 8-slot palette.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Colour pair for the given epic name; falls back to neutral grey on empty. */
export function epicColours(epicName: string | null | undefined): ChipColours {
  if (!epicName || epicName.length === 0) return FALLBACK;
  const idx = hashString(epicName) % PALETTE.length;
  return PALETTE[idx]!;
}
