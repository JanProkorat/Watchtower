import { WebClient, type KnownBlock } from '@slack/web-api';

export interface SlackPostResult {
  channel: string;
  ts: string;
}

export interface PostMessageOpts {
  threadTs?: string;
  /** Block Kit blocks (structurally `SlackBlock[]`). When present, `text` is the notification fallback. */
  blocks?: unknown[];
}

export interface SlackClient {
  /** Open (or fetch) the DM channel with the configured user; returns channel id. */
  openDm(userId: string): Promise<string>;
  postMessage(channel: string, text: string, opts?: PostMessageOpts): Promise<SlackPostResult>;
  updateMessage(channel: string, ts: string, text: string): Promise<void>;
  /** auth.test — confirms the bot token is valid. */
  testAuth(): Promise<{ ok: boolean; userId?: string; error?: string }>;
}

export class WebApiSlackClient implements SlackClient {
  private web: WebClient;
  constructor(botToken: string) {
    this.web = new WebClient(botToken);
  }

  async openDm(userId: string): Promise<string> {
    const res = await this.web.conversations.open({ users: userId });
    const channel = res.channel?.id;
    if (!channel) throw new Error('conversations.open returned no channel id');
    return channel;
  }

  async postMessage(channel: string, text: string, opts?: PostMessageOpts): Promise<SlackPostResult> {
    const res = await this.web.chat.postMessage({
      channel,
      text,
      thread_ts: opts?.threadTs,
      blocks: opts?.blocks as KnownBlock[] | undefined,
    });
    if (!res.ok || !res.ts) throw new Error(`chat.postMessage failed: ${res.error ?? 'unknown'}`);
    return { channel, ts: res.ts };
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    await this.web.chat.update({ channel, ts, text });
  }

  async testAuth(): Promise<{ ok: boolean; userId?: string; error?: string }> {
    try {
      const res = await this.web.auth.test();
      return { ok: Boolean(res.ok), userId: res.user_id as string | undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
