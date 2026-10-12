import { describe, it, expect } from 'vitest';
import {
  chatPalette,
  diffLines,
  editsOf,
  permissionVerb,
  shortPath,
  toolLabel,
  toolSummary,
} from '../../../apps/desktop/src/components/chat/chatFormat';

describe('chatFormat', () => {
  it('summarizes common tool calls in one line', () => {
    expect(toolSummary('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Run tests');
    expect(toolSummary('Bash', { command: 'npm test' })).toBe('npm test');
    expect(toolSummary('Read', { file_path: '/Users/jan/Projects/app/src/index.ts' })).toBe('…/app/src/index.ts');
    expect(toolSummary('Grep', { pattern: 'TODO', path: '/a/b' })).toBe('TODO in /a/b');
    expect(toolSummary('WebSearch', { query: 'xterm webgl' })).toBe('xterm webgl');
    expect(toolSummary('TodoWrite', { todos: [] })).toBe('Update the to-do list');
    expect(toolSummary('mcp__jira__get_issue', { key: 'WT-1' })).toBe('WT-1');
    expect(toolSummary('Unknown', null)).toBe('');
  });

  it('names MCP tools by server and tool', () => {
    expect(toolLabel('mcp__jira__get_issue')).toBe('jira · get_issue');
    expect(toolLabel('Bash')).toBe('Bash');
  });

  it('phrases permission prompts', () => {
    expect(permissionVerb('Bash', {})).toBe('run a command');
    expect(permissionVerb('Edit', { file_path: '/repo/src/a.ts' })).toBe('edit …/src/a.ts');
    expect(permissionVerb('Write', { file_path: 'a.ts' })).toBe('create a.ts');
    expect(permissionVerb('mcp__gh__merge', {})).toBe('use gh · merge');
  });

  it('shortens paths to their last segments', () => {
    expect(shortPath('/a/b')).toBe('/a/b');
    expect(shortPath('/a/b/c/d/e', 2)).toBe('…/d/e');
  });

  it('diffs edits line by line', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { sign: ' ', text: 'a' },
      { sign: '-', text: 'b' },
      { sign: '+', text: 'B' },
      { sign: ' ', text: 'c' },
    ]);
    expect(diffLines('', 'x')).toEqual([{ sign: '-', text: '' }, { sign: '+', text: 'x' }]);
  });

  it('reads Edit and MultiEdit inputs as old/new pairs', () => {
    expect(editsOf('Edit', { old_string: 'a', new_string: 'b' })).toEqual([{ oldText: 'a', newText: 'b' }]);
    expect(editsOf('MultiEdit', { edits: [{ old_string: '1', new_string: '2' }] })).toEqual([{ oldText: '1', newText: '2' }]);
    expect(editsOf('Write', { content: 'x' })).toEqual([]);
  });

  it('has a light and a dark palette sharing the Claude accent', () => {
    expect(chatPalette(true).accent).toBe(chatPalette(false).accent);
    expect(chatPalette(true).bg).not.toBe(chatPalette(false).bg);
  });
});
