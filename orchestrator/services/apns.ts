import crypto from 'node:crypto';
import http2 from 'node:http2';
import { HUB_BUNDLE_ID, type HubConfig } from '@watchtower/shared/hubConfig.js';

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function apnsHost(env: 'sandbox' | 'production'): string {
  return env === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
}

export function buildApnsJwt(cfg: { apnsKey: string; apnsKeyId: string; apnsTeamId: string }, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.apnsKeyId }));
  const payload = b64url(JSON.stringify({ iss: cfg.apnsTeamId, iat: nowSec }));
  const signingInput = `${header}.${payload}`;
  // JWT requires raw r||s (ieee-p1363), not DER.
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key: cfg.apnsKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

export function buildApnsPayload(msg: { title: string; body: string; data: Record<string, unknown> }): string {
  return JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, ...msg.data });
}

// JWTs are valid up to 1h; cache for ~50 min keyed by keyId.
let cachedJwt: { keyId: string; iat: number; token: string } | null = null;

export async function sendApns(
  cfg: HubConfig,
  deviceToken: string,
  msg: { title: string; body: string; data: Record<string, unknown> },
  http2mod: typeof http2 = http2,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!cachedJwt || cachedJwt.keyId !== cfg.apnsKeyId || nowSec - cachedJwt.iat > 3000) {
    cachedJwt = { keyId: cfg.apnsKeyId, iat: nowSec, token: buildApnsJwt(cfg, nowSec) };
  }
  const body = buildApnsPayload(msg);
  return await new Promise((resolve) => {
    const client = http2mod.connect(apnsHost(cfg.apnsEnv));
    client.on('error', (e) => resolve({ ok: false, status: 0, reason: e.message }));
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${cachedJwt!.token}`,
      'apns-topic': HUB_BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0; let data = '';
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      client.close();
      let reason: string | undefined;
      if (status !== 200 && data) { try { reason = JSON.parse(data).reason; } catch { /* ignore */ } }
      resolve({ ok: status === 200, status, reason });
    });
    req.on('error', (e) => { try { client.close(); } catch { /* ignore */ } resolve({ ok: false, status: 0, reason: e.message }); });
    req.end(body);
  });
}
