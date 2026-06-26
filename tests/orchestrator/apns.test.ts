import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildApnsJwt, buildApnsPayload, apnsHost } from '../../orchestrator/services/apns.js';

// A throwaway P-256 key pair for signing/verification in the test.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('apns', () => {
  it('selects host by env', () => {
    expect(apnsHost('sandbox')).toBe('https://api.sandbox.push.apple.com');
    expect(apnsHost('production')).toBe('https://api.push.apple.com');
  });

  it('builds a verifiable ES256 JWT with kid/iss/iat', () => {
    const jwt = buildApnsJwt({ apnsKey: pem, apnsKeyId: 'KEY123', apnsTeamId: 'TEAM99' }, 1_700_000_000);
    const [h, p, sig] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(payload).toEqual({ iss: 'TEAM99', iat: 1_700_000_000 });
    const ok = crypto.verify('SHA256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });

  it('builds an aps payload with alert + custom data', () => {
    const raw = buildApnsPayload({ title: 'watchtower-api', body: 'čeká na povolení', data: { instanceId: 'i1' } });
    expect(JSON.parse(raw)).toEqual({
      aps: { alert: { title: 'watchtower-api', body: 'čeká na povolení' }, sound: 'default' },
      instanceId: 'i1',
    });
  });
});
