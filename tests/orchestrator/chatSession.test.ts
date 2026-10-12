import { describe, it, expect, vi } from 'vitest';
import type { CanUseTool, Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent, ChatItem } from '@watchtower/shared/chat.js';
import { ChatSession, type ChatActivity, type ChatSessionDeps } from '../../orchestrator/services/chat/chatSession.js';
import { ChatManager, findOnPath } from '../../orchestrator/services/chat/chatManager.js';
import { AsyncQueue } from '../../orchestrator/services/chat/asyncQueue.js';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A stand-in for the SDK's Query: the test feeds it messages and reads what it was sent. */
class FakeQuery {
  sent: SDKUserMessage[] = [];
  interrupt = vi.fn(async () => undefined);
  setPermissionMode = vi.fn(async () => undefined);
  setModel = vi.fn(async () => undefined);
  close = vi.fn(() => this.end());
  supportedModels = vi.fn(async () => [{ value: 'opus', displayName: 'Opus', description: 'Most capable' }]);
  private buf: SDKMessage[] = [];
  private waiters: Array<{ resolve(r: IteratorResult<SDKMessage>): void; reject(e: unknown): void }> = [];
  private finished = false;
  private failure: unknown = null;
  constructor(readonly options: Options, prompt: AsyncIterable<SDKUserMessage>) {
    void (async () => {
      for await (const m of prompt) this.sent.push(m);
    })();
  }
  /** The SDK yields a message. */
  emit(msg: object) {
    const w = this.waiters.shift();
    if (w) w.resolve({ value: msg as SDKMessage, done: false });
    else this.buf.push(msg as SDKMessage);
  }
  /** The CLI process exits cleanly. */
  end() {
    this.finished = true;
    for (const w of this.waiters.splice(0)) w.resolve({ value: undefined as never, done: true });
  }
  /** The CLI process dies: the iterator throws. */
  fail(err: Error) {
    this.failure = err;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        if (this.buf.length) return Promise.resolve({ value: this.buf.shift()!, done: false });
        if (this.failure) return Promise.reject(this.failure);
        if (this.finished) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { exists?: boolean } = {}) {
  const queries: FakeQuery[] = [];
  const events: ChatEvent[] = [];
  const activity: ChatActivity[] = [];
  const deps: ChatSessionDeps = {
    query: ({ prompt, options }) => {
      const q = new FakeQuery(options, prompt);
      queries.push(q);
      return q as unknown as Query;
    },
    sessionExists: async () => opts.exists ?? false,
    loadHistory: async () => [],
    claudePath: () => '/usr/local/bin/claude',
    env: (id) => ({ WATCHTOWER_INSTANCE_ID: id }),
    emit: (e) => events.push(e),
    onActivity: (_id, a) => activity.push(a),
  };
  const session = new ChatSession('inst-1', '/repo', deps);
  const items = () => session.transcript.list();
  const lastState = () => [...events].reverse().find((e) => e.op === 'state') as Extract<ChatEvent, { op: 'state' }> | undefined;
  return { session, queries, events, activity, items, lastState };
}

/** Calls the session's canUseTool the way the SDK would. */
function askPermission(q: FakeQuery, tool: string, input: Record<string, unknown>, extra: object = {}) {
  const abort = new AbortController();
  const result = (q.options.canUseTool as CanUseTool)(tool, input, { signal: abort.signal, ...extra } as Parameters<CanUseTool>[2]);
  return { result: result as Promise<PermissionResult>, abort };
}

const pendingOf = (items: ChatItem[], kind: 'permission' | 'question') => items.find((i) => i.kind === kind && i.status === 'pending')!;

describe('ChatSession', () => {
  it('starts the SDK on the first message with the session id = instance id and the user setup', async () => {
    const { session, queries, items, activity, lastState } = setup();
    await session.send('hello');
    await tick();
    expect(queries).toHaveLength(1);
    const o = queries[0]!.options;
    expect(o).toMatchObject({
      cwd: '/repo',
      sessionId: 'inst-1',
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      permissionMode: 'default',
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      env: { WATCHTOWER_INSTANCE_ID: 'inst-1' },
    });
    expect(o.resume).toBeUndefined();
    expect(queries[0]!.sent.map((m) => m.message.content)).toEqual(['hello']);
    expect(items()).toEqual([expect.objectContaining({ kind: 'user', text: 'hello' })]);
    expect(activity).toEqual(['working']);
    expect(lastState()?.state).toMatchObject({ busy: true, live: true, models: [{ value: 'opus', label: 'Opus', description: 'Most capable' }] });
  });

  it('resumes a session that already has a transcript, and reuses one process for later sends', async () => {
    const { session, queries } = setup({ exists: true });
    await session.send('one');
    await session.send('two');
    await tick();
    expect(queries).toHaveLength(1);
    expect(queries[0]!.options).toMatchObject({ resume: 'inst-1' });
    expect(queries[0]!.options.sessionId).toBeUndefined();
    expect(queries[0]!.sent.map((m) => m.message.content)).toEqual(['one', 'two']);
  });

  it('ends a turn on its result: not busy, reported as done', async () => {
    const { session, queries, activity, lastState } = setup();
    await session.send('hi');
    queries[0]!.emit({ type: 'result', subtype: 'success', uuid: 'r', is_error: false, duration_ms: 1, total_cost_usd: 0 });
    await tick();
    expect(lastState()?.state.busy).toBe(false);
    expect(activity).toEqual(['working', 'turn-done']);
  });

  it('stays busy while further sends are queued behind the finished turn', async () => {
    const { session, queries, lastState } = setup();
    await session.send('hi');
    queries[0]!.emit({ type: 'result', subtype: 'success', uuid: 'r', is_error: false, duration_ms: 1, total_cost_usd: 0, queued_turn_count: 1 });
    await tick();
    expect(lastState()?.state.busy).toBe(true);
  });

  it('asks permission inline and allows once', async () => {
    const { session, queries, items, activity } = setup();
    await session.send('edit it');
    const input = { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' };
    const { result } = askPermission(queries[0]!, 'Edit', input, { title: 'Claude wants to edit a.ts', suggestions: [{ type: 'addRules' }] });
    const item = pendingOf(items(), 'permission');
    expect(item).toMatchObject({ toolName: 'Edit', input, title: 'Claude wants to edit a.ts', canAlwaysAllow: true });
    expect(activity).toContain('waiting-permission');
    expect(session.respond(item.id, { kind: 'permission', decision: 'allow' })).toBe(true);
    expect(await result).toEqual({ behavior: 'allow', updatedInput: input });
    expect(session.transcript.get(item.id)).toMatchObject({ status: 'allowed' });
    expect(activity[activity.length - 1]).toBe('working');
  });

  it('"Always allow" hands back the suggested permission rules', async () => {
    const { session, queries, items } = setup();
    await session.send('x');
    const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
    const { result } = askPermission(queries[0]!, 'Bash', { command: 'npm test' }, { suggestions });
    session.respond(pendingOf(items(), 'permission').id, { kind: 'permission', decision: 'allowAlways' });
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' }, updatedPermissions: suggestions });
  });

  it('denies with the given message, or a default', async () => {
    const { session, queries, items } = setup();
    await session.send('x');
    const { result } = askPermission(queries[0]!, 'Bash', { command: 'rm -rf /' });
    const id = pendingOf(items(), 'permission').id;
    session.respond(id, { kind: 'permission', decision: 'deny' });
    expect(await result).toEqual({ behavior: 'deny', message: 'The user declined this action.' });
    expect(session.transcript.get(id)).toMatchObject({ status: 'denied' });
    // Answering twice does nothing.
    expect(session.respond(id, { kind: 'permission', decision: 'allow' })).toBe(false);
  });

  it("answers Claude's questions by passing the answers back as tool input", async () => {
    const { session, queries, items } = setup();
    await session.send('x');
    const input = {
      questions: [{ question: 'Tea or coffee?', header: 'Drink', multiSelect: false, options: [{ label: 'Tea', description: 'Leaves' }, { label: 'Coffee', description: 'Beans' }] }],
    };
    const { result } = askPermission(queries[0]!, 'AskUserQuestion', input);
    const q = pendingOf(items(), 'question');
    expect(q).toMatchObject({ questions: [{ question: 'Tea or coffee?', header: 'Drink', multiSelect: false, options: [{ label: 'Tea', description: 'Leaves' }, { label: 'Coffee', description: 'Beans' }] }] });
    session.respond(q.id, { kind: 'question', answers: { 'Tea or coffee?': 'Coffee' } });
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Tea or coffee?': 'Coffee' } } });
    expect(session.transcript.get(q.id)).toMatchObject({ status: 'answered', answers: { 'Tea or coffee?': 'Coffee' } });
  });

  it('a skipped question is denied', async () => {
    const { session, queries, items } = setup();
    await session.send('x');
    const { result } = askPermission(queries[0]!, 'AskUserQuestion', { questions: [] });
    session.respond(pendingOf(items(), 'question').id, { kind: 'question', cancel: true });
    expect(await result).toMatchObject({ behavior: 'deny' });
  });

  it('cancels a prompt the SDK aborts, and on interrupt', async () => {
    const { session, queries, items } = setup();
    await session.send('x');
    const a = askPermission(queries[0]!, 'Bash', { command: 'a' });
    const aId = pendingOf(items(), 'permission').id;
    a.abort.abort();
    expect(await a.result).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(session.transcript.get(aId)).toMatchObject({ status: 'cancelled' });

    const b = askPermission(queries[0]!, 'Bash', { command: 'b' });
    await session.interrupt();
    expect(await b.result).toMatchObject({ behavior: 'deny' });
    expect(queries[0]!.interrupt).toHaveBeenCalled();
  });

  it('forwards mode and model changes to the live process, and remembers them for the next one', async () => {
    const { session, queries } = setup();
    await session.setPermissionMode('acceptEdits');
    await session.setModel('opus');
    await session.send('x');
    expect(queries[0]!.options).toMatchObject({ permissionMode: 'acceptEdits', model: 'opus' });
    await session.setPermissionMode('plan');
    await session.setModel(null);
    expect(queries[0]!.setPermissionMode).toHaveBeenCalledWith('plan');
    expect(queries[0]!.setModel).toHaveBeenCalledWith(undefined);
  });

  it('when the process ends, goes idle and starts a fresh (resuming) one on the next send', async () => {
    const { session, queries, lastState } = setup({ exists: true });
    await session.send('x');
    queries[0]!.end();
    await tick();
    expect(lastState()?.state).toMatchObject({ live: false, busy: false });
    await session.send('again');
    expect(queries).toHaveLength(2);
  });

  it('shows a crash as an error notice with the end of stderr, and goes idle', async () => {
    const { session, queries, items, lastState, activity } = setup();
    await session.send('x');
    const q = queries[0]!;
    (q.options.stderr as (d: string) => void)('starting\nfatal: not logged in\n');
    q.fail(new Error('Claude Code process exited with code 1'));
    await tick();
    const notice = items().find((i) => i.kind === 'notice');
    expect(notice).toMatchObject({ level: 'error' });
    expect(notice && 'text' in notice ? notice.text : '').toContain('exited with code 1');
    expect(notice && 'text' in notice ? notice.text : '').toContain('fatal: not logged in');
    expect(lastState()?.state).toMatchObject({ live: false, busy: false });
    expect(activity[activity.length - 1]).toBe('turn-done');
  });

  it('streams items to the renderer as they change', async () => {
    const { session, queries, events } = setup();
    await session.send('x');
    queries[0]!.emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hi' }] }, parent_tool_use_id: null, uuid: 'u', session_id: 's' });
    await tick();
    expect(events).toContainEqual({ instanceId: 'inst-1', op: 'upsert', item: { kind: 'assistant', id: 'm1:0', text: 'Hi', streaming: false } });
  });

  it('dispose closes the process and cancels what is pending', async () => {
    const { session, queries, items } = setup();
    await session.send('x');
    const { result } = askPermission(queries[0]!, 'Bash', { command: 'a' });
    expect(pendingOf(items(), 'permission')).toBeTruthy();
    session.dispose();
    expect(queries[0]!.close).toHaveBeenCalled();
    expect(await result).toMatchObject({ behavior: 'deny' });
  });
});

describe('ChatManager', () => {
  const sdk = () => {
    const queries: FakeQuery[] = [];
    return {
      queries,
      sdk: {
        query: ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
          const q = new FakeQuery(options, prompt);
          queries.push(q);
          return q as unknown as Query;
        },
        sessionExists: async () => false,
        loadHistory: async () => [],
      },
    };
  };

  it('only serves chat instances, and refuses empty messages', async () => {
    const { sdk: s, queries } = sdk();
    const m = new ChatManager({ sdk: s, cwdOf: (id) => (id === 'chat-1' ? '/repo' : null), env: () => ({}), emit: () => {}, onActivity: () => {}, claudePath: () => undefined });
    expect(await m.snapshot('pty-1')).toBeNull();
    expect(await m.send('pty-1', 'hi')).toEqual({ ok: false, error: 'No such chat' });
    expect(await m.send('chat-1', '   ')).toEqual({ ok: false, error: 'Empty message' });
    expect(await m.send('chat-1', 'hi')).toEqual({ ok: true });
    expect(queries).toHaveLength(1);
    expect(await m.respond('chat-1', 'nope', { kind: 'permission', decision: 'allow' })).toBe(false);
    m.dispose('chat-1');
    expect(queries[0]!.close).toHaveBeenCalled();
  });

  it('loads history into the first snapshot', async () => {
    const { sdk: s } = sdk();
    s.loadHistory = async () => [
      { type: 'user', uuid: 'u1', session_id: 's', message: { role: 'user', content: 'earlier' }, parent_tool_use_id: null, parent_agent_id: null },
    ];
    const m = new ChatManager({ sdk: s, cwdOf: () => '/repo', env: () => ({}), emit: () => {}, onActivity: () => {} });
    const snap = await m.snapshot('chat-1');
    expect(snap?.items).toEqual([{ kind: 'user', id: 'u1', text: 'earlier' }]);
    expect(snap?.state).toMatchObject({ busy: false, live: false, permissionMode: 'default', model: null });
  });
});

describe('findOnPath', () => {
  it('finds an executable on PATH, or nothing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wt-path-'));
    const bin = path.join(dir, 'claude');
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    expect(findOnPath('claude', `/nonexistent${path.delimiter}${dir}`)).toBe(bin);
    expect(findOnPath('claude', '/nonexistent')).toBeUndefined();
  });
});

describe('AsyncQueue', () => {
  it('delivers pushed values in order and finishes on end', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const got: number[] = [];
    const done = (async () => {
      for await (const v of q) got.push(v);
    })();
    q.push(2);
    await tick();
    q.end();
    q.push(3);
    await done;
    expect(got).toEqual([1, 2]);
  });
});
