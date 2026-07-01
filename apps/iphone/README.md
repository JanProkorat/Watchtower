# Watchtower iPhone — build & run runbook

TimeTracker-only iPhone app. **Data plane only** — it talks to Supabase (cloud)
for the billing/worklog data and has no live-plane (Mac orchestrator / VNC /
WebSocket) coupling. That means it works from anywhere with an internet
connection: **no home Wi-Fi, no Mac running, no Tailscale required** (the
Supabase URL is cloud; the anon key is injected at build time).

The app is source-aliased to the shared workspace packages
(`@watchtower/{shared,ui-core,data-supabase,module-timetracker}`) — the same
TimeTracker UI the iPad app uses, in an iPhone bottom-tab shell.

---

## 1. Supabase anon key (one-time, required)

The Vite build injects `VITE_SUPABASE_ANON_KEY` from a git-ignored `.env` file.
`.env*` files are never committed, so copy them from the iPad app:

```bash
cp apps/ipad/.env.development apps/iphone/.env.development
cp apps/ipad/.env.production  apps/iphone/.env.production
```

`build:dev` reads `.env.development`; `build` reads `.env.production`. The
Supabase URL itself is hardcoded in `packages/data-supabase/src/supabaseClient.ts`.

---

## 2. Build the web app and sync it into the native project

From `apps/iphone/`:

```bash
npm run build:dev            # or: npm run build  (production)
LANG=en_US.UTF-8 npx cap sync ios
```

> `LANG=en_US.UTF-8` is required for CocoaPods on macOS to avoid a Ruby UTF-8
> encoding error.

---

## 3. Run on a simulator or device (Xcode)

```bash
cd apps/iphone
LANG=en_US.UTF-8 npx cap open ios
```

Inside Xcode:

1. Select the **App** project → **Signing & Capabilities** → **Team** → your
   personal Apple ID team (free account is fine for simulator + on-device).
2. Verify **Bundle Identifier** is `cz.greencode.watchtower.iphone`.
3. Pick an **iPhone simulator** (or a plugged-in iPhone) in the device picker.
4. Click **Run** (▶).

Or run headless on a booted simulator from the CLI:

```bash
LANG=en_US.UTF-8 npx cap run ios --target "<simulator-udid>"
```

---

## 4. On the phone

1. Open **Watchtower**.
2. Sign in with your Supabase e-mail + password on the **Přihlášení** screen.
3. The bottom tab bar switches between **Přehled** (dashboard), **Výdělky**
   (earnings), **Reporty** (reports), and **Záznamy** (records — Seznam / Mřížka
   / Úkoly / Volno via the secondary sub-nav).
4. Data is cached offline (Capacitor Preferences) via `useBilling`, so the last
   load is available without a connection.

---

## Caveats

| Caveat | Detail |
|---|---|
| **7-day cert expiry** | Free personal-team certificates expire after 7 days. Re-open in Xcode and Run again to renew. |
| **Portrait only** | `Info.plist` locks the iPhone to portrait. |
| **No messaging** | Cross-device ping/reply (the "#76 receives/answers pings" clause) is deferred to a follow-up issue — it needs push infra (APNs, paid dev account, device tokens) and has no reusable module yet. |
