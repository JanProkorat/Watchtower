import type { SupabaseAuthState } from '@watchtower/data-supabase';
import { glassPanel, glassFillStrong } from '@watchtower/ui-core';
import { LoginForm } from './LoginForm.js';

interface Props {
  signIn: SupabaseAuthState['signIn'];
}

/** Full-screen centered login card. Used by the Capacitor iPhone app's gate. */
export function BillingLogin({ signIn }: Props): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
      }}
    >
      <div
        style={{
          width: 320,
          ...glassPanel({ radius: 22, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 }),
          padding: 28,
        }}
      >
        <LoginForm signIn={signIn} />
      </div>
    </div>
  );
}
