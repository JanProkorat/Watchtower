import { describe, it, expect } from 'vitest';
import { isOpenableUrl } from '../../electron/openableUrl';

describe('isOpenableUrl', () => {
  it('opens any https and http on loopback', () => {
    expect(isOpenableUrl('https://example.com/x')).toBe(true);
    expect(isOpenableUrl('http://localhost:5173')).toBe(true);
    expect(isOpenableUrl('http://127.0.0.1:5001/swagger')).toBe(true);
    expect(isOpenableUrl('http://[::1]:5173/')).toBe(true);
  });

  it('refuses other hosts over http, other schemes and look-alikes', () => {
    expect(isOpenableUrl('http://example.com')).toBe(false);
    expect(isOpenableUrl('http://localhost.evil.com')).toBe(false);
    expect(isOpenableUrl('http://localhost@evil.com')).toBe(false);
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableUrl('vscode://x')).toBe(false);
    expect(isOpenableUrl('not a url')).toBe(false);
  });
});
