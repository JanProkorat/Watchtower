export const AUTH_HOOK_PATTERNS: RegExp[] = [
  /\bsaml2aws\b/i,
  /\baws\s+sso\s+login\b/i,
  /\bgcloud\s+auth\s+login\b/i,
  /\baz\s+login\b/i,
];

export const AUTH_PTY_PATTERNS: RegExp[] = [
  /\bsaml2aws\b/i,
  /Opening .* browser/i,
  /https?:\/\/localhost:\d+\/(callback|oauth)/i,
];

const CLEAR_EVENTS = new Set(['PostToolUse', 'Stop', 'UserPromptSubmit', 'SessionEnd']);

export interface AuthBlockDetector {
  onHookEvent(eventName: string, body: unknown, instanceId: string): void;
  onPtyChunk(instanceId: string, chunk: string): void;
}

export function createAuthBlockDetector(opts: {
  emit: (e: { instanceId: string; blocked: boolean; reason?: string }) => void;
  hookPatterns?: RegExp[];
  ptyPatterns?: RegExp[];
}): AuthBlockDetector {
  const hookPatterns = opts.hookPatterns ?? AUTH_HOOK_PATTERNS;
  const ptyPatterns = opts.ptyPatterns ?? AUTH_PTY_PATTERNS;
  const blocked = new Set<string>();

  const set = (instanceId: string, next: boolean, reason?: string) => {
    if (next === blocked.has(instanceId)) return; // dedupe — only emit on change
    if (next) blocked.add(instanceId); else blocked.delete(instanceId);
    opts.emit(next ? { instanceId, blocked: true, reason } : { instanceId, blocked: false });
  };

  const bashCommand = (body: unknown): string | null => {
    const b = body as { tool_name?: unknown; tool_input?: { command?: unknown } } | undefined;
    if (!b || b.tool_name !== 'Bash') return null;
    const cmd = b.tool_input?.command;
    return typeof cmd === 'string' ? cmd : null;
  };

  return {
    onHookEvent(eventName, body, instanceId) {
      if (eventName === 'PreToolUse') {
        const cmd = bashCommand(body);
        if (cmd && hookPatterns.some((p) => p.test(cmd))) set(instanceId, true, cmd.slice(0, 80));
        return;
      }
      if (eventName === 'PostToolUse') {
        const cmd = bashCommand(body);
        if (cmd && hookPatterns.some((p) => p.test(cmd))) { set(instanceId, false); return; }
      }
      if (CLEAR_EVENTS.has(eventName)) set(instanceId, false);
    },
    onPtyChunk(instanceId, chunk) {
      const hit = ptyPatterns.find((p) => p.test(chunk));
      if (hit) set(instanceId, true, `pty: ${hit.source}`);
    },
  };
}
