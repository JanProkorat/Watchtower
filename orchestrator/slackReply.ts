export interface InboundMessage {
  channel: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export interface ReplyDeps {
  dmChannelId: string | null;
  resolveInstance(threadTs: string): string | null;
  deliver(instanceId: string, text: string): void;
  ack(channel: string, ts: string): void;
}

/** Decide whether an inbound Slack message is a routable reply; route it if so. */
export function routeReply(msg: InboundMessage, deps: ReplyDeps): boolean {
  if (msg.bot_id || msg.subtype) return false;
  if (!deps.dmChannelId || msg.channel !== deps.dmChannelId) return false;
  if (!msg.text.trim()) return false;
  const key = msg.thread_ts ?? msg.ts;
  const instanceId = deps.resolveInstance(key);
  if (!instanceId) return false;
  deps.deliver(instanceId, msg.text);
  deps.ack(msg.channel, key);
  return true;
}
