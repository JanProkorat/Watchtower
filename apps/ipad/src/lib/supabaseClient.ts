import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xggihnrvsmbzbkhsnuky.supabase.co';

// Public anon key, injected at build time from VITE_SUPABASE_ANON_KEY (set in a
// git-ignored apps/ipad/.env or the build environment) — kept out of git so
// secret-scanners don't flag the JWT. The anon key is safe to ship to the client:
// RLS (PR #106) denies `anon` and only grants `authenticated` SELECT, so the key
// alone reads nothing without a login. Get the value from Supabase Dashboard →
// Settings → API → "anon / public". Never use the service_role key here.
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
