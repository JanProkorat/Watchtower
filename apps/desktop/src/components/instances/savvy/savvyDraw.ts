// SVG drawings for the savvy-progress mod's panel and band, ported from
// plugins/savvy-progress/hooks/register.tsx (MIT, © johnnyvizz — see that
// folder's LICENSE). The mod draws these only on Claude Code's desktop surface;
// in a terminal it falls back to a `▣` glyph, so Watchtower draws them itself
// from the snapshot the mod posts.
//
// Differences from the mod: colours follow Watchtower's theme (`dark`) instead
// of `prefers-color-scheme`, and the strings/time come in through `DrawCtx`
// rather than module state. Keep the drawing itself in step with the mod.

import type { SavvyAgentRun, SavvyFlow, SavvyPlannedTask } from '@watchtower/shared/savvyProgress.js';

export type Lang = 'en' | 'ru';

export interface DrawCtx {
  lang: Lang;
  dark: boolean;
}

export const STRINGS = {
  en: {
    pane: 'Agents',
    tokens: 'Tokens',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
  },
  ru: {
    pane: 'Агенты',
    tokens: 'Токены',
    time: 'Время',
    collapse: 'Свернуть',
    expand: 'Развернуть',
    running: 'Работают',
    finished: 'Завершены',
    planned: 'Запланированы',
    empty: 'Субагентов пока нет.',
    round: 'раунд',
    failed: 'ошибка',
    after: 'после',
    tokensWord: 'токенов',
    agentsCount: 'агентов',
    isRunning: 'работает',
    isFinished: 'завершён',
    isPlanned: 'запланирована',
    done: 'Готово',
    plan: 'План',
    design: 'Дизайн',
    tasks: 'Задачи',
    review: 'Ревью',
    busy: 'в работе',
  },
} as const;

const ACCENT = '#8f8cf4';
const DONE = '#5fbf8f';
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif";

// ---------------------------------------------------------------------------
// Flow (the band above the prompt)

export const label = (f: SavvyFlow, lang: Lang): string => {
  const s = STRINGS[lang];
  if (f.isFinished) return s.done;
  if (f.phase === 'plan') return s.plan;
  if (f.phase === 'design') return s.design;
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`;
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`;
};

export const ratio = (f: SavvyFlow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0);

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export const BAND_H = 22;
const BAR_H = 16;
const CRAB_W = 26;
const CELL = 3;

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56;

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0);

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break;
    out += ch;
  }
  return out + '…';
};

export const rowSvg = (ctx: DrawCtx, f: SavvyFlow, W: number, isWorking: boolean): string => {
  const H = BAND_H;
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4));
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12);
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W);
  const color = f.isFinished ? DONE : ACCENT;
  const y0 = (H - BAR_H) / 2;
  const fillW = Math.round(BAR_W * ratio(f));
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0;
  const dots: string[] = [];

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL);
  const rows = Math.floor(BAR_H / CELL);
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2);
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density)
        dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`);
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = [];
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2)
        faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`);
    }
  }

  const ticks: string[] = [];
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total);
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`);
  }

  const text = label(f, ctx.lang);
  const pillW = Math.round(18 + text.length * 6.6);
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW));
  const percent = `${Math.round(ratio(f) * 100)}%`;
  const palette = ctx.dark
    ? '.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}'
    : '.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
${palette}
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, 'other', false, isWorking, 0.8)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Agents panel

const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
};

export const colorOf = (tier: string): string => TIER_COLOR[tier] ?? '#888780';
export const isKnownTier = (tier: string): boolean => tier in TIER_COLOR;

// What each savvy tier runs on, for planned tasks that have no run yet.
const TIER_MODEL: Record<string, string> = {
  fable: 'Fable · high',
  heavy: 'Opus · xhigh',
  careful: 'Opus · high',
  medium: 'Opus · medium',
  light: 'Opus · low',
};

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
export const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '');
  const t = bare.replace(/^savvy-/, '').toLowerCase();
  return t in TIER_COLOR && bare.startsWith('savvy-') ? t : 'other';
};

export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id);
  const [, family = '', major = '', minor] = m ?? [];
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—';
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`;
};

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`;

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const elapsed = (a: SavvyAgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt;

export type Planned = SavvyPlannedTask & { n: number };

export const plannedOf = (f: SavvyFlow | null, list: SavvyAgentRun[]): Planned[] => {
  if (!f || f.isFinished) return [];
  const started = new Set(list.map((a) => norm(a.description)));
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter((t) => !started.has(norm(t.title)));
};

export interface Totals {
  tokens: number;
  time: number;
}

export const totals = (list: SavvyAgentRun[], at: number): Totals => {
  const tokens = list.reduce((s, a) => s + a.tokens, 0);
  const start = Math.min(...list.map((a) => a.startedAt));
  const end = Math.max(...list.map((a) => a.endedAt ?? Math.max(at, a.startedAt)));
  return { tokens, time: list.length ? end - start : 0 };
};

const paneCss = (dark: boolean): string =>
  `<style>
${
  dark
    ? '.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}'
    : '.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}'
}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`;

// Pixel R2-D2 on a 30×28 grid, one costume per tier; the panels take the tier's color.
const INK = '#1F1E1D';
const DOME = '#C9CCD2';
const SHELL = '#F4F3EE';
const STEEL = '#8E929A';

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void;

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)));

// Classic R2 blue, for subagents outside the savvy tiers.
const R2_BLUE = '#3B6FD1';

// `t` colors the panels; a raised arm (`armFront` < 0) travels with the prop it holds via `armCls`.
const droidBody = (f: Fill, t: string, armFront = 0, armCls?: string): void => {
  stamp(f, 7, 8, ['...dddddddddd...', '..ddttddddttdd..', '.dddkkddddrddddd', 'ddddkkddddddttdd'], { d: DOME, t, k: INK, r: '#D0453F' });
  f(7, 12, 16, 1, STEEL);
  f(7, 13, 16, 9, SHELL);
  f(9, 14, 2, 6, t); f(19, 14, 2, 6, t); f(13, 15, 4, 2, t); f(13, 18, 4, 1, STEEL);
  f(3, 12, 4, 3, t); f(23, 12, 4, 3, t);
  f(4, 15, 2, 8, DOME); f(24, 15, 2, 8, DOME);
  if (armFront < 0) {
    f(24, 10, 3, 1, STEEL, armCls);
    f(26, 11, 1, 1, STEEL, armCls);
  }
  f(3, 23, 4, 3, STEEL, 'la');
  f(23, 23, 4, 3, STEEL, 'la');
  f(13, 22, 4, 3, DOME, 'lb');
  f(12, 25, 6, 1, STEEL, 'lb');
};

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`;

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    droidBody(f, t);
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2');
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff');
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t);
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star');
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    droidBody(f, t, -4, 'it');
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' });
    f(6, 9, 18, 1, t);
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it');
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl');
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    droidBody(f, t);
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' });
    f(13, 5, 4, 2, t);
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it');
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t) => {
    droidBody(f, t, -4, 'pan');
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' });
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg');
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    droidBody(f, t, -4);
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK });
    f(25, 1, 1, 9, '#8E929A');
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag');
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: (f) => {
    droidBody(f, R2_BLUE);
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' });
    f(7, 9, 16, 1, INK); f(10, 10, 4, 2, INK);
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it');
  },
  other: (f) => droidBody(f, R2_BLUE),
};

export const costumeOf = (type: string): string => (type === 'Explore' ? 'explore' : tierOf(type));

const CRAB_SCALE = 1.1;

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own.
export const crab = (x: number, y: number, costume: string, dim = false, isWalking = false, scale = CRAB_SCALE): string => {
  const groups = new Map<string, string[]>([['bd', []]]);
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, []);
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`);
  };
  const draw = COSTUMES[costume] ?? ((g: Fill) => droidBody(g, R2_BLUE));
  draw(f, colorOf(costume));
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`;
  const props = [...groups.keys()].filter((k) => k !== 'bd' && k !== 'la' && k !== 'lb');
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`;
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`;
};

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`;
  if (status === 'done')
    return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (status === 'failed')
    return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`;
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`;
};

const svg = (ctx: DrawCtx, W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paneCss(ctx.dark)}${CRAB_CSS}${body}</svg>`;

export const headerHeight = (title: string): number => (title ? 72 : 44);

// The panel's own title already says "Agents": the header names the flow, if any.
export const headerSvg = (ctx: DrawCtx, W: number, title: string, t: Totals): string => {
  const s = STRINGS[ctx.lang];
  const gap = 6;
  const tw = (W - gap) / 2;
  const top = title ? 28 : 0;
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`;
  return svg(
    ctx,
    W,
    headerHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.tokens, fmtTokens(t.tokens))}${tile(1, s.time, fmtTime(t.time))}`,
  );
};

// The task's own progress when the worker reports steps; a finished run is full.
const progressOf = (a: SavvyAgentRun): number | null => {
  if (a.status === 'done') return 1;
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal);
  return null;
};

const ctxOf = (a: SavvyAgentRun): number =>
  a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0;

export const AGENT_ROW_H = 66;
export const PLANNED_ROW_H = 46;
export const COMPACT_H = 32;

export const agentSvg = (ctx: DrawCtx, W: number, a: SavvyAgentRun, at: number): string => {
  const s = STRINGS[ctx.lang];
  const tier = tierOf(a.type);
  const color = colorOf(tier);
  const ctxPct = ctxOf(a);
  const textW = W - 42 - 22;
  const meta = [a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model)];
  if (a.round > 1) meta.push(`${s.round} ${a.round}`);
  if (a.status === 'failed') meta.push(s.failed);
  const barW = textW;
  const progress = progressOf(a);
  const stats = `ctx ${ctxPct}% · ${fmtTokens(a.contextTokens)}  ${fmtTime(elapsed(a, at))}`;
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : '';
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12);
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctxPct / 100));
  return svg(
    ctx,
    W,
    AGENT_ROW_H,
    `${crab(0, 14, costumeOf(a.type), false, a.status === 'running')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier === 'other' ? a.type : tier)}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  );
};

export const plannedSvg = (ctx: DrawCtx, W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other';
  const color = colorOf(tier);
  const textW = W - 42 - 22;
  const meta = [TIER_MODEL[tier] ?? ''];
  if (p.after.length) meta.push(`${STRINGS[ctx.lang].after} ${p.after.join(', ')}`);
  return svg(
    ctx,
    W,
    PLANNED_ROW_H,
    `${crab(0, 6, tier, true)}
<text class="s" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier)}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  );
};

export const compactSvg = (ctx: DrawCtx, W: number, list: SavvyAgentRun[], planned: Planned[], t: Totals): string => {
  const icons = [
    ...list.filter((a) => a.status === 'running').map((a) => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: 'running', dim: false })),
    ...list.filter((a) => a.status !== 'running').map((a) => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: a.status, dim: false })),
    ...planned.map((p) => ({ k: p.tier in TIER_COLOR ? p.tier : 'other', c: colorOf(p.tier), s: 'planned', dim: true })),
  ];
  const fit = Math.max(1, Math.floor((W - 150) / 36));
  const shown = icons.slice(0, fit);
  const more = icons.length - shown.length;
  const body = shown
    .map(
      (ic, i) =>
        crab(i * 36, 0, ic.k, ic.dim, ic.s === 'running') +
        (ic.s === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${ic.c}"/>` : ''),
    )
    .join('');
  const x = shown.length * 36 + (more ? 4 : 0);
  return svg(
    ctx,
    W,
    COMPACT_H,
    `${body}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${fmtTokens(t.tokens)} · ${fmtTime(t.time)}</text>`,
  );
};

/** An SVG string as an `<img src>`: isolates its `<style>` from the app's CSS and keeps its animations. */
export const svgDataUri = (source: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
