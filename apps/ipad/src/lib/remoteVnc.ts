import { registerPlugin } from '@capacitor/core';

export type VncState = 'connecting' | 'connected' | 'disconnected';

export interface RemoteVncPlugin {
  /** Present the native full-screen VNC view controller and connect to host:5900. */
  present(o: { host: string; username: string; password: string }): Promise<void>;
  /** Disconnect + dismiss the native VC if present. */
  disconnect(): Promise<void>;
  addListener(ev: 'state', cb: (d: { status: VncState }) => void): Promise<{ remove: () => void }>;
  addListener(ev: 'authFailed', cb: () => void): Promise<{ remove: () => void }>;
  addListener(ev: 'closed', cb: () => void): Promise<{ remove: () => void }>;
}

// Web (non-iOS) is a no-op: the native renderer only exists on device. The
// React module guards with Capacitor.getPlatform() before calling present().
export const RemoteVnc = registerPlugin<RemoteVncPlugin>('RemoteVnc', {
  web: () => ({
    async present() { /* no-op on web */ },
    async disconnect() { /* no-op on web */ },
    async addListener() { return { remove: () => { /* no-op */ } }; },
  }),
});
