import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackEscalator } from '../../orchestrator/slackEscalator.js';
import { DEFAULT_SLACK_CONFIG, type SlackConfig } from '../../shared/slackConfig.js';

function makeEscalator(overrides: Partial<SlackConfig> = {}) {
  const config: SlackConfig = { ...DEFAULT_SLACK_CONFIG, enabled: true, escalateMs: 1000, ...overrides };
  const posts: Array<{ id: string; kind: string }> = [];
  const esc = new SlackEscalator(
    () => config,
    { post: (id, _cwd, kind) => posts.push({ id, kind }) },
  );
  return { esc, posts, config };
}

describe('SlackEscalator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts after escalateMs when the user never engages and the window is blurred', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission');
    expect(posts).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(posts).toEqual([{ id: 'a', kind: 'waiting-permission' }]);
  });

  it('does NOT post if the window is focused when the timer fires', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(true);
    esc.apply('a', '/cwd', 'working', 'idle-notify');
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('cancels the timer when the instance leaves the attention state', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission');
    esc.apply('a', '/cwd', 'waiting-permission', 'working');
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('posts crashes immediately (no timer) when the window is blurred', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'crashed');
    expect(posts).toEqual([{ id: 'a', kind: 'crashed' }]);
  });

  it('respects disabled config and per-trigger toggles', () => {
    const { esc, posts } = makeEscalator({ triggers: { permission: false, idle: true, crash: true } });
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission');
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('does nothing when disabled entirely', () => {
    const { esc, posts } = makeEscalator({ enabled: false });
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'idle-notify');
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('still posts when the window is blurred AFTER arming (focus flip down)', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(true);
    esc.apply('a', '/cwd', 'working', 'waiting-permission'); // armed while focused
    esc.setWindowFocused(false); // user walks away before it fires
    vi.advanceTimersByTime(1000);
    expect(posts).toEqual([{ id: 'a', kind: 'waiting-permission' }]);
  });

  it('suppresses the post when the window regains focus AFTER arming (focus flip up)', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'idle-notify'); // armed while blurred
    esc.setWindowFocused(true); // user comes back before it fires
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('re-arming on a fresh attention entry resets the timer', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission'); // arm #1
    vi.advanceTimersByTime(600);
    esc.apply('a', '/cwd', 'waiting-permission', 'working');  // engaged, cancels
    esc.apply('a', '/cwd', 'working', 'idle-notify');         // arm #2 (fresh 1000ms)
    vi.advanceTimersByTime(600); // 1200ms since arm#1 but only 600ms since arm#2
    expect(posts).toHaveLength(0);
    vi.advanceTimersByTime(400); // now 1000ms since arm#2
    expect(posts).toEqual([{ id: 'a', kind: 'idle-notify' }]);
  });
});
