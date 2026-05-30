import { SocketModeClient } from '@slack/socket-mode';
import { routeReply, type InboundMessage, type ReplyDeps } from './slackReply.js';

/**
 * Owns the Socket Mode websocket. On each DM message it runs the pure
 * `routeReply` against the injected deps. `start()` is idempotent: calling it
 * again tears down the previous socket first (used when the app token changes).
 */
export class SlackListener {
  private client: SocketModeClient | null = null;
  private connected = false;

  constructor(private deps: ReplyDeps) {}

  isConnected(): boolean {
    return this.connected;
  }

  setDmChannel(channel: string | null): void {
    this.deps.dmChannelId = channel;
  }

  async start(appToken: string): Promise<void> {
    await this.stop();
    if (!appToken) return;
    const client = new SocketModeClient({ appToken });
    client.on('connected', () => { this.connected = true; });
    client.on('disconnected', () => { this.connected = false; });
    // DM messages arrive via events_api, which emits as the inner event type.
    // The payload shape is: { ack: () => Promise<void>, event: <the Slack event object>, ... }
    client.on('message', async (args: { event: unknown; ack: () => Promise<void> }) => {
      await args.ack();
      try {
        routeReply(args.event as InboundMessage, this.deps);
      } catch (err) {
        console.error('[slack] routeReply failed', err);
      }
    });
    this.client = client;
    await client.start();
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.disconnect(); } catch { /* best effort */ }
      this.client = null;
    }
    this.connected = false;
  }
}
