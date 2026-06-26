import { registerPlugin } from '@capacitor/core';

export interface WakePlugin {
  /** Fire one UDP datagram (the base64 magic packet) to host:port. */
  wake(options: { payloadBase64: string; host: string; port: number }): Promise<void>;
}

// Native impl is WakePlugin.swift (jsName 'Wake'). On web there is no UDP, so
// the stub is a no-op — keeps the browser/desktop build compiling.
export const Wake = registerPlugin<WakePlugin>('Wake', {
  web: () => ({ async wake() { /* no-op on web */ } }),
});
