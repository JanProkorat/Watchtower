import { describe, it, expect } from 'vitest';
import { VNC_KEYSYMS } from '../../apps/ipad/src/lib/vncKeys.js';

describe('VNC_KEYSYMS', () => {
  it('maps esc/tab/ctrl/alt to X11 keysyms', () => {
    expect(VNC_KEYSYMS.esc).toBe(0xff1b);
    expect(VNC_KEYSYMS.tab).toBe(0xff09);
    expect(VNC_KEYSYMS.ctrl).toBe(0xffe3);
    expect(VNC_KEYSYMS.alt).toBe(0xffe9);
  });
});
