import { describe, it, expect } from 'vitest';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';

describe('ELECTRON_ONLY_KINDS', () => {
  it('contains the electron-only kinds and not orchestrator kinds', () => {
    expect(ELECTRON_ONLY_KINDS.has('chooseDirectory')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('openInVSCode')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('board:signIn')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('projects:list')).toBe(false);
    expect(ELECTRON_ONLY_KINDS.has('listInstances')).toBe(false);
  });
});

describe('cloudSync IPC', () => {
  it('cloudSync kinds are electron-only (never proxied to the orchestrator)', () => {
    expect(ELECTRON_ONLY_KINDS.has('cloudSync:getConfig')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('cloudSync:setConfig')).toBe(true);
  });
});
