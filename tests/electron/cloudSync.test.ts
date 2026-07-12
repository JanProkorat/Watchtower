import { describe, it, expect } from 'vitest';
import {
  parseConfig, computeStatus, computeUpdate, resolveUrl,
  type SafeStorageLike, type CloudSyncFile,
} from '../../electron/cloudSyncStore.js';

// Fake safeStorage: "encrypt" = prefix marker, base64-agnostic (Buffer round-trips).
const ss = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from('enc:' + plain, 'utf8'),
  decryptString: (enc) => {
    const s = enc.toString('utf8');
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext');
    return s.slice(4);
  },
});

describe('parseConfig', () => {
  it('returns disabled for null / bad JSON', () => {
    expect(parseConfig(null)).toEqual({ enabled: false });
    expect(parseConfig('not json')).toEqual({ enabled: false });
  });
  it('parses a valid file and drops an empty url', () => {
    expect(parseConfig('{"enabled":true,"url":"abc"}')).toEqual({ enabled: true, url: 'abc' });
    expect(parseConfig('{"enabled":true,"url":""}')).toEqual({ enabled: true });
  });
});

describe('computeUpdate + resolveUrl round-trip', () => {
  it('encrypts on save and decrypts on resolve', () => {
    const f = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://u:p@h/db' }, ss());
    expect(f.enabled).toBe(true);
    expect(f.url).toBeDefined();
    expect(f.url).not.toContain('postgresql://'); // stored as ciphertext, not plaintext
    expect(resolveUrl(f, ss())).toBe('postgresql://u:p@h/db');
  });
  it('status never leaks the url', () => {
    const f = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://x' }, ss());
    expect(computeStatus(f)).toEqual({ enabled: true, configured: true });
    expect(JSON.stringify(computeStatus(f))).not.toContain('postgresql');
  });
  it('toggle-only save (url undefined) keeps the stored secret', () => {
    const f1 = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://x' }, ss());
    const f2 = computeUpdate(f1, { enabled: false }, ss());
    expect(f2).toEqual({ enabled: false, url: f1.url });
    expect(computeStatus(f2)).toEqual({ enabled: false, configured: true });
  });
  it('empty-string url clears the secret', () => {
    const f1 = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://x' }, ss());
    const f2 = computeUpdate(f1, { enabled: true, url: '' }, ss());
    expect(f2).toEqual({ enabled: true });
    expect(computeStatus(f2).configured).toBe(false);
  });
  it('throws when encryption is unavailable', () => {
    expect(() => computeUpdate({ enabled: false }, { enabled: true, url: 'x' }, ss(false))).toThrow(/unavailable/i);
  });
});

describe('resolveUrl gating', () => {
  const enc = (Buffer.from('enc:postgresql://x', 'utf8')).toString('base64');
  const file: CloudSyncFile = { enabled: true, url: enc };
  it('returns null when disabled', () => {
    expect(resolveUrl({ ...file, enabled: false }, ss())).toBeNull();
  });
  it('returns null when encryption is unavailable', () => {
    expect(resolveUrl(file, ss(false))).toBeNull();
  });
  it('returns null when there is no url', () => {
    expect(resolveUrl({ enabled: true }, ss())).toBeNull();
  });
  it('returns the plaintext when enabled + configured + available', () => {
    expect(resolveUrl(file, ss())).toBe('postgresql://x');
  });
});
