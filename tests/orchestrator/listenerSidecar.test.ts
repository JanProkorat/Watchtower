import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeListenerSidecar, readListenerSidecar } from '../../orchestrator/listenerSidecar.js';

describe('listenerSidecar', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  });

  it('round-trips port + token + writtenAt', () => {
    const file = path.join(dir, 'listener.json');
    writeListenerSidecar(file, { port: 7421, token: 'secret', writtenAt: 100 });
    expect(readListenerSidecar(file)).toEqual({ port: 7421, token: 'secret', writtenAt: 100 });
  });

  it('writes with chmod 600 (file is not world-readable)', () => {
    const file = path.join(dir, 'listener.json');
    writeListenerSidecar(file, { port: 7421, token: 'secret', writtenAt: 100 });
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null for missing file', () => {
    expect(readListenerSidecar(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const file = path.join(dir, 'listener.json');
    writeFileSync(file, 'not json');
    expect(readListenerSidecar(file)).toBeNull();
  });

  it('returns null for JSON missing required fields', () => {
    const file = path.join(dir, 'listener.json');
    writeFileSync(file, JSON.stringify({ port: 7421 })); // missing token
    expect(readListenerSidecar(file)).toBeNull();
  });
});
