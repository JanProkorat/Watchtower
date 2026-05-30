export type EscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

const MAX_LINES = 25;
const MAX_CHARS = 1500;
const REPLY_HINT = 'Reply in this thread with the option number (e.g. `1`) or an instruction.';

function headerFor(name: string, kind: EscalationKind): string {
  if (kind === 'waiting-permission') return `🔐 *${name}* needs a permission decision:`;
  if (kind === 'crashed') return `💥 *${name}* crashed / exited unexpectedly. Last output:`;
  return `⏳ *${name}* finished and is waiting for your input:`;
}

function fallbackLine(name: string, kind: EscalationKind): string {
  if (kind === 'waiting-permission') return `🔐 *${name}* needs a permission decision.`;
  if (kind === 'crashed') return `💥 *${name}* crashed / exited unexpectedly.`;
  return `⏳ *${name}* finished and is waiting for your input.`;
}

function clip(text: string): string {
  let lines = text.split('\n');
  let truncated = false;
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
    truncated = true;
  }
  let out = lines.join('\n');
  if (out.length > MAX_CHARS) {
    out = out.slice(out.length - MAX_CHARS);
    truncated = true;
  }
  // Insert U+200B (zero-width space) between backticks to prevent breaking the fence
  out = out.replace(/```/g, '`​``');
  return truncated ? `… (truncated)\n${out}` : out;
}

/**
 * Builds the Slack escalation DM. When `snapshot` has content it is embedded in
 * a fenced code block under a per-kind header; otherwise a single-line fallback
 * is used. A reply hint is appended for actionable kinds (not for crashes).
 */
export function formatEscalationMessage(name: string, kind: EscalationKind, snapshot: string): string {
  const hint = kind === 'crashed' ? '' : REPLY_HINT;
  const cleaned = snapshot.trim();
  if (!cleaned) {
    return [fallbackLine(name, kind), hint].filter(Boolean).join('\n');
  }
  const block = '```\n' + clip(cleaned) + '\n```';
  return [headerFor(name, kind), block, hint].filter(Boolean).join('\n');
}
