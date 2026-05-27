// Microsoft Graph OAuth (device-code flow) + Keychain-backed token cache.
//
// Hand-rolled rather than pulled from msal-node to match the existing
// jiraSync.ts pattern (raw fetch + `security` CLI keychain access). One
// signed-in user per Watchtower install; no multi-account support.
//
// Config (matches the Jira env-var convention):
//   MS_GRAPH_CLIENT_ID         (required) — Azure AD app's Application ID
//   MS_GRAPH_TENANT_ID         (default: 'common') — tenant ID or 'common'
//   MS_GRAPH_KEYCHAIN_SERVICE  (default: 'watchtower-ms-graph')
//   MS_GRAPH_KEYCHAIN_ACCOUNT  (default: 'default')

import { spawnSync } from 'node:child_process';

export interface MsGraphConfig {
  clientId: string;
  tenantId: string;
  keychainService: string;
  keychainAccount: string;
  configured: boolean;
}

export interface DeviceCodeResponse {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
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
    const r = spawnSync(
      'security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { encoding: 'utf8' },
    );
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
}
