export interface MessagingReplyDeps {
  deliver(instanceId: string, text: string): boolean; // = deliverReply in orchestrator/index.ts
  markAnswered(instanceId: string): void;
}

export function routeMessagingReply(
  msg: { instanceId: string; text: string },
  deps: MessagingReplyDeps,
): boolean {
  const delivered = deps.deliver(msg.instanceId, msg.text);
  if (delivered) deps.markAnswered(msg.instanceId);
  return delivered;
}
