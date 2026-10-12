import { describe, it, expect } from 'vitest';
import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { ChatTranscript, MAX_RESULT_CHARS, toolResultText } from '../../orchestrator/services/chat/transcript.js';

// Minimal SDK messages, shaped as the SDK delivers them (only the fields the
// transcript reads).
const ev = (event: object, parent: string | null = null) =>
  ({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'u', session_id: 's' }) as unknown as SDKMessage;
const assistant = (id: string, content: object[], extra: object = {}) =>
  ({ type: 'assistant', message: { id, content }, parent_tool_use_id: null, uuid: `a-${id}`, session_id: 's', ...extra }) as unknown as SDKMessage;
const toolResult = (tool_use_id: string, content: unknown, is_error = false, parent: string | null = null) =>
  ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id, content, is_error }] }, parent_tool_use_id: parent, session_id: 's' }) as unknown as SDKMessage;

describe('ChatTranscript (live stream)', () => {
  it('streams text deltas into one assistant item, finalized by the complete message', () => {
    const t = new ChatTranscript();
    t.apply(ev({ type: 'message_start', message: { id: 'm1' } }));
    t.apply(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    t.apply(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }));
    const changed = t.apply(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }));
    expect(changed).toEqual([{ kind: 'assistant', id: 'm1:0', text: 'Hello', streaming: true }]);
    t.apply(assistant('m1', [{ type: 'text', text: 'Hello!' }]));
    expect(t.list()).toEqual([{ kind: 'assistant', id: 'm1:0', text: 'Hello!', streaming: false }]);
  });

  it('keys each block of a multi-block message by its order, matching the stream indices', () => {
    const t = new ChatTranscript();
    t.apply(ev({ type: 'message_start', message: { id: 'm1' } }));
    t.apply(ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }));
    t.apply(ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }));
    t.apply(ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' } }));
    // Complete messages arrive one block each, in order.
    t.apply(assistant('m1', [{ type: 'thinking', thinking: '' }]));
    t.apply(assistant('m1', [{ type: 'text', text: 'Running it.' }]));
    t.apply(assistant('m1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]));
    expect(t.list().map((i) => i.id)).toEqual(['m1:0', 'm1:1', 'toolu_1']);
    expect(t.get('m1:0')).toMatchObject({ kind: 'thinking', text: '', streaming: false });
    expect(t.get('toolu_1')).toMatchObject({ kind: 'tool', name: 'Bash', input: { command: 'ls' }, status: 'running' });
  });

  it('keeps streamed thinking text when the final block omits it', () => {
    const t = new ChatTranscript();
    t.apply(ev({ type: 'message_start', message: { id: 'm1' } }));
    t.apply(ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }));
    t.apply(ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me see' } }));
    t.apply(assistant('m1', [{ type: 'thinking', thinking: '' }]));
    expect(t.get('m1:0')).toEqual({ kind: 'thinking', id: 'm1:0', text: 'Let me see', streaming: false });
  });

  it('completes a tool call from its result, as done or error', () => {
    const t = new ChatTranscript();
    t.apply(assistant('m1', [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }, { type: 'tool_use', id: 'b', name: 'Read', input: {} }]));
    t.apply(toolResult('a', 'hello'));
    t.apply(toolResult('b', [{ type: 'text', text: 'nope' }], true));
    expect(t.get('a')).toMatchObject({ status: 'done', result: 'hello' });
    expect(t.get('b')).toMatchObject({ status: 'error', result: 'nope' });
  });

  it('does not reset a finished tool when its complete message arrives late', () => {
    const t = new ChatTranscript();
    t.apply(ev({ type: 'message_start', message: { id: 'm1' } }));
    t.apply(ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a', name: 'Bash' } }));
    t.apply(toolResult('a', 'ok'));
    t.apply(assistant('m1', [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls' } }]));
    expect(t.get('a')).toMatchObject({ status: 'done', result: 'ok', input: { command: 'ls' } });
  });

  it('keeps subagent traffic out of the main thread', () => {
    const t = new ChatTranscript();
    t.apply(ev({ type: 'message_start', message: { id: 'sub' } }, 'toolu_task'));
    t.apply({ ...(assistant('sub', [{ type: 'text', text: 'inner' }]) as object), parent_tool_use_id: 'toolu_task' } as SDKMessage);
    t.apply(toolResult('x', 'inner result', false, 'toolu_task'));
    expect(t.list()).toEqual([]);
  });

  it('turns results, compaction, command output and API errors into items', () => {
    const t = new ChatTranscript();
    t.apply({ type: 'result', subtype: 'success', uuid: 'r1', is_error: false, duration_ms: 1200, total_cost_usd: 0.02 } as unknown as SDKMessage);
    t.apply({ type: 'result', subtype: 'error_during_execution', uuid: 'r2', is_error: true, duration_ms: 5, total_cost_usd: 0.02, errors: ['boom'] } as unknown as SDKMessage);
    t.apply({ type: 'system', subtype: 'compact_boundary', uuid: 'c1' } as unknown as SDKMessage);
    t.apply({ type: 'system', subtype: 'local_command_output', uuid: 'l1', content: 'Total cost: $0.02' } as unknown as SDKMessage);
    t.apply({ type: 'system', subtype: 'init', uuid: 'i1' } as unknown as SDKMessage);
    t.apply(assistant('m9', [], { error: 'rate_limit' }));
    expect(t.list()).toEqual([
      { kind: 'result', id: 'result:r1', isError: false, durationMs: 1200, costUsd: 0.02, errors: [] },
      { kind: 'result', id: 'result:r2', isError: true, durationMs: 5, costUsd: 0.02, errors: ['boom'] },
      { kind: 'notice', id: 'compact:c1', level: 'info', text: 'Conversation compacted' },
      { kind: 'notice', id: 'local:l1', level: 'info', text: 'Total cost: $0.02' },
      { kind: 'notice', id: 'error:a-m9', level: 'error', text: 'Rate limited — try again in a moment.' },
    ]);
  });
});

describe('ChatTranscript (history)', () => {
  const sm = (type: SessionMessage['type'], uuid: string, message: unknown, parent: string | null = null) =>
    ({ type, uuid, session_id: 's', message, parent_tool_use_id: parent, parent_agent_id: null }) as SessionMessage;

  it('rebuilds user turns, replies and finished tool calls from a saved session', () => {
    const t = new ChatTranscript();
    t.applyHistory([
      sm('user', 'u1', { role: 'user', content: 'Fix the bug' }),
      sm('assistant', 'a1', { id: 'm1', content: [{ type: 'text', text: 'Looking.' }] }),
      sm('assistant', 'a2', { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }] }),
      sm('user', 'u2', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] }),
      sm('assistant', 'a3', { id: 'm2', content: [{ type: 'text', text: 'Fixed.' }] }),
    ]);
    expect(t.list().map((i) => [i.kind, i.id])).toEqual([
      ['user', 'u1'],
      ['assistant', 'm1:0'],
      ['tool', 't1'],
      ['assistant', 'm2:0'],
    ]);
    expect(t.get('t1')).toMatchObject({ status: 'done', result: 'file body' });
  });

  it("leaves out Claude Code's own command echoes and subagent turns", () => {
    const t = new ChatTranscript();
    t.applyHistory([
      sm('user', 'u1', { role: 'user', content: '<command-name>/cost</command-name>' }),
      sm('user', 'u2', { role: 'user', content: [{ type: 'text', text: '<local-command-stdout>$0.01</local-command-stdout>' }] }),
      sm('assistant', 'a1', { id: 'sub', content: [{ type: 'text', text: 'inner' }] }, 'toolu_task'),
      sm('user', 'u3', { role: 'user', content: 'a real question' }),
    ]);
    expect(t.list()).toEqual([{ kind: 'user', id: 'u3', text: 'a real question' }]);
  });

  it('marks tool calls that never got a result as interrupted', () => {
    const t = new ChatTranscript();
    t.applyHistory([sm('assistant', 'a1', { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] })]);
    expect(t.get('t1')).toMatchObject({ status: 'error', result: 'Interrupted' });
  });
});

describe('toolResultText', () => {
  it('joins text blocks, marks images, and cuts long output', () => {
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\n[image]\nb');
    const long = toolResultText('x'.repeat(MAX_RESULT_CHARS + 10));
    expect(long.startsWith('x'.repeat(MAX_RESULT_CHARS))).toBe(true);
    expect(long).toContain('10 more characters');
  });
});
