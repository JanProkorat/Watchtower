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
