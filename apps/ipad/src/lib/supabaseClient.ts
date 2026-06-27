import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xggihnrvsmbzbkhsnuky.supabase.co';

// Public anon key — safe to commit per Supabase docs (Row Level Security enforces data access).
// Paste the value from: Supabase Dashboard → Settings → API → "anon / public".
// Do NOT use the service_role key here.
const SUPABASE_ANON_KEY = 'REPLACE_WITH_PUBLIC_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
