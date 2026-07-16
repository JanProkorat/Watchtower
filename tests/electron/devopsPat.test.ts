import { describe, it, expect } from 'vitest';
import { classifyPats, type PatCrypto } from '../../electron/devopsPat.js';

// A stored map is host -> base64(ciphertext). classifyPats decrypts what it can
// and, crucially, distinguishes a blob that is *present but undecryptable* (the
// unsigned-rebuild keychain-key rotation case) from a host that was never set.
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('classifyPats', () => {
  const okCrypto: PatCrypto = {
    isEncryptionAvailable: () => true,
    // Our fake "ciphertext" is just the plaintext round-tripped through base64.
    decrypt: (enc) => enc.toString('utf8'),
  };

  it('decrypts every readable entry and reports none unreadable', () => {
    const map = { 'devops.host': b64('pat-a'), 'github-ent.host': b64('pat-b') };
    const out = classifyPats(map, okCrypto);
    expect(out.pats).toEqual({ 'devops.host': 'pat-a', 'github-ent.host': 'pat-b' });
    expect(out.unreadable).toEqual([]);
  });

  it('flags a stored-but-undecryptable host as unreadable when encryption IS available', () => {
    const crypto: PatCrypto = {
      isEncryptionAvailable: () => true,
      decrypt: (enc) => {
        if (enc.toString('utf8') === '__corrupt__') throw new Error('decrypt failed');
        return enc.toString('utf8');
      },
    };
    const map = { good: b64('pat-a'), stale: b64('__corrupt__') };
    const out = classifyPats(map, crypto);
    expect(out.pats).toEqual({ good: 'pat-a' });
    expect(out.unreadable).toEqual(['stale']);
  });

  it('does NOT flag as unreadable when encryption is unavailable (transient early-startup)', () => {
    const crypto: PatCrypto = {
      isEncryptionAvailable: () => false,
      decrypt: () => { throw new Error('not available yet'); },
    };
    const map = { stale: b64('anything') };
    const out = classifyPats(map, crypto);
    expect(out.pats).toEqual({});
    expect(out.unreadable).toEqual([]);
  });
});
