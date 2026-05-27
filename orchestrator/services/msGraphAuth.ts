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
      if (opts.signal?.aborted) {
        return { status: 'error', error: 'Sign-in cancelled' };
      }
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
}
