# iPad billing: render without a login gate

**Date:** 2026-07-12
**Scope:** iPad app only (`apps/ipad` + shared `packages/module-timetracker`).
The Capacitor iPhone app keeps its current full-app login gate.

## Problem

On iPad, the Supabase-backed pages (Dashboard + the Fakturace/Billing
sections) are hidden behind a login screen whenever the user is signed out.
`BillingArea.tsx` early-returns `<BillingLogin>` when `status === 'out'`, so no
data — not even locally cached data — is visible until the user logs in.

We want the pages to **always render**: show cached local data when present,
empty state when there is no cache, and surface a "not connected" bar with a
Sign-in button that opens a login dialog. Logging in is optional and
non-blocking.

## Why this is a small change

The data and auth layers are already separable:

- **`useBilling` (cache layer) is session-independent.** It loads from the
  Capacitor Preferences cache and runs its fetch unconditionally. With no
  session the PostgREST fetch is denied by RLS and the reducer falls back to
  `state: 'cached'` (cache present) or `state: 'offline', data: null` (no
  cache). It never requires a session and never crashes.
  (`packages/data-supabase/src/useBilling.ts`)
- **Writes are already gated on freshness, not login.**
  `canEdit(state) => state === 'fresh'` (`billingWrites.ts`). Offline/cached
  data is therefore read-only automatically — the "always render" change needs
  **no** write-safety work.
- **The login form already takes only `signIn` as a prop**
  (`BillingLogin.tsx`), so it lifts cleanly into a dialog.
- **`useBilling` holds per-hook `useState`** (no shared store); each section
  view fetches on its own mount. Remounting the active view on login is a clean
  refresh trigger.

The gate is a single early-return branch. This rework deletes it, adds a bar +
dialog, and remounts the content subtree when auth flips.

## Design

### Components

1. **`LoginForm`** (new, `packages/module-timetracker/src/billing/LoginForm.tsx`)
   Extracted from the inner card of `BillingLogin.tsx`: the email/password
   inputs, `busy`/`error` state, and the `handleSubmit` that calls
   `signIn(email, password)` and surfaces `result.error`. Presentational and
   layout-agnostic (no full-screen centering, no fixed outer card chrome — the
   host decides that).
   - Props: `signIn: SupabaseAuthState['signIn']`, `onSuccess?: () => void`.
   - On a submit with no `error`, calls `onSuccess?.()`.

2. **`BillingLogin`** (modified, still the full-screen login used by the
   Capacitor iPhone) — keeps its centered full-screen card chrome but renders
   `<LoginForm signIn={signIn} />` inside instead of its own inline inputs.
   **No behavior change for iPhone.**

3. **`LoginDialog`** (new,
   `packages/module-timetracker/src/billing/LoginDialog.tsx`)
   A centered modal: a glass card (`glassCard`/`glassFillStrong`) over a dimmed
   full-screen scrim, rendering `<LoginForm>`.
   - Props: `open: boolean`, `onClose: () => void`, `signIn`.
   - Renders `null` when `!open`.
   - Closes on backdrop tap and on successful sign-in (`onSuccess` → `onClose`).
   - Title: "Sign in to Supabase".

4. **`NotConnectedBar`** (new,
   `packages/module-timetracker/src/billing/NotConnectedBar.tsx`)
   A thin horizontal bar styled with `statusGlass('disconnected')` (red accent
   + glowing dot from `@watchtower/ui-core`). Text: "Not signed in — showing
   cached data". A right-aligned "Sign in" button.
   - Props: `onSignIn: () => void`.
   - Sits above the scrollable section content (does not scroll away).

### `BillingArea.tsx` rework

Current gate (to remove):

```tsx
if (status === 'loading') return (<div…>Načítání…</div>);
if (status === 'out') return <BillingLogin signIn={signIn} />;
// …section content…
```

New shape:

```tsx
const { status, signIn, session } = useSupabaseAuth();
const [loginOpen, setLoginOpen] = useState(false);

// No auth gate. Content always renders; useBilling drives its own loading.
return (
  <div className="billing-area-root">
    {status === 'out' && <NotConnectedBar onSignIn={() => setLoginOpen(true)} />}
    {/* Remount on auth identity change so useBilling refetches fresh on login
        (and drops back to cached/offline on logout). */}
    <div key={session?.user?.id ?? 'anon'} className="billing-area-content">
      {/* existing section switch: DashboardView / EarningsMonthView / … */}
    </div>
    <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} signIn={signIn} />
  </div>
);
```

- The auth `'loading'` full-screen spinner is dropped. During `'loading'` the
  bar is simply not shown (avoids a "not connected" flash before the session
  resolves); the section's own `useBilling` loading/cache handles the body.
- `status === 'out'` → bar visible. `status === 'in'` (or `'loading'`) → no bar.

### Data flow

```
useSupabaseAuth() ──> status, signIn, session
   status 'out'  ──> NotConnectedBar ──(Sign in)──> setLoginOpen(true)
                       LoginDialog ──> LoginForm ──> signIn(email,password)
                          │ success
                          ▼
   onAuthStateChange ──> status 'in', session.user.id changes
                          │
                          ▼
   content key changes ──> section view remounts ──> useBilling mount effect
                          ──> cache hit + fresh fetch (authed) ──> state 'fresh'
                          ──> canEdit true (writes enabled), bar hidden
```

Logout is symmetric: session → null, key → `'anon'`, content remounts, fetch is
RLS-denied → `'cached'`/`'offline'`, bar reappears, writes disabled.

## Error handling

- Login errors surface inside the dialog via the existing
  `authErrorMessage` → `error` box in `LoginForm` (`role="alert"`).
- No session + no cache → empty section views (already handled defensively by
  every view: spinner only when `state === 'loading' && data == null`).
- The bar communicates the not-connected state; nothing blocks interaction.

## Copy / locale

New user-facing strings are **English**, per the project convention (new
strings are English; existing Czech billing strings are left as-is):

- Bar: "Not signed in — showing cached data"
- Bar button / dialog submit: "Sign in"
- Dialog title: "Sign in to Supabase"

(Open point for spec review: the surrounding billing UI still contains Czech
strings — confirm English is wanted here rather than matching Czech.)

## Files

**Create**
- `packages/module-timetracker/src/billing/LoginForm.tsx`
- `packages/module-timetracker/src/billing/LoginDialog.tsx`
- `packages/module-timetracker/src/billing/NotConnectedBar.tsx`

**Modify**
- `packages/module-timetracker/src/billing/BillingLogin.tsx` (reuse `LoginForm`)
- `packages/module-timetracker/src/billing/BillingArea.tsx` (remove gate, add
  bar + dialog + remount key)
- No `packages/module-timetracker/src/index.ts` change: the three new
  components are consumed only by `BillingArea` (and `BillingLogin`) within the
  same package via relative imports. `BillingArea` remains the sole iPad-facing
  entry point, so no new public export is required.

**Unchanged (verified session-agnostic)**
- `packages/data-supabase/src/useBilling.ts`
- `packages/data-supabase/src/billingWrites.ts`
- `packages/data-supabase/src/useSupabaseAuth.ts`
- `apps/iphone/*` (Capacitor iPhone gate stays)

## Testing

Vitest (jsdom / React Testing Library, matching existing module tests):

- **`NotConnectedBar`**: renders text + Sign-in button; clicking calls
  `onSignIn`.
- **`LoginDialog`**: hidden when `open=false`; visible when `open=true`;
  backdrop tap calls `onClose`; a successful `signIn` (mock resolving with no
  error) calls `onClose`; a failing `signIn` keeps it open and shows the error.
- **`LoginForm`**: submit calls `signIn` with entered email/password; error
  from `signIn` renders in the alert box; `onSuccess` fires only on no-error.
- **`BillingArea`** (integration, mocked `useSupabaseAuth` + `useBilling`):
  with `status='out'` the bar renders AND section content renders (not the
  login screen); with `status='in'` no bar; toggling `session.user.id`
  remounts content (assert the child re-runs its mount effect / a fresh fetch
  is requested).

Full suite must stay green (currently 1163 passing).

## Out of scope

- iPhone (Capacitor) auth gate — untouched.
- Any change to write-safety, cache format, or the sync engine.
- Translating existing Czech billing strings.
