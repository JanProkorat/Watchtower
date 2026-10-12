// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { ChatView, groupTools, isShown } from '../../../apps/desktop/src/components/chat/ChatView';
import type { ChatItem, ChatState } from '@watchtower/shared/chat.js';

const chat = vi.hoisted(() => ({
  items: [] as unknown[],
  state: { busy: false, live: true, permissionMode: 'default', model: null, models: [] } as unknown,
  loaded: true,
  send: vi.fn(async () => true),
  interrupt: vi.fn(),
  respond: vi.fn(),
  setPermissionMode: vi.fn(),
  setModel: vi.fn(),
}));
vi.mock('../../../apps/desktop/src/state/useChat', () => ({ useChat: () => chat }));

beforeAll(() => {
  // jsdom lacks these; the view scrolls and the code block copies.
  Element.prototype.scrollTo ??= () => {};
});

const state = (over: Partial<ChatState> = {}): ChatState => ({ busy: false, live: true, permissionMode: 'default', model: null, models: [], ...over });
const renderIt = (items: ChatItem[], st: Partial<ChatState> = {}) => {
  chat.items = items;
  chat.state = state(st);
  return render(
    <ThemeProvider theme={darkTheme}>
      <div style={{ position: 'relative', height: 600 }}>
        <ChatView instanceId="i1" cwd="/Users/jan/Projects/app" onFocus={() => {}} />
      </div>
    </ThemeProvider>,
  );
};

describe('ChatView', () => {
  it('greets an empty conversation', () => {
    renderIt([]);
    expect(screen.getByText('What can I help with?')).toBeInTheDocument();
  });

  it('draws the user turn, the markdown reply and the tool row', () => {
    renderIt([
      { kind: 'user', id: 'u', text: 'Fix the bug' },
      { kind: 'assistant', id: 'a', text: 'Done — see **here**:\n\n```ts\nconst x = 1;\n```', streaming: false },
      { kind: 'tool', id: 't', name: 'Bash', input: { command: 'npm test' }, status: 'done', result: 'ok' },
    ]);
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();
    expect(screen.getByText('here').tagName).toBe('STRONG');
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    // Expanding the row shows the command.
    fireEvent.click(screen.getByText('Bash'));
    expect(screen.getByText('$ npm test')).toBeInTheDocument();
  });

  it('answers a permission prompt', () => {
    renderIt([
      { kind: 'permission', id: 'p', toolName: 'Bash', input: { command: 'rm -rf build' }, canAlwaysAllow: true, status: 'pending' },
    ]);
    expect(screen.getByText('Claude wants to run a command')).toBeInTheDocument();
    expect(screen.getByText('$ rm -rf build')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    expect(chat.respond).toHaveBeenCalledWith('p', { kind: 'permission', decision: 'allowAlways' });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(chat.respond).toHaveBeenCalledWith('p', { kind: 'permission', decision: 'deny' });
  });

  it('collects answers to Claude’s questions', () => {
    renderIt([
      {
        kind: 'question',
        id: 'q',
        status: 'pending',
        questions: [{ question: 'Tea or coffee?', header: 'Drink', multiSelect: false, options: [{ label: 'Tea', description: '' }, { label: 'Coffee', description: '' }] }],
      },
    ]);
    const send = screen.getByRole('button', { name: 'Send answer' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByText('Coffee'));
    fireEvent.click(send);
    expect(chat.respond).toHaveBeenCalledWith('q', { kind: 'question', answers: { 'Tea or coffee?': 'Coffee' } });
  });

  it('sends on Enter, keeps Shift+Enter for new lines, and stops when busy', async () => {
    renderIt([], { busy: true });
    const box = screen.getByLabelText('Message Claude');
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(chat.send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(chat.send).toHaveBeenCalledWith('hello'));
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(chat.interrupt).toHaveBeenCalled();
    expect(screen.getByText('Working…')).toBeInTheDocument();
  });

  it('shows failed turns and errors, not successful results', () => {
    renderIt([
      { kind: 'result', id: 'r1', isError: false, durationMs: 1, costUsd: 0, errors: [] },
      { kind: 'result', id: 'r2', isError: true, durationMs: 1, costUsd: 0, errors: ['API overloaded'] },
    ]);
    expect(screen.getByText('API overloaded')).toBeInTheDocument();
  });
});

describe('ChatView helpers', () => {
  it('hides items that draw nothing', () => {
    expect(isShown({ kind: 'thinking', id: 't', text: '', streaming: false })).toBe(false);
    expect(isShown({ kind: 'thinking', id: 't', text: '', streaming: true })).toBe(true);
    expect(isShown({ kind: 'tool', id: 'x', name: 'AskUserQuestion', input: {}, status: 'done' })).toBe(false);
    expect(isShown({ kind: 'assistant', id: 'a', text: '', streaming: true })).toBe(false);
  });

  it('groups consecutive tool calls', () => {
    const tool = (id: string): ChatItem => ({ kind: 'tool', id, name: 'Read', input: {}, status: 'done' });
    const text: ChatItem = { kind: 'assistant', id: 'a', text: 'x', streaming: false };
    expect(groupTools([tool('1'), tool('2'), text, tool('3')]).map((g) => g.map((i) => i.id))).toEqual([['1', '2'], ['a'], ['3']]);
  });
});
