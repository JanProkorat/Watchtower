import { describe, it, expect } from 'vitest';
import { ELECTRON_ONLY_KINDS } from '../../shared/ipcContract.js';

describe('ELECTRON_ONLY_KINDS', () => {
  it('contains the electron-only kinds and not orchestrator kinds', () => {
    expect(ELECTRON_ONLY_KINDS.has('chooseDirectory')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('openInVSCode')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('board:signIn')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('projects:list')).toBe(false);
    expect(ELECTRON_ONLY_KINDS.has('listInstances')).toBe(false);
  });
});
