// Pure helpers for the chat view: colours tuned toward the Claude desktop app,
// one-line summaries of tool calls, and diff lines for edits.

export interface ChatPalette {
  bg: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  userBubble: string;
  surface: string;
  codeBg: string;
  accent: string;
  accentText: string;
  added: string;
  removed: string;
  danger: string;
}

export const CLAY = '#d97757';

export function chatPalette(isDark: boolean): ChatPalette {
  return isDark
    ? {
        bg: '#262624',
        text: '#ece9e1',
        muted: '#a6a39b',
        faint: '#76736c',
        border: 'rgba(236,233,225,0.12)',
        userBubble: '#141413',
        surface: '#30302e',
        codeBg: '#1c1c1b',
        accent: CLAY,
        accentText: '#ffffff',
        added: 'rgba(98,170,104,0.22)',
        removed: 'rgba(214,92,76,0.22)',
        danger: '#e5735e',
      }
    : {
        bg: '#faf9f5',
        text: '#29261b',
        muted: '#6b6860',
        faint: '#9a978f',
        border: 'rgba(41,38,27,0.12)',
        userBubble: '#f0eee6',
        surface: '#ffffff',
        codeBg: '#f2f0e8',
        accent: CLAY,
        accentText: '#ffffff',
        added: 'rgba(76,150,84,0.16)',
        removed: 'rgba(196,72,56,0.14)',
        danger: '#c44838',
      };
}

/** The reply body's serif, as the desktop app sets Claude's prose. */
export const CHAT_SERIF = '"Anthropic Serif", "Tiempos Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
export const CHAT_MONO = '"SF Mono", SFMono-Regular, Menlo, Monaco, monospace';

type Input = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Shortens an absolute path to its last few segments. */
export function shortPath(p: string, keep = 3): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length <= keep ? p : `…/${parts.slice(-keep).join('/')}`;
}

/** A tool's display name: MCP tools as `server · tool`. */
export function toolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1]} · ${m[2]}` : name;
}

/** One line saying what a tool call does, from its input. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Input;
  switch (name) {
    case 'Bash':
      return str(i.description) || str(i.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return shortPath(str(i.file_path) || str(i.notebook_path));
    case 'Glob':
      return str(i.pattern);
    case 'Grep':
      return [str(i.pattern), str(i.path) && `in ${shortPath(str(i.path))}`].filter(Boolean).join(' ');
    case 'WebFetch':
      return str(i.url);
    case 'WebSearch':
      return str(i.query);
    case 'Task':
    case 'Agent':
      return str(i.description);
    case 'TodoWrite':
      return 'Update the to-do list';
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string' && v.trim());
      return typeof first === 'string' ? first : '';
    }
  }
}

/** The verb for a permission prompt: "Claude wants to <verb>". */
export function permissionVerb(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Input;
  switch (name) {
    case 'Bash':
      return 'run a command';
    case 'Write':
      return `create ${shortPath(str(i.file_path), 2)}`;
    case 'Edit':
    case 'MultiEdit':
      return `edit ${shortPath(str(i.file_path), 2)}`;
    case 'NotebookEdit':
      return `edit ${shortPath(str(i.notebook_path), 2)}`;
    case 'WebFetch':
      return 'fetch a web page';
    case 'WebSearch':
      return 'search the web';
    default:
      return `use ${toolLabel(name)}`;
  }
}

export type DiffLine = { sign: ' ' | '+' | '-'; text: string };

/**
 * Line diff of an edit's old and new text (LCS; edits are small). Falls back
 * to all-removed-then-all-added past a size where the table would be costly.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length * b.length > 250_000) {
    return [...a.map((text) => ({ sign: '-' as const, text })), ...b.map((text) => ({ sign: '+' as const, text }))];
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let x = a.length - 1; x >= 0; x--)
    for (let y = b.length - 1; y >= 0; y--)
      lcs[x]![y] = a[x] === b[y] ? lcs[x + 1]![y + 1]! + 1 : Math.max(lcs[x + 1]![y]!, lcs[x]![y + 1]!);
  const out: DiffLine[] = [];
  let x = 0;
  let y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      out.push({ sign: ' ', text: a[x]! });
      x++;
      y++;
    } else if (lcs[x + 1]![y]! >= lcs[x]![y + 1]!) out.push({ sign: '-', text: a[x++]! });
    else out.push({ sign: '+', text: b[y++]! });
  }
  while (x < a.length) out.push({ sign: '-', text: a[x++]! });
  while (y < b.length) out.push({ sign: '+', text: b[y++]! });
  return out;
}

/** The edits a tool input describes, as old/new pairs (Edit, MultiEdit). */
export function editsOf(name: string, input: unknown): Array<{ oldText: string; newText: string }> {
  const i = (input && typeof input === 'object' ? input : {}) as Input;
  if (name === 'Edit') return [{ oldText: str(i.old_string), newText: str(i.new_string) }];
  if (name === 'MultiEdit' && Array.isArray(i.edits))
    return (i.edits as Input[]).map((e) => ({ oldText: str(e.old_string), newText: str(e.new_string) }));
  return [];
}
