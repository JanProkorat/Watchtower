const INSTANCE_PALETTE = [
  '#7aa7ff',
  '#f0a868',
  '#66bb6a',
  '#ce93d8',
  '#4dd0e1',
  '#ffd54f',
  '#a1887f',
  '#90caf9',
  '#ef9a9a',
  '#80cbc4',
];

export function paletteColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return INSTANCE_PALETTE[Math.abs(hash) % INSTANCE_PALETTE.length] ?? '#7aa7ff';
}

/** Resolved accent for a tab: project color when set, hash-based fallback otherwise. */
export function tabAccent(tabId: string, color: string | null | undefined): string {
  return color ?? paletteColor(tabId);
}
