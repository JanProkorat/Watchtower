import { describe, it, expect } from 'vitest';
import {
  agentSvg,
  compactSvg,
  costumeOf,
  crab,
  headerSvg,
  label,
  modelName,
  plannedOf,
  rowSvg,
  svgDataUri,
  tierOf,
  totals,
  xml,
} from '../../../apps/desktop/src/components/instances/savvy/savvyDraw';
import type { SavvyAgentRun, SavvyFlow } from '@watchtower/shared/savvyProgress.js';

const en = { lang: 'en' as const, dark: false };
const flow: SavvyFlow = {
  title: 'Port <parser>',
  total: 4,
  done: 1,
  running: 1,
  phase: 'delegate',
  isFinished: false,
  tasks: [
    { title: 'Write the parser', tier: 'careful', after: [] },
    { title: 'Add tests', tier: 'light', after: [1] },
  ],
};
const run = (over: Partial<SavvyAgentRun> = {}): SavvyAgentRun => ({
  id: 't1',
  type: 'savvy-flow:savvy-careful',
  description: 'Write the parser',
  model: 'claude-opus-5-5',
  status: 'running',
  startedAt: 1_000,
  contextTokens: 100_000,
  contextMax: 1_000_000,
  tokens: 250_000,
  costUsd: 1.5,
  steps: 4,
  round: 1,
  ...over,
});

describe('savvyDraw', () => {
  it('maps agent types to tiers and costumes as the mod does', () => {
    expect(tierOf('savvy-careful')).toBe('careful');
    expect(tierOf('savvy-flow:savvy-heavy')).toBe('heavy');
    expect(tierOf('general-purpose')).toBe('other');
    expect(costumeOf('Explore')).toBe('explore');
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
  });

  it('labels the flow by phase', () => {
    expect(label(flow, 'en')).toBe('Tasks 1/4');
    expect(label({ ...flow, phase: 'plan' }, 'en')).toBe('Plan');
    expect(label({ ...flow, isFinished: true }, 'ru')).toBe('Готово');
  });

  it('draws the crab as pixel rects, walking only while running', () => {
    const idle = crab(0, 0, 'careful');
    expect(idle).toContain('<rect');
    expect(idle).toContain('c-careful');
    expect(idle).not.toContain(' run');
    expect(crab(0, 0, 'careful', false, true)).toContain('c-careful run');
  });

  it('escapes user text into the SVG', () => {
    expect(xml('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(rowSvg(en, flow, 600, true)).toContain('Port &lt;parser&gt;');
  });

  it('follows the app theme rather than prefers-color-scheme', () => {
    const light = agentSvg(en, 316, run(), 61_000);
    const dark = agentSvg({ ...en, dark: true }, 316, run(), 61_000);
    expect(light).not.toContain('prefers-color-scheme');
    expect(light).toContain('.t{fill:#1f1f1f}');
    expect(dark).toContain('.t{fill:#ececec}');
  });

  it('agent row shows tier, model, context and elapsed time', () => {
    const s = agentSvg(en, 316, run(), 61_000);
    expect(s).toContain('careful');
    expect(s).toContain('Opus 5.5');
    expect(s).toContain('ctx 10%');
    expect(s).toContain('1:00');
  });

  it('planned tasks exclude ones already running, and totals sum the runs', () => {
    const planned = plannedOf(flow, [run()]);
    expect(planned.map((p) => p.title)).toEqual(['Add tests']);
    expect(planned[0]?.n).toBe(2);
    const t = totals([run(), run({ id: 't2', costUsd: 0.5, status: 'done', endedAt: 31_000 })], 61_000);
    expect(t.cost).toBe(2);
    expect(t.time).toBe(60_000);
    expect(headerSvg(en, 316, flow.title, t)).toContain('≈$2.00');
    expect(compactSvg(en, 316, [run()], planned, t)).toContain('c-careful run');
  });

  it('wraps SVG as a data URI for <img>', () => {
    const uri = svgDataUri('<svg a="#"/>');
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(uri.split(',')[1] ?? '')).toBe('<svg a="#"/>');
  });
});
