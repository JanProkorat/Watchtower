import { describe, it, expect } from 'vitest';
import { authErrorMessage } from '../../apps/ipad/src/state/useSupabaseAuth.js';

// Tests cover the pure authErrorMessage helper only.
// The useSupabaseAuth hook itself is thin and wraps supabase.auth directly;
// render-testing it would require a DOM + React — logic-only harness, so we skip it.

describe('authErrorMessage', () => {
  it('maps invalid_credentials to Czech bad-credentials message', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials', code: 'invalid_credentials' }))
      .toBe('Nesprávný e-mail nebo heslo.');
  });

  it('maps "Email not confirmed" to Czech unconfirmed-email message', () => {
    expect(authErrorMessage({ message: 'Email not confirmed' }))
      .toBe('E-mail není potvrzený.');
  });

  it('matches "invalid" in message text (bad credentials fallback)', () => {
    expect(authErrorMessage({ message: 'Invalid credentials provided' }))
      .toBe('Nesprávný e-mail nebo heslo.');
  });

  it('maps unknown/network errors to generic Czech fallback', () => {
    expect(authErrorMessage({ message: 'Network request failed' }))
      .toBe('Přihlášení se nezdařilo. Zkuste to znovu.');
  });

  it('maps empty-message error to generic Czech fallback', () => {
    expect(authErrorMessage({ message: '' }))
      .toBe('Přihlášení se nezdařilo. Zkuste to znovu.');
  });

  it('maps null/undefined gracefully to generic Czech fallback', () => {
    expect(authErrorMessage(null)).toBe('Přihlášení se nezdařilo. Zkuste to znovu.');
    expect(authErrorMessage(undefined)).toBe('Přihlášení se nezdařilo. Zkuste to znovu.');
  });
});
