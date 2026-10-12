import { randomUUID } from 'node:crypto';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ChatEvent,
  ChatItem,
  ChatPermissionMode,
  ChatQuestion,
  ChatResponse,
  ChatSnapshot,
  ChatState,
} from '@watchtower/shared/chat.js';
import { AsyncQueue } from './asyncQueue.js';
import { ChatTranscript } from './transcript.js';

/** What a session reports to the instance state machine. */
export type ChatActivity = 'working' | 'waiting-permission' | 'turn-done';

export interface ChatSessionDeps {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query;
  /** A saved transcript exists for this session id (so start with `resume`). */
  sessionExists(sessionId: string, cwd: string): Promise<boolean>;
  loadHistory(sessionId: string, cwd: string): Promise<SessionMessage[]>;
  /** The user's `claude` executable, or undefined for the SDK's bundled one. */
  claudePath(): string | undefined;
  env(instanceId: string): Record<string, string | undefined>;
  emit(event: ChatEvent): void;
  onActivity(instanceId: string, activity: ChatActivity): void;
}

interface Pending {
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve(result: PermissionResult): void;
}

/**
 * One chat instance: a Claude Code session run through the Agent SDK in
 * streaming-input mode. The CLI process starts on the first message (resuming
 * the saved session when there is one) and lives until the instance is closed.
 * Its session id is the instance id, as the pty path's `--session-id` does, so
 * hooks, resume and the transcript file all line up.
 */
export class ChatSession {
  readonly transcript = new ChatTranscript();
  private state: ChatState = { busy: false, live: false, permissionMode: 'default', model: null, models: [] };
  private q: Query | null = null;
  private input: AsyncQueue<SDKUserMessage> | null = null;
  private pending = new Map<string, Pending>();
  private history: Promise<void> | null = null;
  private stderrTail: string[] = [];

  constructor(
    readonly instanceId: string,
    readonly cwd: string,
    private readonly deps: ChatSessionDeps,
  ) {}

  async snapshot(): Promise<ChatSnapshot> {
    await this.loadHistory();
    return { items: this.transcript.list(), state: this.state };
  }

  async send(text: string): Promise<void> {
    await this.loadHistory();
    this.push({ kind: 'user', id: randomUUID(), text });
    this.setState({ busy: true });
    this.deps.onActivity(this.instanceId, 'working');
    if (!this.q) await this.start();
    this.input?.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  }

  async interrupt(): Promise<void> {
    this.cancelPending('Interrupted');
    await this.q?.interrupt().catch(() => undefined);
  }

  async setPermissionMode(mode: ChatPermissionMode): Promise<void> {
    this.setState({ permissionMode: mode });
    await this.q?.setPermissionMode(mode).catch(() => undefined);
  }

  async setModel(model: string | null): Promise<void> {
    this.setState({ model });
    await this.q?.setModel(model ?? undefined).catch(() => undefined);
  }

  /** The user's answer to a pending permission or question item. False when nothing is waiting on it. */
  respond(itemId: string, response: ChatResponse): boolean {
    const p = this.pending.get(itemId);
    const item = this.transcript.get(itemId);
    if (!p || !item) return false;
    this.pending.delete(itemId);
    if (response.kind === 'permission' && item.kind === 'permission') {
      const allowed = response.decision !== 'deny';
      this.push({ ...item, status: allowed ? 'allowed' : 'denied' });
      p.resolve(
        allowed
          ? {
              behavior: 'allow',
              updatedInput: p.input,
              ...(response.decision === 'allowAlways' && p.suggestions ? { updatedPermissions: p.suggestions } : {}),
            }
          : { behavior: 'deny', message: response.message?.trim() || 'The user declined this action.' },
      );
    } else if (response.kind === 'question' && item.kind === 'question') {
      if ('cancel' in response) {
        this.push({ ...item, status: 'cancelled' });
        p.resolve({ behavior: 'deny', message: 'The user dismissed the question.' });
      } else {
        this.push({ ...item, status: 'answered', answers: response.answers });
        p.resolve({ behavior: 'allow', updatedInput: { ...p.input, answers: response.answers } });
      }
    } else {
      return false;
    }
    if (this.pending.size === 0) this.deps.onActivity(this.instanceId, 'working');
    return true;
  }

  dispose(): void {
    this.cancelPending('Session closed');
    const q = this.q;
    this.q = null;
    this.input?.end();
    this.input = null;
    try {
      q?.close();
    } catch {
      /* already gone */
    }
  }

  private async loadHistory(): Promise<void> {
    this.history ??= this.deps
      .loadHistory(this.instanceId, this.cwd)
      .then((messages) => this.transcript.applyHistory(messages))
      .catch((err: unknown) => {
        this.push({ kind: 'notice', id: 'history-error', level: 'error', text: `Couldn't load the earlier conversation: ${errorText(err)}` });
      });
    return this.history;
  }

  private async start(): Promise<void> {
    const resume = await this.deps.sessionExists(this.instanceId, this.cwd).catch(() => false);
    const input = new AsyncQueue<SDKUserMessage>();
    const q = this.deps.query({
      prompt: input,
      options: {
        cwd: this.cwd,
        ...(resume ? { resume: this.instanceId } : { sessionId: this.instanceId }),
        // The user's own setup: CLAUDE.md, settings, hooks, plugins and mods,
        // skills and MCP servers — the same as the terminal instances get.
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true,
        permissionMode: this.state.permissionMode,
        ...(this.state.model ? { model: this.state.model } : {}),
        canUseTool: this.canUseTool,
        pathToClaudeCodeExecutable: this.deps.claudePath(),
        env: this.deps.env(this.instanceId),
        stderr: (data) => {
          this.stderrTail = [...this.stderrTail, ...data.split('\n').filter(Boolean)].slice(-20);
        },
      },
    });
    this.q = q;
    this.input = input;
    this.setState({ live: true });
    void this.pump(q);
    void q
      .supportedModels()
      .then((models) =>
        this.setState({ models: models.map((m) => ({ value: m.value, label: m.displayName, description: m.description })) }),
      )
      .catch(() => undefined);
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const msg of q) this.onMessage(msg);
    } catch (err) {
      if (this.q === q) {
        const tail = this.stderrTail.slice(-5).join('\n');
        this.push({ kind: 'notice', id: `crash:${randomUUID()}`, level: 'error', text: `Claude Code stopped: ${errorText(err)}${tail ? `\n${tail}` : ''}` });
      }
    } finally {
      if (this.q === q) {
        // The process ended: the next message starts a fresh one (resuming).
        this.q = null;
        this.input?.end();
        this.input = null;
        this.cancelPending('Session ended');
        this.setState({ live: false, busy: false });
        this.deps.onActivity(this.instanceId, 'turn-done');
      }
    }
  }

  private onMessage(msg: SDKMessage): void {
    for (const item of this.transcript.apply(msg)) this.deps.emit({ instanceId: this.instanceId, op: 'upsert', item });
    // A send made mid-turn runs as a further turn: stay busy until the last one.
    if (msg.type === 'result' && !((msg.queued_turn_count ?? 0) > 0)) {
      this.setState({ busy: false });
      this.deps.onActivity(this.instanceId, 'turn-done');
    }
  }

  private canUseTool: CanUseTool = (toolName, input, opts) => {
    const id = randomUUID();
    if (toolName === 'AskUserQuestion') {
      this.push({ kind: 'question', id, questions: parseQuestions(input), status: 'pending' });
    } else {
      this.push({
        kind: 'permission',
        id,
        toolName,
        input,
        title: opts.title,
        description: opts.description ?? opts.decisionReason,
        canAlwaysAllow: !!opts.suggestions?.length,
        status: 'pending',
      });
    }
    this.deps.onActivity(this.instanceId, 'waiting-permission');
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, { input, suggestions: opts.suggestions, resolve });
      opts.signal.addEventListener('abort', () => this.cancelOne(id, 'Cancelled'), { once: true });
    });
  };

  private cancelPending(reason: string): void {
    for (const id of [...this.pending.keys()]) this.cancelOne(id, reason);
  }

  private cancelOne(id: string, reason: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    const item = this.transcript.get(id);
    if (item?.kind === 'permission' || item?.kind === 'question') this.push({ ...item, status: 'cancelled' } as ChatItem);
    p.resolve({ behavior: 'deny', message: reason, interrupt: true });
  }

  private push(item: ChatItem): void {
    this.transcript.upsert(item);
    this.deps.emit({ instanceId: this.instanceId, op: 'upsert', item });
  }

  private setState(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.emit({ instanceId: this.instanceId, op: 'state', state: this.state });
  }
}

function parseQuestions(input: Record<string, unknown>): ChatQuestion[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  return raw
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
    .map((q) => ({
      question: String(q.question ?? ''),
      header: String(q.header ?? ''),
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') })),
    }));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
