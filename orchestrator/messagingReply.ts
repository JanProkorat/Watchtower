export interface MessagingReplyDeps {
  deliver(instanceId: string, text: string): boolean; // = deliverSlackReply
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
