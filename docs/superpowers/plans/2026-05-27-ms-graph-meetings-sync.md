# MS Graph Meetings Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the claude-subprocess / chat-prerequisite flow with native Microsoft Graph OAuth + REST calls so the dashboard "Sync meetings" button is genuinely one-click.

**Architecture:** Hand-rolled OAuth 2.0 device-code flow inside the orchestrator (no msal-node), tokens cached in macOS Keychain via the existing `security` CLI pattern, Graph `/me/calendarView` fetched with pagination. Auth lives in a new Settings → Microsoft 365 section; the existing dashboard popover just calls `meetings:sync`.

**Tech Stack:** TypeScript (orchestrator strict mode), Node `fetch`, `child_process.spawnSync` for `security`, vitest for tests, React + MUI v5 in the renderer.

**Spec:** `docs/superpowers/specs/2026-05-27-ms-graph-meetings-sync-design.md`.

---

## Task 1: msGraphAuth — config + keychain I/O

**Files:**
- Create: `orchestrator/services/msGraphAuth.ts`
- Test: `tests/orchestrator/msGraphAuth.test.ts`

- [ ] **Step 1: Write failing test for `loadConfig` + Keychain round-trip**

```ts
// tests/orchestrator/msGraphAuth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadConfig,
  MsGraphAuthService,
  type MsGraphAuthDeps,
  type CachedTokens,
} from '../../orchestrator/services/msGraphAuth.js';

function makeDeps(over: Partial<MsGraphAuthDeps> = {}): MsGraphAuthDeps {
  return {
    fetch: vi.fn() as unknown as typeof fetch,
    readSecret: vi.fn(() => null),
    writeSecret: vi.fn(),
    deleteSecret: vi.fn(),
    now: () => 1_700_000_000_000,
    sleep: () => Promise.resolve(),
    ...over,
  };
}

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.MS_GRAPH_CLIENT_ID;
    delete process.env.MS_GRAPH_TENANT_ID;
    delete process.env.MS_GRAPH_KEYCHAIN_SERVICE;
    delete process.env.MS_GRAPH_KEYCHAIN_ACCOUNT;
  });
  it('returns configured=false when MS_GRAPH_CLIENT_ID is missing', () => {
    const cfg = loadConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.clientId).toBe('');
  });
  it('defaults tenant to "common" and keychain names', () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const cfg = loadConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.clientId).toBe('abc');
    expect(cfg.tenantId).toBe('common');
    expect(cfg.keychainService).toBe('watchtower-ms-graph');
    expect(cfg.keychainAccount).toBe('default');
  });
});

describe('MsGraphAuthService keychain I/O', () => {
  it('round-trips tokens through readSecret/writeSecret', () => {
    let stored: string | null = null;
    const deps = makeDeps({
      readSecret: () => stored,
      writeSecret: (_s, _a, v) => {
        stored = v;
      },
    });
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const svc = new MsGraphAuthService(deps);
    const tokens: CachedTokens = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1_700_000_999_000,
      account: 'u@x.cz',
    };
    svc.saveTokens(tokens);
    expect(svc.loadTokens()).toEqual(tokens);
  });

  it('loadTokens returns null when nothing stored', () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const svc = new MsGraphAuthService(makeDeps());
    expect(svc.loadTokens()).toBeNull();
  });

  it('loadTokens returns null for malformed payload', () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const svc = new MsGraphAuthService(makeDeps({ readSecret: () => 'not-json' }));
    expect(svc.loadTokens()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts`
Expected: FAIL with "Cannot find module '.../msGraphAuth.js'".

- [ ] **Step 3: Implement the skeleton**

```ts
// orchestrator/services/msGraphAuth.ts
import { spawnSync } from 'node:child_process';

export interface MsGraphConfig {
  clientId: string;
  tenantId: string;
  keychainService: string;
  keychainAccount: string;
  configured: boolean;
}

export interface CachedTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which the access token is considered expired. */
  expiresAt: number;
  /** UPN/email of the signed-in user, captured from /me at sign-in time. */
  account: string;
}

export interface MsGraphAuthDeps {
  fetch: typeof fetch;
  readSecret(service: string, account: string): string | null;
  writeSecret(service: string, account: string, value: string): void;
  deleteSecret(service: string, account: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class NotAuthenticatedError extends Error {
  constructor(message = 'Not signed in to Microsoft 365.') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export function loadConfig(): MsGraphConfig {
  const clientId = process.env.MS_GRAPH_CLIENT_ID ?? '';
  return {
    clientId,
    tenantId: process.env.MS_GRAPH_TENANT_ID || 'common',
    keychainService: process.env.MS_GRAPH_KEYCHAIN_SERVICE || 'watchtower-ms-graph',
    keychainAccount: process.env.MS_GRAPH_KEYCHAIN_ACCOUNT || 'default',
    configured: Boolean(clientId),
  };
}

export const defaultDeps: MsGraphAuthDeps = {
  fetch: globalThis.fetch.bind(globalThis),
  readSecret(service, account) {
    const r = spawnSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
      encoding: 'utf8',
    });
    if (r.status !== 0) return null;
    const v = r.stdout.trim();
    return v ? v : null;
  },
  writeSecret(service, account, value) {
    const r = spawnSync(
      'security',
      ['add-generic-password', '-U', '-s', service, '-a', account, '-w', value],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`Keychain write failed: ${r.stderr}`);
  },
  deleteSecret(service, account) {
    spawnSync('security', ['delete-generic-password', '-s', service, '-a', account], {
      encoding: 'utf8',
    });
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class MsGraphAuthService {
  constructor(private deps: MsGraphAuthDeps = defaultDeps) {}

  config(): MsGraphConfig {
    return loadConfig();
  }

  loadTokens(): CachedTokens | null {
    const cfg = this.config();
    const raw = this.deps.readSecret(cfg.keychainService, cfg.keychainAccount);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CachedTokens>;
      if (
        typeof parsed.accessToken === 'string' &&
        typeof parsed.refreshToken === 'string' &&
        typeof parsed.expiresAt === 'number' &&
        typeof parsed.account === 'string'
      ) {
        return parsed as CachedTokens;
      }
      return null;
    } catch {
      return null;
    }
  }

  saveTokens(tokens: CachedTokens): void {
    const cfg = this.config();
    this.deps.writeSecret(cfg.keychainService, cfg.keychainAccount, JSON.stringify(tokens));
  }

  clearTokens(): void {
    const cfg = this.config();
    this.deps.deleteSecret(cfg.keychainService, cfg.keychainAccount);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/msGraphAuth.ts tests/orchestrator/msGraphAuth.test.ts
git commit -m "feat(meetings): add MS Graph auth config + keychain I/O"
```

---

## Task 2: msGraphAuth — startDeviceCode

**Files:**
- Modify: `orchestrator/services/msGraphAuth.ts`
- Test: `tests/orchestrator/msGraphAuth.test.ts`

- [ ] **Step 1: Add failing test**

```ts
// append to tests/orchestrator/msGraphAuth.test.ts
describe('startDeviceCode', () => {
  it('POSTs client_id + scope to /devicecode and returns the response shape', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user_code: 'ABCD-EFGH',
        device_code: 'devc',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
      }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({ fetch: fetchMock as unknown as typeof fetch }));
    const r = await svc.startDeviceCode();
    expect(r).toEqual({
      userCode: 'ABCD-EFGH',
      deviceCode: 'devc',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      interval: 5,
    });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode');
    const body = (call[1] as RequestInit).body as URLSearchParams;
    expect(body.get('client_id')).toBe('abc');
    expect(body.get('scope')).toBe('offline_access Calendars.Read');
  });

  it('throws when config is not set', async () => {
    delete process.env.MS_GRAPH_CLIENT_ID;
    const svc = new MsGraphAuthService(makeDeps());
    await expect(svc.startDeviceCode()).rejects.toThrow(/MS_GRAPH_CLIENT_ID/);
  });

  it('throws on non-2xx', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_client"}',
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({ fetch: fetchMock as unknown as typeof fetch }));
    await expect(svc.startDeviceCode()).rejects.toThrow(/invalid_client/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts -t 'startDeviceCode'`
Expected: FAIL with "svc.startDeviceCode is not a function".

- [ ] **Step 3: Implement**

Add to `MsGraphAuthService`:

```ts
export interface DeviceCodeResponse {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

// ... inside MsGraphAuthService class
async startDeviceCode(): Promise<DeviceCodeResponse> {
  const cfg = this.config();
  if (!cfg.configured) {
    throw new Error('MS_GRAPH_CLIENT_ID is not set. See README for setup.');
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    scope: 'offline_access Calendars.Read',
  });
  const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/devicecode`;
  const r = await this.deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Device code request failed (${r.status}): ${text}`);
  }
  const j = (await r.json()) as {
    user_code: string;
    device_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return {
    userCode: j.user_code,
    deviceCode: j.device_code,
    verificationUri: j.verification_uri,
    expiresIn: j.expires_in,
    interval: j.interval,
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts`
Expected: PASS, all tests including 3 new.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/msGraphAuth.ts tests/orchestrator/msGraphAuth.test.ts
git commit -m "feat(meetings): implement MS Graph device-code start"
```

---

## Task 3: msGraphAuth — pollForTokens

**Files:**
- Modify: `orchestrator/services/msGraphAuth.ts`
- Test: `tests/orchestrator/msGraphAuth.test.ts`

- [ ] **Step 1: Add failing tests for all poll branches**

```ts
// append to tests/orchestrator/msGraphAuth.test.ts
describe('pollForTokens', () => {
  const codeOpts = { deviceCode: 'devc', interval: 1, expiresIn: 900 };

  it('returns success and saves tokens after authorization_pending → success', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let calls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      calls++;
      if (typeof url === 'string' && url.endsWith('/v1.0/me')) {
        return { ok: true, status: 200, json: async () => ({ userPrincipalName: 'u@x.cz' }) } as unknown as Response;
      }
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'authorization_pending' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      } as unknown as Response;
    });
    let stored: string | null = null;
    const svc = new MsGraphAuthService(
      makeDeps({
        fetch: fetchMock as unknown as typeof fetch,
        readSecret: () => stored,
        writeSecret: (_s, _a, v) => {
          stored = v;
        },
      }),
    );
    const r = await svc.pollForTokens(codeOpts);
    expect(r.status).toBe('success');
    expect(r.account).toBe('u@x.cz');
    expect(svc.loadTokens()?.accessToken).toBe('AT');
  });

  it('doubles interval on slow_down', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let calls = 0;
    const sleeps: number[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls++;
      if (typeof url === 'string' && url.endsWith('/v1.0/me')) {
        return { ok: true, status: 200, json: async () => ({ userPrincipalName: 'u@x.cz' }) } as unknown as Response;
      }
      if (calls === 1) {
        return { ok: false, status: 400, json: async () => ({ error: 'slow_down' }) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, token_type: 'Bearer' }),
      } as unknown as Response;
    });
    const svc = new MsGraphAuthService(
      makeDeps({
        fetch: fetchMock as unknown as typeof fetch,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      }),
    );
    await svc.pollForTokens(codeOpts);
    expect(sleeps[0]).toBe(1000); // initial interval 1s
    expect(sleeps[1]).toBe(2000); // doubled
  });

  it('returns { status: "expired" } on expired_token', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'expired_token' }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({ fetch: fetchMock as unknown as typeof fetch }));
    const r = await svc.pollForTokens(codeOpts);
    expect(r.status).toBe('expired');
  });

  it('returns { status: "error" } on access_denied with the message', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'access_denied', error_description: 'user said no' }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({ fetch: fetchMock as unknown as typeof fetch }));
    const r = await svc.pollForTokens(codeOpts);
    expect(r.status).toBe('error');
    expect(r.error).toContain('user said no');
  });

  it('aborts when AbortController is signalled', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'authorization_pending' }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({ fetch: fetchMock as unknown as typeof fetch }));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5);
    const r = await svc.pollForTokens({ ...codeOpts, signal: ac.signal });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/cancel|abort/i);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts -t pollForTokens`
Expected: FAIL with "svc.pollForTokens is not a function".

- [ ] **Step 3: Implement**

Add to `MsGraphAuthService`:

```ts
export type PollResult =
  | { status: 'success'; account: string }
  | { status: 'expired' }
  | { status: 'error'; error: string };

export interface PollOptions {
  deviceCode: string;
  interval: number;
  expiresIn: number;
  signal?: AbortSignal;
}

// inside MsGraphAuthService
async pollForTokens(opts: PollOptions): Promise<PollResult> {
  const cfg = this.config();
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const start = this.deps.now();
  const expiresMs = opts.expiresIn * 1000;
  let intervalMs = opts.interval * 1000;

  while (true) {
    if (opts.signal?.aborted) {
      return { status: 'error', error: 'Sign-in cancelled' };
    }
    if (this.deps.now() - start > expiresMs) {
      return { status: 'expired' };
    }
    await this.deps.sleep(intervalMs);
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: opts.deviceCode,
    });
    const r = await this.deps.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = (await r.json()) as {
      error?: string;
      error_description?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!r.ok) {
      const err = j.error;
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') {
        intervalMs *= 2;
        continue;
      }
      if (err === 'expired_token') return { status: 'expired' };
      return { status: 'error', error: j.error_description || err || 'Unknown error' };
    }
    // Success — fetch /me and store.
    const account = await this.fetchAccount(j.access_token!);
    const tokens: CachedTokens = {
      accessToken: j.access_token!,
      refreshToken: j.refresh_token!,
      expiresAt: this.deps.now() + (j.expires_in ?? 3600) * 1000,
      account,
    };
    this.saveTokens(tokens);
    return { status: 'success', account };
  }
}

private async fetchAccount(accessToken: string): Promise<string> {
  const r = await this.deps.fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return 'unknown';
  const j = (await r.json()) as { userPrincipalName?: string; mail?: string };
  return j.userPrincipalName || j.mail || 'unknown';
}
```

- [ ] **Step 4: Run, verify passes**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/msGraphAuth.ts tests/orchestrator/msGraphAuth.test.ts
git commit -m "feat(meetings): poll device-code endpoint for tokens"
```

---

## Task 4: msGraphAuth — refresh + getValidAccessToken + signOut

**Files:**
- Modify: `orchestrator/services/msGraphAuth.ts`
- Test: `tests/orchestrator/msGraphAuth.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/orchestrator/msGraphAuth.test.ts
describe('getValidAccessToken', () => {
  const future = 2_000_000_000_000;
  const past = 1_500_000_000_000;
  const now = 1_700_000_000_000;

  it('returns cached token when not expired', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const tokens: CachedTokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: future, account: 'u@x.cz' };
    const svc = new MsGraphAuthService(makeDeps({
      readSecret: () => JSON.stringify(tokens),
      now: () => now,
    }));
    expect(await svc.getValidAccessToken()).toBe('AT');
  });

  it('refreshes when expired and saves new tokens', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let stored = JSON.stringify({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: past, account: 'u@x.cz' });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600 }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({
      fetch: fetchMock as unknown as typeof fetch,
      readSecret: () => stored,
      writeSecret: (_s, _a, v) => { stored = v; },
      now: () => now,
    }));
    expect(await svc.getValidAccessToken()).toBe('NEW');
    expect(JSON.parse(stored).refreshToken).toBe('RT2');
  });

  it('throws NotAuthenticatedError when no tokens are cached', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const svc = new MsGraphAuthService(makeDeps());
    await expect(svc.getValidAccessToken()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('throws NotAuthenticatedError when refresh fails and clears tokens', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let stored: string | null = JSON.stringify({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: past, account: 'u@x.cz' });
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => '{"error":"invalid_grant"}',
    } as unknown as Response));
    const svc = new MsGraphAuthService(makeDeps({
      fetch: fetchMock as unknown as typeof fetch,
      readSecret: () => stored,
      writeSecret: (_s, _a, v) => { stored = v; },
      deleteSecret: () => { stored = null; },
      now: () => now,
    }));
    await expect(svc.getValidAccessToken()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(stored).toBeNull();
  });
});

describe('signOut', () => {
  it('clears cached tokens', () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let stored: string | null = JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 0, account: 'u@x.cz' });
    const svc = new MsGraphAuthService(makeDeps({
      readSecret: () => stored,
      deleteSecret: () => { stored = null; },
    }));
    svc.signOut();
    expect(stored).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts -t 'getValidAccessToken|signOut'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `MsGraphAuthService`:

```ts
async refreshTokens(refreshToken: string): Promise<CachedTokens> {
  const cfg = this.config();
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline_access Calendars.Read',
  });
  const r = await this.deps.fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`refresh failed (${r.status}): ${text}`);
  }
  const j = (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const existing = this.loadTokens();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? refreshToken,
    expiresAt: this.deps.now() + (j.expires_in ?? 3600) * 1000,
    account: existing?.account ?? 'unknown',
  };
}

/** 60-second safety window so we don't hand out a token about to expire. */
private static EXPIRY_SLACK_MS = 60_000;

async getValidAccessToken(): Promise<string> {
  const cached = this.loadTokens();
  if (!cached) throw new NotAuthenticatedError();
  if (cached.expiresAt - MsGraphAuthService.EXPIRY_SLACK_MS > this.deps.now()) {
    return cached.accessToken;
  }
  try {
    const refreshed = await this.refreshTokens(cached.refreshToken);
    this.saveTokens(refreshed);
    return refreshed.accessToken;
  } catch {
    this.clearTokens();
    throw new NotAuthenticatedError('Sign-in expired. Please sign in again.');
  }
}

signOut(): void {
  this.clearTokens();
}
```

- [ ] **Step 4: Run, verify passes**

Run: `npx vitest run tests/orchestrator/msGraphAuth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/msGraphAuth.ts tests/orchestrator/msGraphAuth.test.ts
git commit -m "feat(meetings): refresh + getValidAccessToken + signOut"
```

---

## Task 5: msGraphCalendar — fetchCalendarEvents with pagination

**Files:**
- Create: `orchestrator/services/msGraphCalendar.ts`
- Test: `tests/orchestrator/msGraphCalendar.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/orchestrator/msGraphCalendar.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchCalendarEvents } from '../../orchestrator/services/msGraphCalendar.js';

describe('fetchCalendarEvents', () => {
  it('returns events on a single page', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            id: '1',
            subject: 'A',
            isAllDay: false,
            isCancelled: false,
            responseStatus: { response: 'accepted' },
            start: { dateTime: '2026-05-14T09:00:00.0000000', timeZone: 'Europe/Prague' },
            end: { dateTime: '2026-05-14T10:00:00.0000000', timeZone: 'Europe/Prague' },
          },
        ],
      }),
    } as unknown as Response));
    const events = await fetchCalendarEvents('AT', '2026-05-14', '2026-05-14', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('1');
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('graph.microsoft.com/v1.0/me/calendarView');
    expect(url).toContain('startDateTime=2026-05-14T00:00:00');
    expect(url).toContain('endDateTime=2026-05-14T23:59:59.999');
  });

  it('follows @odata.nextLink across pages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('skip=0') || !url.includes('skip')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: [{ id: 'p1' }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?skip=50',
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: [{ id: 'p2' }] }),
      } as unknown as Response;
    });
    const events = await fetchCalendarEvents('AT', '2026-05-14', '2026-05-27', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(events.map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when access token is unauthorized (401)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as unknown as Response));
    await expect(
      fetchCalendarEvents('AT', '2026-05-14', '2026-05-14', {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/401/);
  });

  it('caps results at the safety limit (500)', async () => {
    let page = 0;
    const fetchMock = vi.fn(async () => {
      page++;
      const value = Array.from({ length: 200 }, (_, i) => ({ id: `${page}-${i}` }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ value, '@odata.nextLink': page < 5 ? 'next' : undefined }),
      } as unknown as Response;
    });
    const events = await fetchCalendarEvents('AT', '2026-05-14', '2026-05-27', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(events.length).toBe(500);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npx vitest run tests/orchestrator/msGraphCalendar.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

```ts
// orchestrator/services/msGraphCalendar.ts
import type { RawEvent } from './meetingRules.js';

export interface FetchDeps {
  fetch: typeof fetch;
}

const SELECT = '$select=id,subject,isAllDay,isCancelled,responseStatus,start,end';
const TOP = '$top=50';
const MAX_EVENTS = 500;

export async function fetchCalendarEvents(
  accessToken: string,
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
  deps: FetchDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<RawEvent[]> {
  const initial =
    `https://graph.microsoft.com/v1.0/me/calendarView` +
    `?startDateTime=${from}T00:00:00` +
    `&endDateTime=${to}T23:59:59.999` +
    `&${SELECT}&${TOP}`;

  const headers = {
    authorization: `Bearer ${accessToken}`,
    prefer: 'outlook.timezone="Europe/Prague"',
  } as const;

  let url: string | undefined = initial;
  const events: RawEvent[] = [];

  while (url) {
    const r = await deps.fetch(url, { headers });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Graph calendarView failed (${r.status}): ${text}`);
    }
    const j = (await r.json()) as {
      value?: RawEvent[];
      '@odata.nextLink'?: string;
    };
    for (const e of j.value ?? []) {
      events.push(e);
      if (events.length >= MAX_EVENTS) return events;
    }
    url = j['@odata.nextLink'];
  }
  return events;
}
```

- [ ] **Step 4: Run, verify passes**

Run: `npx vitest run tests/orchestrator/msGraphCalendar.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/msGraphCalendar.ts tests/orchestrator/msGraphCalendar.test.ts
git commit -m "feat(meetings): fetch MS Graph calendarView with pagination + 500 cap"
```

---

## Task 6: Refactor meetingsSync to use Graph

**Files:**
- Modify: `orchestrator/services/meetingsSync.ts`
- Test: `tests/orchestrator/meetingsSync.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/orchestrator/meetingsSync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { MeetingsSyncService } from '../../orchestrator/services/meetingsSync.js';
import { MsGraphAuthService, NotAuthenticatedError } from '../../orchestrator/services/msGraphAuth.js';

function freshDb(): SqliteLike {
  const db = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(db);
  // Insert one project + epic + task + default-task setting so rules can resolve.
  db.prepare(`INSERT INTO projects (name) VALUES ('Default')`).run();
  db.prepare(`INSERT INTO epics (project_id, name) VALUES (1, 'Sprint')`).run();
  db.prepare(`INSERT INTO tasks (epic_id, number, title) VALUES (1, 'GREEN-345', 'Sprint task')`).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('meetings.default_task_id', '1')`).run();
  return db;
}

describe('MeetingsSyncService', () => {
  beforeEach(() => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
  });

  it('returns needsAuth=true when not signed in', async () => {
    const auth = {
      getValidAccessToken: vi.fn(async () => {
        throw new NotAuthenticatedError();
      }),
    } as unknown as MsGraphAuthService;
    const svc = new MeetingsSyncService(freshDb(), {
      auth,
      fetchEvents: vi.fn(),
    });
    const r = await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    expect(r.needsAuth).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('inserts a worklog for a Graph event and returns a summary', async () => {
    const db = freshDb();
    const auth = { getValidAccessToken: vi.fn(async () => 'AT') } as unknown as MsGraphAuthService;
    const fetchEvents = vi.fn(async () => [
      {
        id: 'evt-1',
        subject: 'Backlog grooming',
        isAllDay: false,
        responseStatus: { response: 'accepted' },
        start: { dateTime: '2026-05-14T09:00:00.0000000', timeZone: 'Europe/Prague' },
        end: { dateTime: '2026-05-14T10:00:00.0000000', timeZone: 'Europe/Prague' },
      },
    ]);
    const svc = new MeetingsSyncService(db, { auth, fetchEvents });
    const r = await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    expect(r.ok).toBe(true);
    expect(r.logged).toBe(1);
    const row = db.prepare('SELECT * FROM worklogs WHERE external_id = ?').get('evt-1') as {
      task_id: number;
      source: string;
      minutes: number;
    };
    expect(row.source).toBe('outlook');
    expect(row.task_id).toBe(1);
    expect(row.minutes).toBe(60);
  });

  it('treats duplicate event id as `duplicate`, not an error', async () => {
    const db = freshDb();
    const event = {
      id: 'evt-dup',
      subject: 'Backlog grooming',
      isAllDay: false,
      responseStatus: { response: 'accepted' },
      start: { dateTime: '2026-05-14T09:00:00.0000000', timeZone: 'Europe/Prague' },
      end: { dateTime: '2026-05-14T10:00:00.0000000', timeZone: 'Europe/Prague' },
    };
    const auth = { getValidAccessToken: vi.fn(async () => 'AT') } as unknown as MsGraphAuthService;
    const fetchEvents = vi.fn(async () => [event]);
    const svc = new MeetingsSyncService(db, { auth, fetchEvents });
    await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    const r2 = await svc.sync({ from: '2026-05-14', to: '2026-05-14' });
    expect(r2.logged).toBe(0);
    expect(r2.duplicate).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npx vitest run tests/orchestrator/meetingsSync.test.ts`
Expected: FAIL — current `MeetingsSyncService` doesn't accept the new deps shape.

- [ ] **Step 3: Rewrite `orchestrator/services/meetingsSync.ts`**

```ts
import type { SqliteLike } from '../db/migrations.js';
import { WorklogsRepo } from '../db/repositories/worklogs.js';
import {
  decide,
  type RawEvent,
  type RuleConfig,
  type TaskRef,
} from './meetingRules.js';
import {
  MsGraphAuthService,
  NotAuthenticatedError,
} from './msGraphAuth.js';
import { fetchCalendarEvents } from './msGraphCalendar.js';

export interface MeetingsSyncRequest {
  from: string;
  to: string;
}

export interface MeetingsSyncResult {
  ok: boolean;
  exitCode: number | null;
  summary: string;
  logged: number;
  skipped: number;
  unresolved: number;
  duplicate: number;
  total: number;
  needsAuth?: boolean;
  error?: string;
}

export interface MeetingsSyncDeps {
  auth: Pick<MsGraphAuthService, 'getValidAccessToken'>;
  fetchEvents(token: string, from: string, to: string): Promise<RawEvent[]>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SETTING_DEFAULT_TASK = 'meetings.default_task_id';

function lookupTaskByNumber(db: SqliteLike, number: string): TaskRef | null {
  const row = db
    .prepare('SELECT id, number, title FROM tasks WHERE number = ? LIMIT 1')
    .get(number) as TaskRef | undefined;
  return row ?? null;
}

function loadRuleConfig(db: SqliteLike): RuleConfig {
  const lookupByNumber = (n: string) => lookupTaskByNumber(db, n);
  const defaultIdRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTING_DEFAULT_TASK) as { value: string | null } | undefined;
  const defaultId = defaultIdRow?.value ? Number(defaultIdRow.value) : null;
  const defaultTask = defaultId
    ? (db.prepare('SELECT id, number, title FROM tasks WHERE id = ?').get(defaultId) as TaskRef | undefined) ?? null
    : null;
  return {
    green100: lookupByNumber('GREEN-100'),
    green34: lookupByNumber('GREEN-34'),
    defaultTask,
    lookupByNumber,
  };
}

export class MeetingsSyncService {
  private worklogs: WorklogsRepo;

  constructor(
    private db: SqliteLike,
    private deps: MeetingsSyncDeps = {
      auth: new MsGraphAuthService(),
      fetchEvents: (token, from, to) => fetchCalendarEvents(token, from, to),
    },
  ) {
    this.worklogs = new WorklogsRepo(db);
  }

  async sync(request: MeetingsSyncRequest): Promise<MeetingsSyncResult> {
    console.log(`[meetings:sync] start ${request.from} → ${request.to}`);
    if (!ISO_DATE_RE.test(request.from) || !ISO_DATE_RE.test(request.to)) {
      return emptyResult({ ok: false, error: 'from/to must be YYYY-MM-DD' });
    }
    if (request.from > request.to) {
      return emptyResult({ ok: false, error: 'from must be on or before to' });
    }

    let token: string;
    try {
      token = await this.deps.auth.getValidAccessToken();
    } catch (err) {
      if (err instanceof NotAuthenticatedError) {
        return emptyResult({
          ok: false,
          needsAuth: true,
          error: 'Sign in to Microsoft 365 in Settings first.',
        });
      }
      return emptyResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let events: RawEvent[];
    try {
      events = await this.deps.fetchEvents(token, request.from, request.to);
    } catch (err) {
      return emptyResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    console.log(`[meetings:sync] fetched ${events.length} events from Graph`);

    const config = loadRuleConfig(this.db);
    let logged = 0;
    let skipped = 0;
    let unresolved = 0;
    let duplicate = 0;

    for (const event of events) {
      const decision = decide(event, config);
      if (decision.status === 'skipped') {
        skipped++;
        continue;
      }
      if (decision.status === 'unresolved' || !decision.worklog) {
        unresolved++;
        continue;
      }
      const w = decision.worklog;
      if (!w.externalId) {
        unresolved++;
        continue;
      }
      try {
        this.worklogs.create({
          taskId: w.taskId,
          workDate: w.workDate,
          minutes: w.minutes,
          description: w.description,
          source: w.source,
          externalId: w.externalId,
        });
        logged++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed/i.test(msg)) duplicate++;
        else {
          console.warn('[meetings:sync] insert failed:', msg);
          unresolved++;
        }
      }
    }

    const total = events.length;
    const summary = `${logged} logged, ${duplicate} duplicate, ${skipped} skipped, ${unresolved} unresolved, ${total} total`;
    console.log(`[meetings:sync] done — ${summary}`);
    return {
      ok: unresolved === 0,
      exitCode: 0,
      summary,
      logged,
      skipped,
      unresolved,
      duplicate,
      total,
    };
  }
}

function emptyResult(
  overrides: Partial<MeetingsSyncResult> & Pick<MeetingsSyncResult, 'ok'>,
): MeetingsSyncResult {
  return {
    exitCode: null,
    summary: '',
    logged: 0,
    skipped: 0,
    unresolved: 0,
    duplicate: 0,
    total: 0,
    ...overrides,
  };
}
```

- [ ] **Step 4: Run, verify passes**

Run: `npx vitest run tests/orchestrator/meetingsSync.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/meetingsSync.ts tests/orchestrator/meetingsSync.test.ts
git commit -m "feat(meetings): pivot meetings sync to MS Graph API"
```

---

## Task 7: Extend IPC contracts

**Files:**
- Modify: `shared/ipcContract.ts`
- Modify: `shared/messagePort.ts`

- [ ] **Step 1: Add `ms365:*` request kinds and `needsAuth` to `MeetingsSyncResultPayload`**

In `shared/ipcContract.ts`, add to `IpcRequest`:

```ts
| { kind: 'ms365:status'; payload: Record<string, never> }
| { kind: 'ms365:startSignIn'; payload: Record<string, never> }
| { kind: 'ms365:cancelSignIn'; payload: Record<string, never> }
| { kind: 'ms365:signOut'; payload: Record<string, never> }
```

And to `IpcResponse`:

```ts
| { kind: 'ms365:status'; payload: Ms365StatusPayload }
| { kind: 'ms365:startSignIn'; payload: Ms365StartSignInPayload }
| { kind: 'ms365:cancelSignIn'; payload: { ok: true } }
| { kind: 'ms365:signOut'; payload: { ok: true } }
```

Add interfaces:

```ts
export interface Ms365StatusPayload {
  configured: boolean;
  signedIn: boolean;
  account: string | null;
  expiresAt: number | null;
  error?: string;
}

export interface Ms365StartSignInPayload {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  error?: string;
}
```

Add `needsAuth?: boolean` to `MeetingsSyncResultPayload`.

Add to `IpcPush`:

```ts
| { kind: 'ms365:signInUpdate';
    payload: {
      status: 'pending' | 'success' | 'expired' | 'error';
      account?: string;
      error?: string;
    } }
```

- [ ] **Step 2: Mirror in `shared/messagePort.ts`**

Add corresponding `id` variants to `OrchRequest`, response variants to `OrchResponse`, and `OrchPush` entry. Use the same field names.

- [ ] **Step 3: Run orchestrator typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: errors complaining the orchestrator's `handleRequest` switch is non-exhaustive over the new kinds. (Fixed in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add shared/ipcContract.ts shared/messagePort.ts
git commit -m "feat(meetings): IPC contract for ms365 auth + needsAuth hint"
```

---

## Task 8: Wire orchestrator handlers for ms365:* + push events

**Files:**
- Modify: `orchestrator/index.ts`

- [ ] **Step 1: Add module-level state + handler functions**

Near the other service imports:

```ts
import { MsGraphAuthService, NotAuthenticatedError } from './services/msGraphAuth.js';
```

After the existing module-level state (around the top of the file), add:

```ts
const msGraphAuth = new MsGraphAuthService();
let activeSignInController: AbortController | null = null;
```

- [ ] **Step 2: Add the four `ms365:*` cases inside `handleRequest`**

Before the final `}` of the switch:

```ts
case 'ms365:status': {
  const cfg = msGraphAuth.config();
  const tokens = msGraphAuth.loadTokens();
  return {
    configured: cfg.configured,
    signedIn: tokens !== null,
    account: tokens?.account ?? null,
    expiresAt: tokens?.expiresAt ?? null,
  };
}

case 'ms365:startSignIn': {
  if (!msGraphAuth.config().configured) {
    return {
      userCode: '',
      verificationUri: '',
      expiresIn: 0,
      error: 'MS_GRAPH_CLIENT_ID is not set. See the README for setup.',
    };
  }
  // Cancel any prior in-flight flow.
  activeSignInController?.abort();
  activeSignInController = new AbortController();
  let initial;
  try {
    initial = await msGraphAuth.startDeviceCode();
  } catch (err) {
    activeSignInController = null;
    return {
      userCode: '',
      verificationUri: '',
      expiresIn: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  // Poll in the background and push updates to the renderer.
  const signal = activeSignInController.signal;
  msGraphAuth
    .pollForTokens({
      deviceCode: initial.deviceCode,
      interval: initial.interval,
      expiresIn: initial.expiresIn,
      signal,
    })
    .then((r) => {
      api?.push({
        kind: 'ms365:signInUpdate',
        payload: {
          status: r.status,
          account: r.status === 'success' ? r.account : undefined,
          error: r.status === 'error' ? r.error : undefined,
        },
      });
    })
    .catch((err) => {
      api?.push({
        kind: 'ms365:signInUpdate',
        payload: {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        },
      });
    })
    .finally(() => {
      activeSignInController = null;
    });
  return {
    userCode: initial.userCode,
    verificationUri: initial.verificationUri,
    expiresIn: initial.expiresIn,
  };
}

case 'ms365:cancelSignIn': {
  activeSignInController?.abort();
  activeSignInController = null;
  return { ok: true as const };
}

case 'ms365:signOut': {
  msGraphAuth.signOut();
  return { ok: true as const };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, ~395 tests.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(meetings): orchestrator handlers for ms365:* IPC kinds"
```

---

## Task 9: Renderer hook `useMicrosoft365`

**Files:**
- Create: `client/src/state/useMicrosoft365.ts`

- [ ] **Step 1: Implement the hook**

```ts
// client/src/state/useMicrosoft365.ts
import { useCallback, useEffect, useState } from 'react';
import type {
  Ms365StatusPayload,
  Ms365StartSignInPayload,
} from '../../../shared/ipcContract.js';

export interface ActiveSignIn {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export interface SignInUpdate {
  status: 'pending' | 'success' | 'expired' | 'error';
  account?: string;
  error?: string;
}

export interface Microsoft365State {
  status: Ms365StatusPayload | null;
  active: ActiveSignIn | null;
  /** Last push update — drives the popover's status line. */
  update: SignInUpdate | null;
  startSignIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

export function useMicrosoft365(): Microsoft365State {
  const [status, setStatus] = useState<Ms365StatusPayload | null>(null);
  const [active, setActive] = useState<ActiveSignIn | null>(null);
  const [update, setUpdate] = useState<SignInUpdate | null>(null);

  const refresh = useCallback(async () => {
    const s = await window.watchtower.invoke('ms365:status', {});
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('ms365:signInUpdate', (payload) => {
      setUpdate(payload);
      if (payload.status === 'success' || payload.status === 'expired' || payload.status === 'error') {
        setActive(null);
        void refresh();
      }
    });
    return off;
  }, [refresh]);

  const startSignIn = useCallback(async () => {
    setUpdate({ status: 'pending' });
    const r: Ms365StartSignInPayload = await window.watchtower.invoke('ms365:startSignIn', {});
    if (r.error) {
      setUpdate({ status: 'error', error: r.error });
      return;
    }
    setActive({ userCode: r.userCode, verificationUri: r.verificationUri, expiresIn: r.expiresIn });
  }, []);

  const cancelSignIn = useCallback(async () => {
    await window.watchtower.invoke('ms365:cancelSignIn', {});
    setActive(null);
    setUpdate(null);
  }, []);

  const signOut = useCallback(async () => {
    await window.watchtower.invoke('ms365:signOut', {});
    setUpdate(null);
    await refresh();
  }, [refresh]);

  return { status, active, update, startSignIn, cancelSignIn, signOut, refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/state/useMicrosoft365.ts
git commit -m "feat(meetings): useMicrosoft365 hook"
```

---

## Task 10: Settings Microsoft 365 section UI

**Files:**
- Create: `client/src/components/settings/Microsoft365Section.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// client/src/components/settings/Microsoft365Section.tsx
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMicrosoft365 } from '../../state/useMicrosoft365.js';

export function Microsoft365Section() {
  const { status, active, update, startSignIn, cancelSignIn, signOut } = useMicrosoft365();

  if (!status) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <CircularProgress size={16} />
      </Paper>
    );
  }

  if (!status.configured) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>Microsoft 365</Typography>
        <Alert severity="info">
          Set <code>MS_GRAPH_CLIENT_ID</code> in Watchtower&apos;s launch environment to
          enable Outlook calendar sync. See the README for one-time Azure
          app registration steps.
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>Microsoft 365</Typography>
        {status.signedIn ? (
          <Button size="small" onClick={() => void signOut()}>
            Sign out
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            onClick={() => void startSignIn()}
            disabled={Boolean(active)}
          >
            Sign in
          </Button>
        )}
      </Stack>

      {status.signedIn && (
        <Typography variant="body2" color="text.secondary">
          Connected as <strong>{status.account}</strong>.
        </Typography>
      )}
      {!status.signedIn && !active && (
        <Typography variant="body2" color="text.secondary">
          Sign in to enable one-click meeting sync from the dashboard.
        </Typography>
      )}

      {active && (
        <Box sx={{ mt: 1.5 }}>
          <Alert severity="info" icon={<CircularProgress size={16} />}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Open{' '}
              <Link href={active.verificationUri} target="_blank" rel="noopener noreferrer">
                {active.verificationUri}
              </Link>{' '}
              and enter:
            </Typography>
            <Typography
              sx={{
                fontFamily: 'monospace',
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 1,
                userSelect: 'all',
              }}
            >
              {active.userCode}
            </Typography>
            <Button size="small" sx={{ mt: 1 }} onClick={() => void cancelSignIn()}>
              Cancel
            </Button>
          </Alert>
        </Box>
      )}

      {update?.status === 'error' && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {update.error ?? 'Sign-in failed.'}
        </Alert>
      )}
      {update?.status === 'expired' && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          Code expired. Click Sign in to try again.
        </Alert>
      )}
    </Paper>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/Microsoft365Section.tsx
git commit -m "feat(meetings): Microsoft 365 Settings section UI"
```

---

## Task 11: Mount in SettingsPanel + clean up SprintStrip

**Files:**
- Modify: `client/src/components/SettingsPanel.tsx` (or the current settings host — locate via `Grep` if structure has changed)
- Modify: `client/src/components/dashboard/SprintStrip.tsx`

- [ ] **Step 1: Locate the Settings host**

Run: `grep -rn "skills\|McpTab\|HooksTab\|AgentsTab\|SettingsJsonTab" client/src/components/settings/ | head -5`

Identify which file aggregates the existing settings tabs (likely `SettingsPanel.tsx` or `SettingsTabs.tsx`). Mount `Microsoft365Section` either:
- As a new tab if the host uses tabs, or
- As an inline section above the existing content if the host is a single-page card layout.

Concrete change depends on the file's current structure — read it, follow the existing pattern. Example for a tabbed layout:

```tsx
import { Microsoft365Section } from './Microsoft365Section.js';
// ...
<TabPanel value="microsoft365">
  <Microsoft365Section />
</TabPanel>
```

- [ ] **Step 2: Update SprintStrip — drop the workflow hint and handle `needsAuth`**

In `client/src/components/dashboard/SprintStrip.tsx`, remove the existing `Tip: run /sync-meetings...` block. The popover's body should just be the two date pickers and Cancel/Sync buttons.

Also update `submitSync` so the toast on `needsAuth` is specific:

```tsx
if (result.needsAuth) {
  showError('Sign in to Microsoft 365 in Settings first.');
  return;
}
if (result.error) {
  showError(`Sync schůzek selhal: ${result.error}`);
  return;
}
const msg = result.summary || 'Sync schůzek dokončen.';
showSuccess(msg);
onSyncComplete?.();
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p electron/tsconfig.json --noEmit`
Expected: clean.

Skip client typecheck — pre-existing drift, see CLAUDE.md.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/SettingsPanel.tsx client/src/components/dashboard/SprintStrip.tsx
git commit -m "feat(meetings): mount Microsoft 365 settings + drop SprintStrip workflow hint"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, ~395 tests (372 existing + 18 from earlier meetingRules + ~25 new).

- [ ] **Step 2: Full typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p electron/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke test in dev**

```bash
# in one terminal
npm run dev
```

Then in the running app:

1. Open Settings → Microsoft 365 → "Set MS_GRAPH_CLIENT_ID" alert visible (since env var isn't set in dev).
2. Stop `npm run dev`. Set the env: `export MS_GRAPH_CLIENT_ID=<your-app-id>` (after completing the Azure app registration described in the spec).
3. Restart `npm run dev`.
4. Settings → Microsoft 365 → Sign in. The popover should show the user code; complete in the browser; popover flips to "Connected as you@greencode.cz".
5. Dashboard → Sprint card → sync icon → date range → Sync.
6. Toast should show `N logged, ...` and worklogs appear in the sprint cells.
7. Click Sync again with the same range — toast should report `0 logged, N duplicate, ...` (idempotency works).

- [ ] **Step 4: Final commit (if anything else changed during smoke test)**

```bash
git status
# only commit if files changed
```

---

## Self-review checklist

- ✅ Every spec section maps to at least one task: auth (T1-T4), calendar (T5), refactor (T6), IPC (T7-T8), UI (T9-T11), final (T12).
- ✅ No "TODO" / "TBD" / "fill in later" placeholders.
- ✅ Type names consistent across tasks: `MsGraphAuthService`, `CachedTokens`, `Ms365StatusPayload`, `MeetingsSyncDeps`, `RawEvent` (reused).
- ✅ Each task lists exact file paths + complete code for what to write.
- ✅ Commit messages follow conventional-commit style (matches `git log --oneline`).
- ✅ Order respects dependencies: auth → calendar → sync service → IPC → handler → renderer hook → UI → mount + cleanup → verification.
