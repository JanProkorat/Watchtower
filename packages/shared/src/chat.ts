// Chat instances: a Claude Code session driven through the Claude Agent SDK
// (orchestrator/services/chat/) and drawn natively by the renderer, instead of
// the CLI's TUI in a pty. The orchestrator turns the SDK's message stream into
// these flat, render-ready items and pushes them as they change.

export type ChatPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto';

export const CHAT_PERMISSION_MODES: ReadonlyArray<{ value: ChatPermissionMode; label: string; hint: string }> = [
  { value: 'default', label: 'Ask permissions', hint: 'Ask before edits and commands' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Edit files without asking' },
  { value: 'plan', label: 'Plan mode', hint: 'Explore and plan, change nothing' },
  { value: 'auto', label: 'Auto', hint: 'A classifier decides; asks when unsure' },
];

export interface ChatQuestionOption {
  label: string;
  description: string;
}

export interface ChatQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: ChatQuestionOption[];
}

/** One row of the conversation. `id` is stable: a later push with the same id replaces it. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'assistant';
      id: string;
      /** Markdown. */
      text: string;
      /** Still receiving deltas. */
      streaming: boolean;
    }
  | { kind: 'thinking'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      /** The tool_use id. */
      id: string;
      name: string;
      input: unknown;
      status: 'running' | 'done' | 'error';
      /** The tool result as text, cut to a display-sized length. */
      result?: string;
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      input: unknown;
      /** Claude Code's own prompt sentence, e.g. "Claude wants to edit foo.ts". */
      title?: string;
      description?: string;
      /** An "always allow" choice is on offer (Claude Code suggested a rule). */
      canAlwaysAllow: boolean;
      status: 'pending' | 'allowed' | 'denied' | 'cancelled';
    }
  | {
      kind: 'question';
      id: string;
      questions: ChatQuestion[];
      status: 'pending' | 'answered' | 'cancelled';
      answers?: Record<string, string>;
    }
  | {
      kind: 'result';
      id: string;
      isError: boolean;
      durationMs: number;
      /** Running session total, as the SDK reports it (an estimate). */
      costUsd: number;
      /** Error text when the turn failed. */
      errors: string[];
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string };

export interface ChatModelOption {
  value: string;
  label: string;
  description?: string;
}

export interface ChatState {
  /** A turn is running. */
  busy: boolean;
  /** The SDK process is up (it starts on the first message). */
  live: boolean;
  permissionMode: ChatPermissionMode;
  /** `null` = Claude Code's default model. */
  model: string | null;
  /** From the live session; empty until it has started once. */
  models: ChatModelOption[];
}

export interface ChatSnapshot {
  items: ChatItem[];
  state: ChatState;
}

/** Payload of the `chatEvent` push. */
export type ChatEvent =
  | { instanceId: string; op: 'upsert'; item: ChatItem }
  | { instanceId: string; op: 'state'; state: ChatState }
  | { instanceId: string; op: 'reset'; snapshot: ChatSnapshot };

/** How the user answered a permission or question item. */
export type ChatResponse =
  | { kind: 'permission'; decision: 'allow' | 'allowAlways' | 'deny'; message?: string }
  | { kind: 'question'; answers: Record<string, string> }
  | { kind: 'question'; cancel: true };

/** Applies one push to a list of items: replace by id, else append. */
export function upsertChatItem(items: ChatItem[], item: ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) return [...items, item];
  const next = items.slice();
  next[i] = item;
  return next;
}
