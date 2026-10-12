import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { upsertChatItem, type ChatItem } from '@watchtower/shared/chat.js';

/** Tool results beyond this many characters are cut for display. */
export const MAX_RESULT_CHARS = 20_000;

// Text Claude Code itself puts into user turns (slash-command echoes, local
// command output, reminders): part of the transcript file, not something the
// user typed, so history never shows it as a bubble.
const INTERNAL_USER_TEXT = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|bash-input|bash-stdout|bash-stderr)\b/;

type Block = { type: string; [k: string]: unknown };

const asBlocks = (content: unknown): Block[] =>
  Array.isArray(content) ? (content.filter((b) => b && typeof b === 'object') as Block[]) : [];

/** A tool_result's content as display text. */
export function toolResultText(content: unknown): string {
  let text: string;
  if (typeof content === 'string') text = content;
  else
    text = asBlocks(content)
      .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : b.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (${text.length - MAX_RESULT_CHARS} more characters)` : text;
}

/**
 * The conversation as chat items, built from the Agent SDK's message stream
 * (live, with partial messages) or from a saved session's messages (history).
 * `apply*` return the items they changed, for the caller to push.
 *
 * Text and thinking blocks are keyed `<message id>:<block index>`. While
 * streaming the index comes from the stream events; the complete assistant
 * messages that follow each carry one block, in order, so a per-message
 * counter recovers the same index. Tool calls are keyed by their tool_use id.
 * Subagent traffic (parent_tool_use_id set) stays out of the main thread.
 */
export class ChatTranscript {
  private items: ChatItem[] = [];
  private streamMessageId: string | null = null;
  private finalizedBlocks = new Map<string, number>();

  list(): ChatItem[] {
    return this.items;
  }

  get(id: string): ChatItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  upsert(item: ChatItem): ChatItem {
    this.items = upsertChatItem(this.items, item);
    return item;
  }

  /** One live SDK message → the items it changed. */
  apply(msg: SDKMessage): ChatItem[] {
    switch (msg.type) {
      case 'stream_event':
        return msg.parent_tool_use_id ? [] : this.applyStreamEvent(msg.event as unknown as Block);
      case 'assistant': {
        if (msg.parent_tool_use_id) return [];
        const out = this.applyAssistant(msg.message as unknown as { id: string; content: unknown });
        if (msg.error) out.push(this.upsert({ kind: 'notice', id: `error:${msg.uuid}`, level: 'error', text: assistantErrorText(msg.error) }));
        return out;
      }
      case 'user':
        // Our own sends are drawn when sent; only tool results come back here.
        return msg.parent_tool_use_id ? [] : this.applyToolResults(msg.message.content);
      case 'result':
        return [
          this.upsert({
            kind: 'result',
            id: `result:${msg.uuid}`,
            isError: msg.is_error,
            durationMs: msg.duration_ms,
            costUsd: msg.total_cost_usd,
            errors: msg.subtype === 'success' ? [] : msg.errors,
          }),
        ];
      case 'system':
        if (msg.subtype === 'compact_boundary')
          return [this.upsert({ kind: 'notice', id: `compact:${msg.uuid}`, level: 'info', text: 'Conversation compacted' })];
        if (msg.subtype === 'local_command_output')
          return [this.upsert({ kind: 'notice', id: `local:${msg.uuid}`, level: 'info', text: msg.content })];
        return [];
      default:
        return [];
    }
  }

  /** A saved session's messages (oldest first) → items, replacing nothing already shown. */
  applyHistory(messages: SessionMessage[]): void {
    for (const m of messages) {
      if (m.parent_tool_use_id) continue;
      const message = m.message as { id?: string; role?: string; content?: unknown } | null;
      if (!message) continue;
      if (m.type === 'assistant' && message.id) {
        this.applyAssistant({ id: message.id, content: message.content });
      } else if (m.type === 'user') {
        this.applyToolResults(message.content);
        const text =
          typeof message.content === 'string'
            ? message.content
            : asBlocks(message.content)
                .filter((b) => b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text as string)
                .join('\n');
        if (text.trim() && !INTERNAL_USER_TEXT.test(text)) this.upsert({ kind: 'user', id: m.uuid, text });
      }
    }
    // Anything still open in a saved session will never finish.
    for (const item of this.items) {
      if (item.kind === 'tool' && item.status === 'running') this.upsert({ ...item, status: 'error', result: item.result ?? 'Interrupted' });
    }
  }

  private applyStreamEvent(event: Block): ChatItem[] {
    if (event.type === 'message_start') {
      this.streamMessageId = ((event.message as { id?: string } | undefined)?.id) ?? null;
      return [];
    }
    const msgId = this.streamMessageId;
    if (!msgId) return [];
    const index = event.index as number;
    const key = `${msgId}:${index}`;
    if (event.type === 'content_block_start') {
      const block = event.content_block as Block;
      if (block.type === 'text') return [this.upsert({ kind: 'assistant', id: key, text: '', streaming: true })];
      if (block.type === 'thinking') return [this.upsert({ kind: 'thinking', id: key, text: '', streaming: true })];
      if (block.type === 'tool_use' && typeof block.id === 'string')
        return [this.upsert({ kind: 'tool', id: block.id, name: String(block.name ?? ''), input: {}, status: 'running' })];
      return [];
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta as Block;
      const item = this.get(key);
      if (delta.type === 'text_delta' && item?.kind === 'assistant')
        return [this.upsert({ ...item, text: item.text + String(delta.text ?? '') })];
      if (delta.type === 'thinking_delta' && item?.kind === 'thinking')
        return [this.upsert({ ...item, text: item.text + String(delta.thinking ?? '') })];
    }
    return [];
  }

  private applyAssistant(message: { id: string; content: unknown }): ChatItem[] {
    const out: ChatItem[] = [];
    for (const block of asBlocks(message.content)) {
      const index = this.finalizedBlocks.get(message.id) ?? 0;
      this.finalizedBlocks.set(message.id, index + 1);
      const key = `${message.id}:${index}`;
      if (block.type === 'text') {
        out.push(this.upsert({ kind: 'assistant', id: key, text: String(block.text ?? ''), streaming: false }));
      } else if (block.type === 'thinking') {
        const streamed = this.get(key);
        // Thinking text is omitted by default; keep whatever streamed instead.
        // An empty finished thinking item is kept; the UI hides it.
        const text = String(block.thinking ?? '') || (streamed?.kind === 'thinking' ? streamed.text : '');
        if (text || streamed) out.push(this.upsert({ kind: 'thinking', id: key, text, streaming: false }));
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        const prev = this.get(block.id);
        const status = prev?.kind === 'tool' ? prev.status : 'running';
        const result = prev?.kind === 'tool' ? prev.result : undefined;
        out.push(this.upsert({ kind: 'tool', id: block.id, name: String(block.name ?? ''), input: block.input ?? {}, status, result }));
      }
    }
    return out;
  }

  private applyToolResults(content: unknown): ChatItem[] {
    const out: ChatItem[] = [];
    for (const block of asBlocks(content)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const prev = this.get(block.tool_use_id);
      const base = prev?.kind === 'tool' ? prev : { kind: 'tool' as const, id: block.tool_use_id, name: '', input: {} };
      out.push(
        this.upsert({ ...base, status: block.is_error ? 'error' : 'done', result: toolResultText(block.content) }),
      );
    }
    return out;
  }
}

function assistantErrorText(error: string): string {
  switch (error) {
    case 'authentication_failed':
      return 'Claude Code is not signed in. Run `claude` in a terminal and log in, then try again.';
    case 'rate_limit':
      return 'Rate limited — try again in a moment.';
    case 'overloaded':
      return 'The API is overloaded — try again in a moment.';
    case 'billing_error':
      return 'Billing problem on your account.';
    case 'max_output_tokens':
      return 'The reply hit the output limit and was cut off.';
    default:
      return `The request failed (${error}).`;
  }
}
