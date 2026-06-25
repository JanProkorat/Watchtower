// X11 keysyms for the on-screen modifier strip (RFB sendKey expects keysyms).
export const VNC_KEYSYMS = {
  esc: 0xff1b,
  tab: 0xff09,
  ctrl: 0xffe3, // Control_L
  alt: 0xffe9,  // Alt_L
} as const;
