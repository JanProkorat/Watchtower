export type EscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

// --- Block Kit shapes (structural subset of @slack/types we actually emit) ---

export type SlackBlock =
  | { type: 'header'; text: { type: 'plain_text'; text: string; emoji: true } }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> }
  | { type: 'divider' };

export interface EscalationMessage {
  /** Single-line notification fallback (mobile preview / `text` arg). */
  text: string;
  /** Rich Block Kit rendering. */
  blocks: SlackBlock[];
}

// Slack hard limits we stay under.
const HEADER_MAX = 150;
const SECTION_MAX = 2900;
const FALLBACK_MAX_LINES = 18;
const FALLBACK_MAX_CHARS = 1400;
const DESC_MAX = 140;
const LABEL_MAX = 220;

const REPLY_HINT = 'Reply in this thread with the option number (e.g. `1`) or an instruction.';

function headerText(name: string, kind: EscalationKind): string {
  const label =
    kind === 'waiting-permission'
      ? '🔐 ' + name + ' — permission decision'
      : kind === 'crashed'
        ? '💥 ' + name + ' — crashed'
        : '⏳ ' + name + ' — waiting for input';
  return label.length > HEADER_MAX ? label.slice(0, HEADER_MAX - 1) + '…' : label;
}

function fallbackLine(name: string, kind: EscalationKind): string {
  if (kind === 'waiting-permission') return `🔐 ${name} needs a permission decision.`;
  if (kind === 'crashed') return `💥 ${name} crashed / exited unexpectedly.`;
  return `⏳ ${name} finished and is waiting for your input.`;
}

// --- terminal-chrome detection ---------------------------------------------

/** Strip a box border (│) from the start/end of a line; right-trim only. */
function deBox(line: string): string {
  return line
    .replace(/^[ \t]*[│┃][ \t]?/, (m) => ' '.repeat(m.length))
    .replace(/[ \t]?[│┃][ \t]*$/, '')
    .replace(/[ \t]+$/, '');
}

function isSeparatorRule(s: string): boolean {
  return /^[ \t]*[─━—=_*·]{3,}[ \t]*$/.test(s) || /^[ \t]*-{3,}[ \t]*$/.test(s);
}
function isBorderOnly(s: string): boolean {
  return s.trim().length > 0 && /^[ \t│┃╭╮╰╯├┤┌┐└┘─━]+$/.test(s);
}
function isFooterHint(s: string): boolean {
  return /(?:Enter to select|Tab\/Arrow|Arrow keys to navigate|Esc to cancel|to navigate · )/i.test(s);
}
function isTabBar(s: string): boolean {
  return /[←→]/.test(s) && /[□✓▢☑☐]/.test(s);
}
function isChrome(s: string): boolean {
  return isSeparatorRule(s) || isBorderOnly(s) || isFooterHint(s) || isTabBar(s);
}

// --- prompt parsing ---------------------------------------------------------

interface ParsedOption {
  num: number;
  label: string;
  desc: string[];
  marked: boolean;
}
interface Parsed {
  question: string;
  options: ParsedOption[];
  /** Meaningful (non-chrome, non-blank) lines hidden above the question. */
  droppedBefore: number;
}

// indent | optional selection marker | number | . or ) | label
const OPTION_RE = /^([ \t]*)(?:([❯›▶▸>])[ \t]*)?(\d{1,2})[.)][ \t]+(\S.*)$/;

type Cls =
  | { kind: 'opt'; indent: number; num: number; label: string; marked: boolean }
  | { kind: 'text'; indent: number; text: string }
  | { kind: 'blank' }
  | { kind: 'chrome' };

function classify(line: string): Cls {
  if (line.trim() === '') return { kind: 'blank' };
  if (isChrome(line)) return { kind: 'chrome' };
  const m = OPTION_RE.exec(line);
  if (m) {
    return {
      kind: 'opt',
      indent: m[1]!.length,
      marked: Boolean(m[2]),
      num: Number(m[3]),
      label: m[4]!.trim(),
    };
  }
  const indent = line.length - line.trimStart().length;
  return { kind: 'text', indent, text: line.trim() };
}

interface Run {
  opts: ParsedOption[];
  optIndents: number[];
  startIdx: number;
}

function parsePrompt(snapshot: string): Parsed | null {
  const lines = snapshot.split('\n').map(deBox);
  const cls = lines.map(classify);

  // Build runs of consecutively-numbered option lines. A non-desc text line
  // breaks a run; descriptions (more-indented text) attach to the last option.
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i]!;
    if (c.kind === 'opt') {
      if (cur && c.num === cur.opts[cur.opts.length - 1]!.num + 1) {
        cur.opts.push({ num: c.num, label: c.label, desc: [], marked: c.marked });
        cur.optIndents.push(c.indent);
      } else {
        if (cur) runs.push(cur);
        cur = { opts: [{ num: c.num, label: c.label, desc: [], marked: c.marked }], optIndents: [c.indent], startIdx: i };
      }
    } else if (c.kind === 'text') {
      if (cur) {
        const lastIndent = cur.optIndents[cur.optIndents.length - 1]!;
        if (c.indent > lastIndent) {
          cur.opts[cur.opts.length - 1]!.desc.push(c.text);
        } else {
          runs.push(cur);
          cur = null;
        }
      }
    }
    // blank / chrome: do not break a run
  }
  if (cur) runs.push(cur);

  if (runs.length === 0) return null;

  // The selectable list is always the bottom-most run. Treat it as real options
  // only if it has 2+ entries or carries a selection marker (avoids mistaking a
  // stray "1. foo" in prose for an interactive prompt).
  const run = runs[runs.length - 1]!;
  const hasMarker = run.opts.some((o) => o.marked);
  if (run.opts.length < 2 && !hasMarker) return null;

  // Question = the last contiguous block of text lines before the run.
  const qLines: string[] = [];
  let qStart = run.startIdx;
  for (let i = run.startIdx - 1; i >= 0; i--) {
    const c = cls[i]!;
    if (c.kind === 'text') {
      qLines.unshift(c.text);
      qStart = i;
    } else if (c.kind === 'blank' || c.kind === 'chrome') {
      if (qLines.length) break; // stop once we've left the question paragraph
    } else {
      break; // hit an earlier option run
    }
  }
  const question = qLines.join(' ').trim();

  // Everything meaningful above the question is hidden context.
  let droppedBefore = 0;
  for (let i = 0; i < qStart; i++) {
    const c = cls[i]!;
    if (c.kind === 'opt' || c.kind === 'text') droppedBefore++;
  }

  const options = run.opts.map((o) => ({
    ...o,
    label: o.label.length > LABEL_MAX ? o.label.slice(0, LABEL_MAX - 1) + '…' : o.label,
    desc: o.desc.length ? [clipDesc(o.desc.join(' '))] : [],
  }));

  return { question, options, droppedBefore };
}

function clipDesc(s: string): string {
  return s.length > DESC_MAX ? s.slice(0, DESC_MAX - 1) + '…' : s;
}

// --- block builders ---------------------------------------------------------

function header(name: string, kind: EscalationKind): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text: headerText(name, kind), emoji: true } };
}
function section(text: string): SlackBlock {
  const t = text.length > SECTION_MAX ? text.slice(0, SECTION_MAX - 1) + '…' : text;
  return { type: 'section', text: { type: 'mrkdwn', text: t } };
}
function context(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function optionsText(options: ParsedOption[]): string {
  return options
    .map((o) => {
      const head = `*${o.num}.*  ${o.label}`;
      return o.desc.length ? `${head}\n_${o.desc[0]}_` : head;
    })
    .join('\n\n');
}

function fenceFallback(snapshot: string): SlackBlock {
  let lines = snapshot.split('\n').map(deBox).filter((l) => !isChrome(l));
  // collapse leading/trailing blanks
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();

  let hidden = 0;
  if (lines.length > FALLBACK_MAX_LINES) {
    hidden += lines.length - FALLBACK_MAX_LINES;
    lines = lines.slice(0, FALLBACK_MAX_LINES);
  }
  let body = lines.join('\n');
  if (body.length > FALLBACK_MAX_CHARS) {
    body = body.slice(0, FALLBACK_MAX_CHARS);
    hidden += 1;
  }
  // U+200B between backticks so a fence inside the body can't break ours.
  body = body.replace(/```/g, '`​``');
  const note = hidden > 0 ? `\n_+ ${hidden} more line${hidden === 1 ? '' : 's'} — open Watchtower for full context_` : '';
  return section('```\n' + body + '\n```' + note);
}

/**
 * Builds the Slack escalation DM as Block Kit. A recognized selection prompt is
 * rendered as a bold header + readable question + a clean numbered option list,
 * hiding the terminal chrome and any pre-amble (with a "+ N more lines" note
 * pointing at the app). Anything unrecognized falls back to a cleaned code
 * block, and an empty snapshot to just the header. A reply hint is appended for
 * actionable kinds (not crashes).
 */
export function formatEscalationMessage(name: string, kind: EscalationKind, snapshot: string): EscalationMessage {
  const text = fallbackLine(name, kind);
  const blocks: SlackBlock[] = [header(name, kind)];
  const cleaned = snapshot.trim();

  const parsed = cleaned ? parsePrompt(snapshot) : null;
  if (parsed) {
    if (parsed.question) blocks.push(section(parsed.question));
    blocks.push(section(optionsText(parsed.options)));
    if (parsed.droppedBefore > 0) {
      const n = parsed.droppedBefore;
      blocks.push(context(`_+ ${n} more line${n === 1 ? '' : 's'} — open Watchtower for full context_`));
    }
  } else if (cleaned) {
    blocks.push(fenceFallback(snapshot));
  }

  if (kind !== 'crashed') blocks.push(context(REPLY_HINT));
  return { text, blocks };
}
