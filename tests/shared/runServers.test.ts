import { describe, it, expect } from 'vitest';
import { RUN_LOG_LINES, appendLog, parseRunConfig } from '@watchtower/shared/runServers.js';

const ok = (raw: unknown) => {
  const r = parseRunConfig(raw);
  if ('error' in r) throw new Error(r.error);
  return r.servers;
};
const err = (raw: unknown) => {
  const r = parseRunConfig(raw);
  return 'error' in r ? r.error : null;
};

describe('parseRunConfig', () => {
  it('fills defaults: label from id, cwd ".", no port / ready / url', () => {
    expect(ok({ servers: [{ id: 'web', command: ['npm', 'run', 'dev'] }] })).toEqual([
      { id: 'web', label: 'web', cwd: '.', command: ['npm', 'run', 'dev'], port: null, ready: null, url: null },
    ]);
  });

  it('keeps every declared field', () => {
    const [s] = ok({
      servers: [{ id: 'api', label: 'API', cwd: 'backend/App', command: ['dotnet', 'run'], port: 5001, ready: 'Now listening on', url: 'http://localhost:5001' }],
    });
    expect(s).toMatchObject({ label: 'API', cwd: 'backend/App', port: 5001, ready: 'Now listening on', url: 'http://localhost:5001' });
  });

  it('names the first problem', () => {
    expect(err({})).toMatch(/"servers" array/);
    expect(err({ servers: [{ command: ['x'] }] })).toMatch(/servers\[0\] needs an "id"/);
    expect(err({ servers: [{ id: 'a', command: 'npm run dev' }] })).toMatch(/"command" array/);
    expect(err({ servers: [{ id: 'a', command: [] }] })).toMatch(/"command" array/);
    expect(err({ servers: [{ id: 'a', command: ['x'] }, { id: 'a', command: ['y'] }] })).toMatch(/used twice/);
    expect(err({ servers: [{ id: 'a', command: ['x'], port: 70000 }] })).toMatch(/port/);
    expect(err({ servers: [{ id: 'a', command: ['x'], ready: '(' }] })).toMatch(/regular expression/);
  });

  it('keeps cwd inside the repo', () => {
    expect(err({ servers: [{ id: 'a', command: ['x'], cwd: '/etc' }] })).toMatch(/inside the repo/);
    expect(err({ servers: [{ id: 'a', command: ['x'], cwd: 'web/../../x' }] })).toMatch(/inside the repo/);
  });
});

describe('appendLog', () => {
  it('strips colors and blank lines and splits on any line break', () => {
    expect(appendLog(['a'], '\u001b[32mVITE\u001b[0m ready\r\n\n  \rnext\n')).toEqual(['a', 'VITE ready', 'next']);
  });

  it('keeps only the newest lines', () => {
    const log = appendLog([], Array.from({ length: RUN_LOG_LINES + 5 }, (_, i) => `l${i}`).join('\n'));
    expect(log).toHaveLength(RUN_LOG_LINES);
    expect(log[0]).toBe('l5');
  });
});
