// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  SessionTitler,
  generateTitleWithClaude,
  parseTitleOutput,
  placeholderTitle,
} from '../../orchestrator/services/sessionTitle.js';

const envelope = (result: unknown, isError = false) => JSON.stringify({ type: 'result', is_error: isError, result });

describe('placeholderTitle', () => {
  it('collapses whitespace and cuts a long prompt with an ellipsis', () => {
    expect(placeholderTitle('  fix\n\nthe   sidebar ')).toBe('fix the sidebar');
    const long = placeholderTitle('When I switch projects in instances module and any session is open');
    expect(long!.length).toBeLessThanOrEqual(40);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('skips slash commands and empty prompts', () => {
    expect(placeholderTitle('/sync-meetings 2026-10-27')).toBeNull();
    expect(placeholderTitle('   ')).toBeNull();
  });
});

describe('parseTitleOutput', () => {
  it('takes the result text, without quotes or a trailing period', () => {
    expect(parseTitleOutput(envelope('"Fix sidebar auto-open."'))).toBe('Fix sidebar auto-open');
    expect(parseTitleOutput(envelope('Session name in pane bar\n'))).toBe('Session name in pane bar');
  });

  it('returns null for an error, a non-string result or broken JSON', () => {
    expect(parseTitleOutput(envelope('rate limited', true))).toBeNull();
    expect(parseTitleOutput(envelope({ x: 1 }))).toBeNull();
    expect(parseTitleOutput(envelope('  '))).toBeNull();
    expect(parseTitleOutput('not json')).toBeNull();
  });
});

describe('SessionTitler', () => {
  const setup = (initial: string | null | undefined, generate: (p: string) => Promise<string | null>) => {
    const titles = new Map<string, string | null>();
    if (initial !== undefined) titles.set('i1', initial);
    const writes: string[] = [];
    const titler = new SessionTitler({
      getTitle: (id) => titles.get(id),
      setTitle: (id, t) => { titles.set(id, t); writes.push(t); },
      generate,
    });
    return { titler, titles, writes };
  };

  it('shows the placeholder, then replaces it with the generated name', async () => {
    const { titler, writes } = setup(null, async () => 'Fix sidebar auto-open');
    await titler.onPrompt('i1', 'the sidebar opens by itself, fix it');
    expect(writes).toEqual(['the sidebar opens by itself, fix it', 'Fix sidebar auto-open']);
  });

  it('names a session once: later prompts and named or unknown instances do nothing', async () => {
    let calls = 0;
    const gen = async () => { calls++; return 'Name'; };
    const fresh = setup(null, gen);
    await fresh.titler.onPrompt('i1', 'first');
    await fresh.titler.onPrompt('i1', 'second');
    expect(fresh.writes).toEqual(['first', 'Name']);
    await setup('Already named', gen).titler.onPrompt('i1', 'x');
    await setup(undefined, gen).titler.onPrompt('i1', 'x');
    expect(calls).toBe(1);
  });

  it('waits past a slash command for the first real prompt', async () => {
    const { titler, writes } = setup(null, async () => 'Name');
    await titler.onPrompt('i1', '/sync-meetings');
    expect(writes).toEqual([]);
    await titler.onPrompt('i1', 'now a real task');
    expect(writes).toEqual(['now a real task', 'Name']);
  });

  it('keeps the placeholder when generation fails or throws', async () => {
    const nothing = setup(null, async () => null);
    await nothing.titler.onPrompt('i1', 'do a thing');
    expect(nothing.titles.get('i1')).toBe('do a thing');
    const boom = setup(null, async () => { throw new Error('spawn ENOENT'); });
    await boom.titler.onPrompt('i1', 'do a thing');
    expect(boom.titles.get('i1')).toBe('do a thing');
  });
});

describe('generateTitleWithClaude', () => {
  it('runs an isolated Haiku call outside any Watchtower instance', async () => {
    process.env.WATCHTOWER_INSTANCE_ID = 'leaked';
    let seen: { bin: string; args: string[]; env?: NodeJS.ProcessEnv } | null = null;
    const title = await generateTitleWithClaude('fix the sidebar', async (bin, args, _cwd, opts) => {
      seen = { bin, args, env: opts.env };
      return { stdout: envelope('Fix sidebar'), stderr: '', code: 0, signal: null, aborted: false };
    });
    delete process.env.WATCHTOWER_INSTANCE_ID;
    expect(title).toBe('Fix sidebar');
    expect(seen!.args).toEqual(expect.arrayContaining(['--model', 'haiku', '--tools', '', '--setting-sources', '']));
    expect(seen!.args[seen!.args.indexOf('-p') + 1]).toContain('fix the sidebar');
    expect(seen!.env?.WATCHTOWER_INSTANCE_ID).toBeUndefined();
  });

  it('gives up on a timeout', async () => {
    const title = await generateTitleWithClaude('x', async () => ({ stdout: '', stderr: '', code: null, signal: 'SIGKILL', aborted: true }));
    expect(title).toBeNull();
  });
});
