import { describe, it, expect, test } from 'vitest';
import crypto from 'node:crypto';
import { buildApnsJwt, buildApnsPayload, apnsHost, sendApns } from '../../orchestrator/services/apns.js';
import { HUB_BUNDLE_ID } from '@watchtower/shared/hubConfig.js';

// A throwaway P-256 key pair for signing/verification in the test.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const TEST_P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const pem = TEST_P8;

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
    const raw = buildApnsPayload({ title: 'watchtower-api', body: 'permission needed', data: { instanceId: 'i1' } });
    expect(JSON.parse(raw)).toEqual({
      aps: { alert: { title: 'watchtower-api', body: 'permission needed' }, sound: 'default' },
      instanceId: 'i1',
    });
  });
});

test('sendApns sends the given topic in apns-topic header', async () => {
  let sentHeaders: Record<string, string> = {};
  const fakeReq: any = {
    on: (ev: string, cb: (arg?: unknown) => void) => {
      if (ev === 'response') cb({ ':status': 200 });
      if (ev === 'end') cb();
      return fakeReq;
    },
    end: () => {},
  };
  const fakeClient: any = {
    on: () => fakeClient,
    request: (h: Record<string, string>) => { sentHeaders = h; return fakeReq; },
    close: () => {},
  };
  const http2mod: any = { connect: () => fakeClient };
  const cfg: any = { apnsKey: TEST_P8, apnsKeyId: 'K', apnsTeamId: 'T', apnsEnv: 'sandbox' };

  await sendApns(cfg, 'devtoken', { title: 't', body: 'b', data: {} }, 'cz.greencode.watchtower.ios', http2mod);
  expect(sentHeaders['apns-topic']).toBe('cz.greencode.watchtower.ios');
});

test('sendApns defaults apns-topic to HUB_BUNDLE_ID', async () => {
  let sentHeaders: Record<string, string> = {};
  const fakeReq: any = {
    on: (ev: string, cb: (arg?: unknown) => void) => {
      if (ev === 'response') cb({ ':status': 200 });
      if (ev === 'end') cb();
      return fakeReq;
    },
    end: () => {},
  };
  const fakeClient: any = {
    on: () => fakeClient,
    request: (h: Record<string, string>) => { sentHeaders = h; return fakeReq; },
    close: () => {},
  };
  const http2mod: any = { connect: () => fakeClient };
  const cfg: any = { apnsKey: TEST_P8, apnsKeyId: 'K', apnsTeamId: 'T', apnsEnv: 'sandbox' };

  await sendApns(cfg, 'devtoken', { title: 't', body: 'b', data: {} }, undefined, http2mod);
  expect(sentHeaders['apns-topic']).toBe(HUB_BUNDLE_ID);
});
