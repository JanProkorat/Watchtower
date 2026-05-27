import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mergePaths,
  readShellPath,
  applyUserShellPath,
  type ShellRunner,
} from '../../electron/shellPath.js';

describe('mergePaths', () => {
  it('prepends shell PATH and dedupes overlap with current PATH', () => {
    const out = mergePaths('/usr/local/bin:/opt/homebrew/bin', '/usr/bin:/bin:/opt/homebrew/bin');
    expect(out).toBe('/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin');
  });

  it('preserves the shell PATH order even when current PATH lists the same dirs first', () => {
    const out = mergePaths('/a:/b:/c', '/c:/b:/a');
    expect(out).toBe('/a:/b:/c');
  });

  it('skips empty segments from trailing colons or empty inputs', () => {
    expect(mergePaths('/a::/b:', '')).toBe('/a:/b');
    expect(mergePaths('', '/x:/y')).toBe('/x:/y');
    expect(mergePaths('', '')).toBe('');
  });
});

describe('readShellPath', () => {
  it('extracts the PATH from between the delimiters', () => {
    const runner: ShellRunner = (shell, script) => {
      expect(shell).toBe('/bin/zsh');
      expect(script).toContain('printf');
      return 'Last login: …\n__WT_PATH_DELIM__/Users/jan/.local/bin:/usr/bin__WT_PATH_DELIM__';
    };
    expect(readShellPath('/bin/zsh', runner)).toBe('/Users/jan/.local/bin:/usr/bin');
  });

  it('returns null when the shell call fails', () => {
    expect(readShellPath('/bin/zsh', () => null)).toBeNull();
  });

  it('returns null when the delimited payload is missing or empty', () => {
    expect(readShellPath('/bin/zsh', () => 'no delimiter here')).toBeNull();
    expect(readShellPath('/bin/zsh', () => '__WT_PATH_DELIM__')).toBeNull();
    expect(readShellPath('/bin/zsh', () => '__WT_PATH_DELIM____WT_PATH_DELIM__')).toBeNull();
  });
});

describe('applyUserShellPath', () => {
  let savedPath: string | undefined;
  let savedShell: string | undefined;

  beforeEach(() => {
    savedPath = process.env.PATH;
    savedShell = process.env.SHELL;
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = savedShell;
  });

  it('prepends the shell PATH and returns true when PATH actually changed', () => {
    process.env.PATH = '/usr/bin:/bin';
    process.env.SHELL = '/bin/zsh';
    const runner: ShellRunner = () =>
      '__WT_PATH_DELIM__/Users/jan/.local/bin:/usr/local/bin__WT_PATH_DELIM__';
    const changed = applyUserShellPath(runner);
    expect(changed).toBe(true);
    expect(process.env.PATH).toBe('/Users/jan/.local/bin:/usr/local/bin:/usr/bin:/bin');
  });

  it('returns false and leaves PATH untouched when the shell call fails', () => {
    process.env.PATH = '/usr/bin:/bin';
    const changed = applyUserShellPath(() => null);
    expect(changed).toBe(false);
    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });

  it('returns false when the shell PATH is already a subset of current PATH', () => {
    process.env.PATH = '/a:/b:/c';
    const runner: ShellRunner = () => '__WT_PATH_DELIM__/a:/b__WT_PATH_DELIM__';
    const changed = applyUserShellPath(runner);
    expect(changed).toBe(false);
    expect(process.env.PATH).toBe('/a:/b:/c');
  });
});
