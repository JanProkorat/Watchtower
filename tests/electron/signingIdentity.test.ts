import { describe, it, expect } from 'vitest';
import { pickSigningIdentity } from '../../scripts/signingIdentity.mjs';

// Sample `security find-identity -v -p codesigning` output.
const DEV_ONLY = `  1) 881AFB0A49219CE310B34A1C0C0F834BBC1EC923 "Apple Development: JAN PROKORAT (U2SK7654ZS)"
     1 valid identities found`;
const BOTH = `  1) AAAA1111 "Apple Development: JAN PROKORAT (U2SK7654ZS)"
  2) BBBB2222 "Developer ID Application: Green Code s.r.o. (TEAM123)"
     2 valid identities found`;
const NONE = `     0 valid identities found`;

describe('pickSigningIdentity', () => {
  it('honours an explicit env override', () => {
    expect(pickSigningIdentity({ env: { WATCHTOWER_SIGN_IDENTITY: 'My Cert' }, findIdentityOutput: DEV_ONLY }))
      .toBe('My Cert');
  });

  it('prefers a Developer ID Application cert over an Apple Development one', () => {
    expect(pickSigningIdentity({ env: {}, findIdentityOutput: BOTH })).toBe('BBBB2222');
  });

  it('falls back to the Apple Development cert when that is all there is', () => {
    expect(pickSigningIdentity({ env: {}, findIdentityOutput: DEV_ONLY })).toBe('881AFB0A49219CE310B34A1C0C0F834BBC1EC923');
  });

  it('returns null (→ ad-hoc) when no signing identity exists', () => {
    expect(pickSigningIdentity({ env: {}, findIdentityOutput: NONE })).toBeNull();
  });
});
