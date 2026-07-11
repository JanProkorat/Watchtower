import { describe, it, expect, vi } from 'vitest';
const upsert = vi.fn(async () => ({ error: null }));
vi.mock('@watchtower/data-supabase', () => ({ getSupabase: () => ({ from: () => ({ upsert }) }) }));
const listeners: Record<string, Function> = {};
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  requestPermissions: async () => ({ receive: 'granted' }),
  register: async () => { listeners['registration']?.({ value: 'tok-123' }); },
  addListener: (ev: string, cb: Function) => { listeners[ev] = cb; return { remove() {} }; },
} }), { virtual: true });
import { registerPush } from '../../apps/iphone/src/registerPush';

describe('registerPush', () => {
  it('writes the APNs token to pg push_devices', async () => {
    await registerPush();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ apns_token: 'tok-123', platform: 'ios' }), expect.anything());
  });
});
