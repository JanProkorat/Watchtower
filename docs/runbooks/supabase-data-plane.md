# Supabase data plane — owner setup + smoke check (iPad billing #1)

The orchestrator syncs TimeTracker data to Supabase and pre-computes billing
fields onto worklog rows. RLS is applied automatically by the orchestrator's
Postgres migrations. Your only manual step is creating the login user; then a
curl smoke check confirms auth + RLS + the derived fields end-to-end.

## 1. Create the auth user (once)

Supabase dashboard → Authentication → Users → **Add user** → your email + a
password. (This is the login the iPad will use in sub-project 2.)

## 2. Confirm the derived fields synced

Open the orchestrator with `WATCHTOWER_PG_URL` set (it already is, in
`.env.development`). On boot it applies the billing-column + RLS migrations and
re-pushes worklogs once (backfill). Give it one sync cycle (~60s) or trigger a
TimeTracker edit.

## 3. Smoke check (auth + RLS + earned_amount), no app needed

Replace `<ANON>` and `<EMAIL>`/`<PASSWORD>`:

    # a) anon must be denied (RLS): expect [] or an RLS error, never rows
    curl -s "https://xggihnrvsmbzbkhsnuky.supabase.co/rest/v1/worklogs?select=earned_amount&limit=1" \
      -H "apikey: <ANON>"

    # b) log in → get an access token
    TOKEN=$(curl -s "https://xggihnrvsmbzbkhsnuky.supabase.co/auth/v1/token?grant_type=password" \
      -H "apikey: <ANON>" -H "Content-Type: application/json" \
      -d '{"email":"<EMAIL>","password":"<PASSWORD>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

    # c) authenticated read → expect rows with earned_amount populated
    curl -s "https://xggihnrvsmbzbkhsnuky.supabase.co/rest/v1/worklogs?select=work_date,effective_minutes,earned_amount,rate_currency&limit=5" \
      -H "apikey: <ANON>" -H "Authorization: Bearer $TOKEN"

Success: (a) returns no rows; (c) returns worklogs with non-null `earned_amount`
for entries that have a contract.

## Notes

- The orchestrator's sync role bypasses RLS (it owns the tables) — enabling RLS
  does not affect the Mac-side sync.
- Write access from the client (logging time on the iPad) is **not** enabled
  yet — that's sub-project 3 (adds INSERT/UPDATE policies + an offline outbox).
