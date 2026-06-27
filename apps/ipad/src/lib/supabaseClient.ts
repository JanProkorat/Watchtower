import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xggihnrvsmbzbkhsnuky.supabase.co';

// Public anon key — safe to commit per Supabase docs (Row Level Security enforces data access).
// Paste the value from: Supabase Dashboard → Settings → API → "anon / public".
// Do NOT use the service_role key here.
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZ2lobnJ2c21iemJraHNudWt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNzY3NTQsImV4cCI6MjA5Nzk1Mjc1NH0.BedrVS2_ntMiBUKSFqz1T50qQE51Ioo2E2-iR1WUC4U';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
