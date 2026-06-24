// apps/ipad/src/lib/accessoryKeys.ts
export type AccessoryKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right';

const SEQ: Record<AccessoryKey, string> = {
  esc: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
};

export function accessoryKeyToSequence(key: AccessoryKey): string {
  return SEQ[key];
}

/** Single a–z/A–Z letter → its ASCII control byte (Ctrl-A = 0x01 … Ctrl-Z = 0x1a). */
export function ctrlChar(letter: string): string {
  if (letter.length !== 1) return '';
  const code = letter.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return '';
  return String.fromCharCode(code - 64);
}
