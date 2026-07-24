import { describe, it, expect } from 'vitest';
import { buildPtySpawnConfig, planBootAction } from '../../orchestrator/shellPolicy.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';

describe('buildPtySpawnConfig', () => {
  it('claude: --session-id <id> and injects WATCHTOWER_INSTANCE_ID', () => {
    const c = buildPtySpawnConfig({ kind: 'claude', id: 'abc', extraArgs: [], env: { PATH: '/usr/bin' } });
    expect(c.command).toBe('claude');
    expect(c.args).toEqual(['--session-id', 'abc']);
    expect(c.env.WATCHTOWER_INSTANCE_ID).toBe('abc');
  });

  it('claude: --resume when resumeSessionId is present, keeps extraArgs', () => {
    const c = buildPtySpawnConfig({ kind: 'claude', id: 'abc', extraArgs: ['--foo'], resumeSessionId: 'sess9', env: {} });
    expect(c.args).toEqual(['--resume', 'sess9', '--foo']);
  });

  it('shell: uses $SHELL as a login shell and OMITS WATCHTOWER_INSTANCE_ID', () => {
    const c = buildPtySpawnConfig({
      kind: 'shell',
      id: 'sh1',
      extraArgs: [],
      env: { SHELL: '/bin/fish', WATCHTOWER_INSTANCE_ID: 'leaked' },
    });
    expect(c.command).toBe('/bin/fish');
    expect(c.args).toEqual(['-l']);
    expect('WATCHTOWER_INSTANCE_ID' in c.env).toBe(false);
  });

  it('shell: falls back to /bin/zsh when $SHELL is empty/unset', () => {
    expect(buildPtySpawnConfig({ kind: 'shell', id: 's', extraArgs: [], env: {} }).command).toBe('/bin/zsh');
    expect(buildPtySpawnConfig({ kind: 'shell', id: 's', extraArgs: [], env: { SHELL: '  ' } }).command).toBe('/bin/zsh');
  });

  it('does NOT mutate the caller-supplied env (regression guard: must never corrupt process.env)', () => {
    const e = { SHELL: '/bin/zsh', WATCHTOWER_INSTANCE_ID: 'keep-me' };
    buildPtySpawnConfig({ kind: 'shell', id: 's', extraArgs: [], env: e });
    // The shell branch deletes WATCHTOWER_INSTANCE_ID from its OWN copy only.
    expect(e.WATCHTOWER_INSTANCE_ID).toBe('keep-me');
  });
});

describe('planBootAction', () => {
  const row = (over: Partial<InstanceRow>): InstanceRow => ({
    id: 'i', cwd: '/tmp', status: 'working', claudeSessionId: 'sess', spawnedAt: 1,
    lastActivityAt: 1, exitCode: null, terminationReason: null, resumedFromInstanceId: null,
    jiraKeyHint: null, argsJson: null, kind: 'claude', taskId: null, background: false, ...over,
  });

  it('live shell → respawn-shell', () => {
    expect(planBootAction(row({ kind: 'shell', status: 'working' }))).toBe('respawn-shell');
  });
  it('crashed shell → leave (keep the restart button)', () => {
    expect(planBootAction(row({ kind: 'shell', status: 'crashed' }))).toBe('leave');
  });
  it('finished claude → leave', () => {
    expect(planBootAction(row({ status: 'finished' }))).toBe('leave');
  });
  it('user-killed claude → leave', () => {
    expect(planBootAction(row({ terminationReason: 'user-kill' }))).toBe('leave');
  });
  it('claude with no session id → crash', () => {
    expect(planBootAction(row({ claudeSessionId: null }))).toBe('crash');
  });
  it('claude with session id → resume', () => {
    expect(planBootAction(row({ claudeSessionId: 'sess' }))).toBe('resume');
  });
});
