import { describe, it, expect } from 'vitest';
import { parseConfig, computeStatus, resolveUrl } from '../../electron/cloudSyncStore.js';

const URL = 'postgresql://u:p@h/db';

describe('parseConfig', () => {
  it('returns disabled for null / bad JSON', () => {
    expect(parseConfig(null)).toEqual({ enabled: false });
    expect(parseConfig('not json')).toEqual({ enabled: false });
  });
  it('parses the enabled flag', () => {
    expect(parseConfig('{"enabled":true}')).toEqual({ enabled: true });
    expect(parseConfig('{"enabled":false}')).toEqual({ enabled: false });
    expect(parseConfig('{"enabled":"yes"}')).toEqual({ enabled: false }); // only literal true enables
  });
});

describe('computeStatus', () => {
  it('reports available only when a URL was baked into the build', () => {
    expect(computeStatus({ enabled: true }, URL)).toEqual({ enabled: true, available: true });
    expect(computeStatus({ enabled: true }, undefined)).toEqual({ enabled: true, available: false });
    expect(computeStatus({ enabled: false }, URL)).toEqual({ enabled: false, available: true });
  });
});

describe('resolveUrl', () => {
  it('returns the baked URL only when enabled AND a URL was baked', () => {
    expect(resolveUrl({ enabled: true }, URL)).toBe(URL);
  });
  it('returns null when disabled', () => {
    expect(resolveUrl({ enabled: false }, URL)).toBeNull();
  });
  it('returns null when no URL was baked into this build', () => {
    expect(resolveUrl({ enabled: true }, undefined)).toBeNull();
  });
});
