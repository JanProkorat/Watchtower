// Wake-on-LAN magic-packet construction. Pure (no I/O) so it is unit-testable;
// the bytes are handed to the native Wake plugin as base64.

export interface ParsedMac {
  bytes: number[]; // exactly 6 octets, 0–255
}

/** Parse "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF" (case-insensitive). */
export function parseMac(input: string): ParsedMac | null {
  const parts = input.trim().split(/[:-]/);
  if (parts.length !== 6) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-fA-F]{2}$/.test(p)) return null;
    bytes.push(parseInt(p, 16));
  }
  return { bytes };
}

/** 102-byte magic packet: 6x 0xFF, then the 6-byte MAC repeated 16 times. */
export function buildMagicPacket(mac: ParsedMac): Uint8Array {
  const pkt = new Uint8Array(102);
  pkt.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) pkt.set(mac.bytes, 6 + i * 6);
  return pkt;
}

/** Base64 of the magic packet, for the Capacitor bridge (binary can't cross). */
export function magicPacketBase64(mac: ParsedMac): string {
  const pkt = buildMagicPacket(mac);
  let bin = '';
  for (const b of pkt) bin += String.fromCharCode(b);
  return btoa(bin);
}
