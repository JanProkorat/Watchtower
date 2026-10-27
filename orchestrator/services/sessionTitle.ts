import os from 'node:os';
import { runClaudeProcess } from './prReview.js';

const PLACEHOLDER_MAX = 40;
const TITLE_MAX = 60;
const PROMPT_MAX = 2000;
const TITLE_TIMEOUT_MS = 30_000;

/** The first prompt cut short, shown until the generated name arrives. Null for a slash command or an empty prompt. */
export function placeholderTitle(prompt: string): string | null {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('/')) return null;
  return clip(text, PLACEHOLDER_MAX);
}

/** The name from a `claude -p --output-format json` run; null when the run failed or said nothing usable. */
export function parseTitleOutput(stdout: string): string | null {
  let envelope: { is_error?: boolean; result?: unknown };
  try {
    envelope = JSON.parse(stdout) as typeof envelope;
  } catch {
    return null;
  }
  if (!envelope || envelope.is_error || typeof envelope.result !== 'string') return null;
  const text = envelope.result.replace(/\s+/g, ' ').trim().replace(/^["'`*]+|["'`*.]+$/g, '').trim();
  return text ? clip(text, TITLE_MAX) : null;
}

export interface SessionTitlerDeps {
  /** The instance's title: null while unnamed, undefined for an unknown instance. */
  getTitle(instanceId: string): string | null | undefined;
  setTitle(instanceId: string, title: string): void;
  generate(prompt: string): Promise<string | null>;
}

/** Names each session once, from its first real prompt: a placeholder at once, then the generated name. */
export class SessionTitler {
  constructor(private deps: SessionTitlerDeps) {}

  async onPrompt(instanceId: string, prompt: string): Promise<void> {
    if (this.deps.getTitle(instanceId) !== null) return;
    const placeholder = placeholderTitle(prompt);
    if (!placeholder) return;
    this.deps.setTitle(instanceId, placeholder);
    const title = await this.deps.generate(prompt).catch(() => null);
    // A name set meanwhile (by anything else) wins over a late answer.
    if (title && this.deps.getTitle(instanceId) === placeholder) this.deps.setTitle(instanceId, title);
  }
}

/**
 * Asks Haiku for a 3–6 word name. Runs with no tools, MCP servers or settings, and without
 * WATCHTOWER_INSTANCE_ID, so its hooks can't reach (and clobber) the instance being named.
 */
export async function generateTitleWithClaude(prompt: string, run = runClaudeProcess): Promise<string | null> {
  const env = { ...process.env };
  delete env.WATCHTOWER_INSTANCE_ID;
  const ask =
    'Name this coding session in 3 to 6 words, from the task below. ' +
    'Reply with the name only: no quotes, no trailing period. Use the language of the task.\n\n' +
    `Task:\n${prompt.slice(0, PROMPT_MAX)}`;
  const args = [
    '-p', ask,
    '--model', 'haiku',
    '--output-format', 'json',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
  const res = await run('claude', args, os.tmpdir(), { timeoutMs: TITLE_TIMEOUT_MS, env });
  return res.aborted ? null : parseTitleOutput(res.stdout);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
