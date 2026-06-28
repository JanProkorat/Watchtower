import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabaseClient.js';

// ---------------------------------------------------------------------------
// Pure helper — maps a Supabase auth error to a Czech user-facing message.
// Exported so it can be unit-tested without a DOM / renderer.
// ---------------------------------------------------------------------------

type AuthErrorLike = { message?: string; code?: string } | null | undefined;

export function authErrorMessage(err: AuthErrorLike): string {
  if (!err) return 'Přihlášení se nezdařilo. Zkuste to znovu.';
  const msg = (err.message ?? '').toLowerCase();
  const code = (err.code ?? '').toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Nesprávný e-mail nebo heslo.';
  }
  if (msg.includes('not confirmed') || msg.includes('email not confirmed')) {
    return 'E-mail není potvrzený.';
  }
  return 'Přihlášení se nezdařilo. Zkuste to znovu.';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type AuthStatus = 'loading' | 'in' | 'out';

export interface SupabaseAuthState {
  session: Session | null;
  status: AuthStatus;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
}

export function useSupabaseAuth(): SupabaseAuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    const supabase = getSupabase();
    // Resolve existing session on mount.
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session ?? null;
      setSession(s);
      setStatus(s ? 'in' : 'out');
    }).catch(() => setStatus('out'));

    // Subscribe to auth state changes (sign-in, sign-out, token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      setStatus(s ? 'in' : 'out');
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) return { error: authErrorMessage(error) };
    return {};
  };

  const signOut = async (): Promise<void> => {
    await getSupabase().auth.signOut();
  };

  return { session, status, signIn, signOut };
}
