import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { ChatPermissionMode, ChatResponse, ChatSnapshot } from '@watchtower/shared/chat.js';
import { ChatSession, type ChatSessionDeps } from './chatSession.js';

export interface ChatManagerDeps extends Omit<ChatSessionDeps, 'query' | 'sessionExists' | 'loadHistory' | 'claudePath'> {
  /** Defaults load the Agent SDK lazily, so non-chat runs never import it. */
  sdk?: Pick<ChatSessionDeps, 'query' | 'sessionExists' | 'loadHistory'>;
  claudePath?: () => string | undefined;
  /** The instance's cwd, or null when no such chat instance exists. */
  cwdOf(instanceId: string): string | null;
}

/** All chat instances' sessions, created on first use per instance. */
export class ChatManager {
  private sessions = new Map<string, ChatSession>();
  private sdk: Promise<Pick<ChatSessionDeps, 'query' | 'sessionExists' | 'loadHistory'>> | null = null;

  constructor(private readonly deps: ChatManagerDeps) {}

  async snapshot(instanceId: string): Promise<ChatSnapshot | null> {
    const s = await this.session(instanceId);
    return s ? s.snapshot() : null;
  }

  async send(instanceId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const s = await this.session(instanceId);
    if (!s) return { ok: false, error: 'No such chat' };
    if (!text.trim()) return { ok: false, error: 'Empty message' };
    try {
      await s.send(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async interrupt(instanceId: string): Promise<void> {
    await this.sessions.get(instanceId)?.interrupt();
  }

  async respond(instanceId: string, itemId: string, response: ChatResponse): Promise<boolean> {
    return this.sessions.get(instanceId)?.respond(itemId, response) ?? false;
  }

  async setPermissionMode(instanceId: string, mode: ChatPermissionMode): Promise<void> {
    await (await this.session(instanceId))?.setPermissionMode(mode);
  }

  async setModel(instanceId: string, model: string | null): Promise<void> {
    await (await this.session(instanceId))?.setModel(model);
  }

  /** Ends the instance's CLI process; the transcript stays on disk for a later resume. */
  dispose(instanceId: string): void {
    this.sessions.get(instanceId)?.dispose();
    this.sessions.delete(instanceId);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id);
  }

  private async session(instanceId: string): Promise<ChatSession | null> {
    const existing = this.sessions.get(instanceId);
    if (existing) return existing;
    const cwd = this.deps.cwdOf(instanceId);
    if (cwd === null) return null;
    const sdk = await this.loadSdk();
    // Another caller may have created it while the SDK loaded.
    const raced = this.sessions.get(instanceId);
    if (raced) return raced;
    const s = new ChatSession(instanceId, cwd, {
      ...sdk,
      claudePath: this.deps.claudePath ?? findOnPath,
      env: this.deps.env,
      emit: this.deps.emit,
      onActivity: this.deps.onActivity,
    });
    this.sessions.set(instanceId, s);
    return s;
  }

  private loadSdk(): Promise<Pick<ChatSessionDeps, 'query' | 'sessionExists' | 'loadHistory'>> {
    if (this.deps.sdk) return Promise.resolve(this.deps.sdk);
    this.sdk ??= import('@anthropic-ai/claude-agent-sdk').then((m) => ({
      query: (params) => m.query(params),
      sessionExists: async (id, cwd) => (await m.getSessionInfo(id, { dir: cwd })) !== undefined,
      loadHistory: (id, cwd) => m.getSessionMessages(id, { dir: cwd }),
    }));
    return this.sdk;
  }
}

/**
 * The user's `claude` on PATH — the one their terminal instances run, with
 * their login — or undefined, which makes the SDK use its bundled build.
 */
export function findOnPath(name = 'claude', pathVar = process.env.PATH ?? ''): string | undefined {
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* not here */
    }
  }
  return undefined;
}
