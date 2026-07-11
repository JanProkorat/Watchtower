import { PushNotifications } from '@capacitor/push-notifications';
import { getSupabase } from '@watchtower/data-supabase';

/**
 * Requests APNs push permission and, if granted, registers a `registration`
 * listener that upserts the device token into the pg-side `push_devices`
 * table so the Mac (B4) can read it. iPhone has no WS bridge, so this is
 * the only channel by which the Mac learns the device's token.
 */
export async function registerPush(): Promise<void> {
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  PushNotifications.addListener('registration', async (t: { value: string }) => {
    await getSupabase()
      .from('push_devices')
      .upsert(
        { apns_token: t.value, platform: 'ios' },
        { onConflict: 'apns_token', ignoreDuplicates: true },
      );
  });
  await PushNotifications.register();
}
