import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xggihnrvsmbzbkhsnuky.supabase.co';

// Public anon key, injected at build time from VITE_SUPABASE_ANON_KEY (set in a
// git-ignored apps/ipad/.env or the build environment) — kept out of git so
// secret-scanners don't flag the JWT. The anon key is safe to ship to the client:
// RLS (PR #106) denies `anon` and only grants `authenticated` SELECT, so the key
// alone reads nothing without a login. Get the value from Supabase Dashboard →
// Settings → API → "anon / public". Never use the service_role key here.
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

let _client: SupabaseClient | null = null;

/**
 * Lazily construct the shared Supabase client.
 *
 * Constructed on first use rather than at import: @supabase/supabase-js throws
 * `supabaseKey is required` when the anon key is empty, and the key is only
 * present in a real (build-time-injected) environment. Building the client
 * eagerly at import therefore crashed every module that merely *imports* this
 * file under test (where no VITE_ env is loaded). Deferring to first use lets
 * tests import freely while still surfacing a misconfigured build the moment a
 * query actually runs.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY is not set — the iPad build is missing its Supabase anon key.',
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}
