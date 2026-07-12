# iPad Billing No-Login-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iPad billing/dashboard pages always render (cached or empty), with a "not connected" bar and a centered login dialog, instead of hiding everything behind a login screen.

**Architecture:** Extract the reusable `LoginForm` out of `BillingLogin`, add a `NotConnectedBar` and a `LoginDialog`, and rework `BillingArea` to remove the auth gate — always render content, show the bar when signed out, and remount the content subtree on auth-identity change so `useBilling` refetches. The cache layer and write-gating are already session-agnostic, so no data-layer changes.

**Tech Stack:** React (TSX, inline styles), `@watchtower/data-supabase` (`useSupabaseAuth`, `useBilling`), `@watchtower/ui-core` (`statusGlass`, `glassPanel`, `ctaGradient`, `text`), Vitest + `@testing-library/react` (jsdom).

## Global Constraints

- **Scope: iPad only.** Do NOT touch `apps/iphone/*`. `BillingLogin` must keep working unchanged for the Capacitor iPhone (which still uses the full-app gate).
- **No data-layer changes.** Do NOT edit `packages/data-supabase/src/useBilling.ts`, `billingWrites.ts`, or `useSupabaseAuth.ts`.
- **New user-facing strings are English:** bar text `Not signed in — showing cached data`, bar/button `Sign in`. Existing Czech strings inside the login form (`Přihlášení`, `E-mail`, `Heslo`, `Přihlásit`, `Přihlašuji…`) are left as-is (not translated).
- **No i18n framework.** Plain string literals.
- **Test conventions:** vitest files start with `// @vitest-environment jsdom`; use `@testing-library/react` (`render`, `screen`, `fireEvent`, `waitFor`); assert with `screen.getByText(...)`/`getByRole(...)` + `.toBeTruthy()`/`.toBeNull()`. **Do NOT use jest-dom matchers** (`toBeInTheDocument`, `toHaveTextContent`) — they are not configured.
- **Full suite must stay green** (currently 1163 passing): `npm test`.
- **Typecheck:** `npx tsc -p apps/ipad/tsconfig.json --noEmit` and the shared package build must stay clean.

---

### Task 1: Extract `LoginForm`; make `BillingLogin` reuse it

Pulls the form (heading + inputs + error + submit) out of `BillingLogin` into a layout-agnostic `LoginForm` that both the full-screen `BillingLogin` (iPhone) and the new `LoginDialog` (Task 3) render. Adds an `onSuccess` callback so a host can react to a successful sign-in. Also fixes the stray purple heading colour `#c4b8ff` → ocean `#bae6fd`.

**Files:**
- Create: `packages/module-timetracker/src/billing/LoginForm.tsx`
- Modify: `packages/module-timetracker/src/billing/BillingLogin.tsx`
- Test: `tests/module-timetracker/loginForm.test.tsx`

**Interfaces:**
- Consumes: `SupabaseAuthState['signIn']` from `@watchtower/data-supabase` — `signIn(email: string, password: string) => Promise<{ error?: string }>`.
- Produces: `LoginForm({ signIn, onSuccess }: { signIn: SupabaseAuthState['signIn']; onSuccess?: () => void }): JSX.Element`. Calls `onSuccess()` only when `signIn` resolves with no `error`.

- [ ] **Step 1: Write the failing test**

Create `tests/module-timetracker/loginForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from '../../packages/module-timetracker/src/billing/LoginForm';

describe('LoginForm', () => {
  it('calls signIn with the entered credentials and fires onSuccess on success', async () => {
    const signIn = vi.fn(async () => ({}));
    const onSuccess = vi.fn();
    render(<LoginForm signIn={signIn} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'a@b.cz' } });
    fireEvent.change(screen.getByPlaceholderText('Heslo'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Přihlásit'));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.cz', 'pw'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows the error and does not fire onSuccess on failure', async () => {
    const signIn = vi.fn(async () => ({ error: 'Špatné heslo' }));
    const onSuccess = vi.fn();
    render(<LoginForm signIn={signIn} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText('Přihlásit'));
    await waitFor(() => expect(screen.getByText('Špatné heslo')).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/module-timetracker/loginForm.test.tsx`
Expected: FAIL — cannot resolve `LoginForm` (module does not exist yet).

- [ ] **Step 3: Create `LoginForm.tsx`**

```tsx
import { useState } from 'react';
import type { SupabaseAuthState } from '@watchtower/data-supabase';
import { ctaGradient, ctaGlow, text } from '@watchtower/ui-core';

interface Props {
  signIn: SupabaseAuthState['signIn'];
  /** Called after a sign-in that resolved with no error (host closes dialog etc.). */
  onSuccess?: () => void;
}

/**
 * The Supabase email/password form — heading, inputs, error box, submit. Layout-
 * agnostic (a plain column): the host supplies the card/centering/scrim. Used by
 * the full-screen `BillingLogin` (iPhone) and the `LoginDialog` (iPad).
 */
export function LoginForm({ signIn, onSuccess }: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await signIn(email, password);
      if (result.error) setError(result.error);
      else onSuccess?.();
    } catch {
      setError('Přihlášení se nezdařilo. Zkuste to znovu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#bae6fd', fontFamily: 'system-ui, sans-serif' }}>
        Přihlášení
      </h2>

      <input
        type="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={inputStyle}
        autoCapitalize="none"
        autoCorrect="off"
      />

      <input
        type="password"
        placeholder="Heslo"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={inputStyle}
      />

      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(110,24,24,0.32)',
            border: '1px solid rgba(248,113,113,0.40)',
            color: '#fca5a5',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={() => void handleSubmit()}
        disabled={busy}
        style={{
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: busy ? 'rgba(56,189,248,0.35)' : ctaGradient,
          boxShadow: busy ? 'none' : ctaGlow,
          color: busy ? text.muted : '#fff',
          fontSize: 15,
          fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {busy ? 'Přihlašuji…' : 'Přihlásit'}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.07)',
  color: '#e5e7eb',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
  outline: 'none',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/module-timetracker/loginForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor `BillingLogin.tsx` to wrap `LoginForm`**

Replace the entire file contents with:

```tsx
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
```

- [ ] **Step 6: Verify BillingLogin still typechecks and the suite is green**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no errors.
Run: `npx vitest run tests/module-timetracker/loginForm.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/module-timetracker/src/billing/LoginForm.tsx packages/module-timetracker/src/billing/BillingLogin.tsx tests/module-timetracker/loginForm.test.tsx
git commit -m "refactor(billing): extract reusable LoginForm from BillingLogin

Layout-agnostic form (heading/inputs/error/submit) with an onSuccess hook.
BillingLogin (iPhone full-screen gate) now wraps it; behavior unchanged.
Fix stray purple heading #c4b8ff -> ocean #bae6fd.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `NotConnectedBar`

A thin "not signed in" bar styled with `statusGlass('disconnected')`, with a Sign-in button.

**Files:**
- Create: `packages/module-timetracker/src/billing/NotConnectedBar.tsx`
- Test: `tests/module-timetracker/notConnectedBar.test.tsx`

**Interfaces:**
- Consumes: `statusGlass` + `text` from `@watchtower/ui-core`. `statusGlass('disconnected')` returns `{ panel: CSSProperties; accent: string; dot: CSSProperties }`.
- Produces: `NotConnectedBar({ onSignIn }: { onSignIn: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `tests/module-timetracker/notConnectedBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotConnectedBar } from '../../packages/module-timetracker/src/billing/NotConnectedBar';

describe('NotConnectedBar', () => {
  it('renders the not-connected message', () => {
    render(<NotConnectedBar onSignIn={() => {}} />);
    expect(screen.getByText(/showing cached data/i)).toBeTruthy();
  });

  it('fires onSignIn when the button is clicked', () => {
    const onSignIn = vi.fn();
    render(<NotConnectedBar onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/module-timetracker/notConnectedBar.test.tsx`
Expected: FAIL — cannot resolve `NotConnectedBar`.

- [ ] **Step 3: Create `NotConnectedBar.tsx`**

```tsx
import { statusGlass, text } from '@watchtower/ui-core';

interface Props {
  onSignIn: () => void;
}

/**
 * Thin banner shown at the top of the Supabase-backed pages when signed out.
 * Communicates that data is cached/read-only and offers a way to sign in.
 */
export function NotConnectedBar({ onSignIn }: Props): JSX.Element {
  const s = statusGlass('disconnected');
  return (
    <div
      style={{
        ...s.panel,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        margin: '8px 12px 0',
        borderRadius: 12,
        flexShrink: 0,
      }}
    >
      <span style={s.dot} />
      <span style={{ flex: 1, fontSize: 13, color: text.secondary, fontFamily: 'system-ui, sans-serif' }}>
        Not signed in — showing cached data
      </span>
      <button
        onClick={onSignIn}
        style={{
          padding: '5px 12px',
          borderRadius: 9,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.10)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Sign in
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/module-timetracker/notConnectedBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/module-timetracker/src/billing/NotConnectedBar.tsx tests/module-timetracker/notConnectedBar.test.tsx
git commit -m "feat(billing): NotConnectedBar (signed-out banner + sign-in button)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `LoginDialog`

A centered modal (scrim + glass card) wrapping `LoginForm`. Closes on backdrop tap and on successful sign-in.

**Files:**
- Create: `packages/module-timetracker/src/billing/LoginDialog.tsx`
- Test: `tests/module-timetracker/loginDialog.test.tsx`

**Interfaces:**
- Consumes: `LoginForm` (Task 1); `glassPanel`, `glassFillStrong` from `@watchtower/ui-core`; `SupabaseAuthState['signIn']`.
- Produces: `LoginDialog({ open, onClose, signIn }: { open: boolean; onClose: () => void; signIn: SupabaseAuthState['signIn'] }): JSX.Element | null`. Returns `null` when `!open`. Backdrop has `data-testid="login-dialog-backdrop"`.

- [ ] **Step 1: Write the failing test**

Create `tests/module-timetracker/loginDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginDialog } from '../../packages/module-timetracker/src/billing/LoginDialog';

const signIn = vi.fn(async () => ({}));

describe('LoginDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<LoginDialog open={false} onClose={() => {}} signIn={signIn} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the form when open', () => {
    render(<LoginDialog open onClose={() => {}} signIn={signIn} />);
    expect(screen.getByText('Přihlášení')).toBeTruthy();
  });

  it('closes on backdrop tap', () => {
    const onClose = vi.fn();
    render(<LoginDialog open onClose={onClose} signIn={signIn} />);
    fireEvent.click(screen.getByTestId('login-dialog-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes after a successful sign-in', async () => {
    const onClose = vi.fn();
    render(<LoginDialog open onClose={onClose} signIn={vi.fn(async () => ({}))} />);
    fireEvent.click(screen.getByText('Přihlásit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/module-timetracker/loginDialog.test.tsx`
Expected: FAIL — cannot resolve `LoginDialog`.

- [ ] **Step 3: Create `LoginDialog.tsx`**

```tsx
import type { CSSProperties } from 'react';
import type { SupabaseAuthState } from '@watchtower/data-supabase';
import { glassPanel, glassFillStrong } from '@watchtower/ui-core';
import { LoginForm } from './LoginForm.js';

interface Props {
  open: boolean;
  onClose: () => void;
  signIn: SupabaseAuthState['signIn'];
}

/** Centered modal login. Backdrop tap or a successful sign-in closes it. */
export function LoginDialog({ open, onClose, signIn }: Props): JSX.Element | null {
  if (!open) return null;
  return (
    <div data-testid="login-dialog-backdrop" onClick={onClose} style={scrimStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320,
          ...glassPanel({ radius: 22, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 }),
          padding: 28,
        }}
      >
        <LoginForm signIn={signIn} onSuccess={onClose} />
      </div>
    </div>
  );
}

const scrimStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/module-timetracker/loginDialog.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/module-timetracker/src/billing/LoginDialog.tsx tests/module-timetracker/loginDialog.test.tsx
git commit -m "feat(billing): LoginDialog (centered modal wrapping LoginForm)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rework `BillingArea` — remove the gate, always render

Removes the `loading` spinner and the `status === 'out'` login gate. Content always renders. When signed out, the `NotConnectedBar` shows above it and its button opens the `LoginDialog`. The content subtree is keyed by session identity so it remounts on login/logout, re-running each view's `useBilling` fetch.

**Files:**
- Modify: `packages/module-timetracker/src/billing/BillingArea.tsx`
- Test: `tests/module-timetracker/billingArea.test.tsx`

**Interfaces:**
- Consumes: `useSupabaseAuth()` → `{ status, signIn, session }` (`session` is `Session | null`; `session.user.id` is the identity); `NotConnectedBar` (Task 2); `LoginDialog` (Task 3).
- Produces: unchanged public `BillingArea({ module, section, boardActions })` — same props, now gate-free.

- [ ] **Step 1: Write the failing test**

Create `tests/module-timetracker/billingArea.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable auth state the mocked hook reads (vi.mock is hoisted).
const h = vi.hoisted(() => ({
  status: 'out' as 'out' | 'in' | 'loading',
  session: null as null | { user: { id: string } },
}));

vi.mock('@watchtower/data-supabase', () => ({
  useSupabaseAuth: () => ({
    status: h.status,
    session: h.session,
    signIn: vi.fn(async () => ({})),
    signOut: vi.fn(async () => {}),
  }),
  useBilling: () => ({ data: null, state: 'offline', refresh: vi.fn(async () => {}) }),
}));

// The only section rendered for module="dashboard"; stub it to a marker.
vi.mock('../../packages/module-timetracker/src/billing/DashboardView.js', () => ({
  DashboardView: () => <div>DASHBOARD_CONTENT</div>,
}));

import { BillingArea } from '../../packages/module-timetracker/src/billing/BillingArea';

beforeEach(() => {
  h.status = 'out';
  h.session = null;
});

describe('BillingArea', () => {
  it('renders content (not a login screen) when signed out', () => {
    render(<BillingArea module="dashboard" section="earnings" />);
    expect(screen.getByText('DASHBOARD_CONTENT')).toBeTruthy();
  });

  it('shows the not-connected bar when signed out', () => {
    render(<BillingArea module="dashboard" section="earnings" />);
    expect(screen.getByText(/showing cached data/i)).toBeTruthy();
  });

  it('hides the bar when signed in', () => {
    h.status = 'in';
    h.session = { user: { id: 'u1' } };
    render(<BillingArea module="dashboard" section="earnings" />);
    expect(screen.queryByText(/showing cached data/i)).toBeNull();
    expect(screen.getByText('DASHBOARD_CONTENT')).toBeTruthy();
  });

  it('opens the login dialog from the bar button', () => {
    render(<BillingArea module="dashboard" section="earnings" />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText('Přihlášení')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/module-timetracker/billingArea.test.tsx`
Expected: FAIL — the signed-out render still returns `<BillingLogin>` (no `DASHBOARD_CONTENT`, no bar).

- [ ] **Step 3: Rework `BillingArea.tsx`**

Change the imports at the top of the file — remove the `text` and `BillingLogin` imports, add `NotConnectedBar` and `LoginDialog`:

```tsx
import { useEffect, useState } from 'react';
import { useSupabaseAuth } from '@watchtower/data-supabase';
import type { BillingSection } from './types.js';
import { NotConnectedBar } from './NotConnectedBar.js';
import { LoginDialog } from './LoginDialog.js';
import { BoardView, type BoardActions } from './BoardView.js';
import { DashboardView } from './DashboardView.js';
import { EarningsMonthView } from './EarningsMonthView.js';
import { ProjectDetailView } from './ProjectDetailView.js';
import { ReportsView } from './ReportsView.js';
import { WorklogListView } from './records/WorklogListView.js';
import { TaskGridView } from './records/TaskGridView.js';
import { TaskListView } from './records/TaskListView.js';
import { TimeOffView } from './records/TimeOffView.js';
```

Replace the component body (from `export function BillingArea` to its closing brace) with:

```tsx
export function BillingArea({ module, section, boardActions }: Props): JSX.Element {
  const { status, signIn, session } = useSupabaseAuth();
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  // Month the caller was viewing when drilling in, so the detail opens on it
  // (not on today). Undefined → detail defaults to the current month.
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);
  const [loginOpen, setLoginOpen] = useState(false);

  // Drill-down resets whenever the rail navigates to a different module/section.
  useEffect(() => { setSelectedProject(null); }, [module, section]);

  const openProject = (id: number, month?: string) => { setSelectedProject(id); setSelectedMonth(month); };

  // No auth gate: content always renders. useBilling drives its own loading and
  // returns cached/empty data with or without a session, and write-gating keys
  // off data freshness — so signed-out is automatically read-only.
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'transparent' }}>
      {status === 'out' && <NotConnectedBar onSignIn={() => setLoginOpen(true)} />}

      {/* Keyed by session identity: signing in/out remounts the active view so
          useBilling refetches (fresh when authed, cached/offline otherwise). */}
      <div
        key={session?.user?.id ?? 'anon'}
        style={{ flex: 1, overflow: module === 'dashboard' || section === 'records-grid' || section === 'board' ? 'hidden' : 'auto', minHeight: 0 }}
      >
        {selectedProject !== null ? (
          <ProjectDetailView projectId={selectedProject} initialMonth={selectedMonth} onBack={() => setSelectedProject(null)} />
        ) : module === 'dashboard' ? (
          <DashboardView />
        ) : section === 'earnings' ? (
          <EarningsMonthView onOpenProject={openProject} />
        ) : section === 'reports' ? (
          <ReportsView onOpenProject={openProject} />
        ) : section === 'records-list' ? (
          <WorklogListView />
        ) : section === 'records-grid' ? (
          <TaskGridView />
        ) : section === 'records-tasks' ? (
          <TaskListView />
        ) : section === 'board' ? (
          <BoardView actions={boardActions} />
        ) : (
          <TimeOffView />
        )}
      </div>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} signIn={signIn} />
    </div>
  );
}
```

(The `Props` interface and the file's header comment above `export function BillingArea` stay as they are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/module-timetracker/billingArea.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no errors. (If `text` or `BillingLogin` is reported unused, confirm both imports were removed in Step 3.)

- [ ] **Step 6: Commit**

```bash
git add packages/module-timetracker/src/billing/BillingArea.tsx tests/module-timetracker/billingArea.test.tsx
git commit -m "feat(billing): iPad renders without login gate; not-connected bar + dialog

BillingArea no longer gates on auth: content always renders (cached/empty),
a NotConnectedBar + LoginDialog appear when signed out, and the content
subtree is keyed by session identity so useBilling refetches on login/logout.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification + device deploy

Non-TDD verification task: full suite, typecheck, and a real-device smoke of the new flow (signed-out renders + login dialog).

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green. (Bootstrap tests may fail with `EADDRINUSE` if a Watchtower instance is running — that is environmental; re-run those two with `WATCHTOWER_WS_HOST=127.0.0.1 WATCHTOWER_WS_PORT=7466 npx vitest run tests/orchestrator/bootstrap.test.ts tests/orchestrator/bootstrap.wsBridge.test.ts` to confirm they pass on a free port.)

- [ ] **Step 2: Typecheck the workspace gate**

Run: `npm run typecheck:ci`
Expected: clean.

- [ ] **Step 3: Build + deploy to the iPad**

```bash
cd apps/ipad
npm run build:dev
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap copy ios
DEV=CD61F9E9-765A-5CF3-B688-2914CD16E2BB   # iPad Pro 11-inch (M4); re-check via `xcrun devicectl list devices`
DDD=<scratchpad>/ipad-dd-device
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination "id=$DEV" -derivedDataPath "$DDD" -allowProvisioningUpdates build
xcrun devicectl device install app --device "$DEV" "$DDD/Build/Products/Debug-iphoneos/App.app"
xcrun devicectl device process launch --device "$DEV" cz.watchtower.ipad
```

- [ ] **Step 4: Manual smoke on device**

Confirm, while signed out: the Přehled/Fakturace pages render (cached data or empty) instead of a login screen; the "Not signed in — showing cached data" bar shows with a Sign in button; tapping it opens the centered login dialog; signing in dismisses the bar and the data refreshes. (User performs this; agent cannot screenshot a physical device.)

---

## Self-Review

**Spec coverage:**
- "Always render (cached/empty)" → Task 4 (gate removed) ✓
- Session-independent cache/write-safety unchanged → Global Constraints + no data-layer tasks ✓
- `LoginForm` extraction, `BillingLogin` reuse → Task 1 ✓
- `LoginDialog` centered modal → Task 3 ✓
- `NotConnectedBar` via `statusGlass('disconnected')` → Task 2 ✓
- Remount-on-login refetch → Task 4 (`key={session?.user?.id ?? 'anon'}`) ✓
- English new strings / existing Czech left as-is → Global Constraints, Tasks 2 & 1 ✓
- iPhone untouched → Global Constraints; `BillingLogin` kept working (Task 1) ✓
- Tests for each component → Tasks 1–4 ✓

**Placeholder scan:** none — all steps carry full code/commands.

**Type consistency:** `signIn: SupabaseAuthState['signIn']` used uniformly (Tasks 1, 3, 4). `LoginForm` props `{ signIn, onSuccess? }` match consumption in `BillingLogin` (no onSuccess) and `LoginDialog` (`onSuccess={onClose}`). `NotConnectedBar` `{ onSignIn }`, `LoginDialog` `{ open, onClose, signIn }`, `BillingArea` reads `{ status, signIn, session }` — all consistent across tasks.
