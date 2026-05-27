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
    const svc = new MsGraphAuthService(
      makeDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
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
    const svc = new MsGraphAuthService(
      makeDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    await expect(svc.startDeviceCode()).rejects.toThrow(/invalid_client/);
  });
});

describe('pollForTokens', () => {
  const codeOpts = { deviceCode: 'devc', interval: 1, expiresIn: 900 };

  it('returns success and saves tokens after authorization_pending → success', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let calls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/v1.0/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ userPrincipalName: 'u@x.cz' }),
        } as unknown as Response;
      }
      calls++;
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
    if (r.status === 'success') expect(r.account).toBe('u@x.cz');
    expect(svc.loadTokens()?.accessToken).toBe('AT');
  });

  it('doubles interval on slow_down', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let calls = 0;
    const sleeps: number[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/v1.0/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ userPrincipalName: 'u@x.cz' }),
        } as unknown as Response;
      }
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'slow_down' }),
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
    const svc = new MsGraphAuthService(
      makeDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
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
    const svc = new MsGraphAuthService(
      makeDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    const r = await svc.pollForTokens(codeOpts);
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.error).toContain('user said no');
  });

  it('aborts when AbortController is already signalled', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'authorization_pending' }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(
      makeDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    const ac = new AbortController();
    ac.abort();
    const r = await svc.pollForTokens({ ...codeOpts, signal: ac.signal });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.error).toMatch(/cancel|abort/i);
    // Confirms we exit before any HTTP call when the signal is already set.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns expired when expiresIn elapses', async () => {
    process.env.MS_GRAPH_CLIENT_ID = 'abc';
    let now = 1_700_000_000_000;
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'authorization_pending' }),
    } as unknown as Response));
    const svc = new MsGraphAuthService(
      makeDeps({
        fetch: fetchMock as unknown as typeof fetch,
        now: () => now,
        sleep: (ms) => {
          now += ms; // simulate time passing in the polling loop
          return Promise.resolve();
        },
      }),
    );
    // expiresIn 2s, interval 1s → after ~2 sleeps we cross the deadline.
    const r = await svc.pollForTokens({ deviceCode: 'devc', interval: 1, expiresIn: 2 });
    expect(r.status).toBe('expired');
  });
});
