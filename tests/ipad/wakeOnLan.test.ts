import { describe, it, expect } from 'vitest';
import { parseMac, buildMagicPacket, magicPacketBase64 } from '../../apps/ipad/src/lib/wakeOnLan.js';

describe('parseMac', () => {
  it('parses colon-separated, case-insensitive', () => {
    expect(parseMac('AA:bb:CC:dd:EE:ff')?.bytes).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });
  it('parses hyphen-separated', () => {
    expect(parseMac('00-11-22-33-44-55')?.bytes).toEqual([0, 0x11, 0x22, 0x33, 0x44, 0x55]);
  });
  it('trims surrounding whitespace', () => {
    expect(parseMac('  aa:bb:cc:dd:ee:ff  ')?.bytes).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });
  it('rejects wrong octet count', () => {
    expect(parseMac('aa:bb:cc:dd:ee')).toBeNull();
    expect(parseMac('aa:bb:cc:dd:ee:ff:00')).toBeNull();
  });
  it('rejects non-hex and malformed octets', () => {
    expect(parseMac('zz:bb:cc:dd:ee:ff')).toBeNull();
    expect(parseMac('a:bb:cc:dd:ee:ff')).toBeNull();   // single digit
    expect(parseMac('')).toBeNull();
  });
});

describe('buildMagicPacket', () => {
  it('is 102 bytes: 6x 0xFF then the MAC 16x', () => {
    const mac = parseMac('01:02:03:04:05:06')!;
    const pkt = buildMagicPacket(mac);
    expect(pkt.length).toBe(102);
    expect([...pkt.slice(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect([...pkt.slice(6, 12)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...pkt.slice(96, 102)]).toEqual([1, 2, 3, 4, 5, 6]); // 16th repeat
  });
});

describe('magicPacketBase64', () => {
  it('round-trips back to the 102-byte packet', () => {
    const mac = parseMac('01:02:03:04:05:06')!;
    const b64 = magicPacketBase64(mac);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect([...bytes]).toEqual([...buildMagicPacket(mac)]);
  });
});
