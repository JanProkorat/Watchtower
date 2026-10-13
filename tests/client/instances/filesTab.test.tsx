// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { FilesTab } from '../../../apps/desktop/src/components/instances/side/FilesTab';
import type { FileTreeState } from '../../../apps/desktop/src/state/useFileTree';

const tree = (over: Partial<FileTreeState> = {}): FileTreeState => ({
  listings: new Map([
    ['', { dir: '', entries: [{ name: 'src', isDir: true, size: 0, mtimeMs: 1 }, { name: 'gone.ts', isDir: false, size: 1, mtimeMs: 1 }], truncated: 2 }],
    ['src', { dir: 'src', entries: [{ name: 'a.ts', isDir: false, size: 10, mtimeMs: 1 }], truncated: 0 }],
  ]),
  expanded: new Set(['src']),
  git: {
    isRepo: true,
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [
      { path: 'src/a.ts', status: 'modified', added: 3, deleted: 1 },
      { path: 'gone.ts', status: 'deleted', added: 0, deleted: 5 },
    ],
  },
  error: null,
  toggle: vi.fn(),
  reveal: vi.fn(),
  search: vi.fn(async () => ['src/a.ts']),
  ...over,
});
const renderTab = (t: FileTreeState, flash?: Map<string, { kind: 'read' | 'write'; at: number }>) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <FilesTab tree={t} flash={flash} />
    </ThemeProvider>,
  );

describe('FilesTab', () => {
  it('shows the branch row, rows with git colours, folder totals and the cap note', () => {
    renderTab(tree());
    expect(screen.getByText('main ↑0 ↓0 · +3 −6 M:1')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toHaveAttribute('data-status', 'modified');
    expect(screen.getByText('gone.ts')).toHaveAttribute('data-status', 'deleted');
    expect(screen.getByTestId('totals-src')).toHaveTextContent('+3 −1');
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows a git-deleted file that is gone from disk, without a 1970 date', () => {
    const t = tree();
    t.git = { isRepo: true, branch: 'main', upstream: null, ahead: 0, behind: 0, files: [{ path: 'src/old.ts', status: 'deleted', added: 0, deleted: 0 }] };
    renderTab(t);
    const row = screen.getByText('old.ts');
    expect(row).toHaveAttribute('data-status', 'deleted');
    expect(row.closest('[role="treeitem"]')).not.toHaveTextContent('1970');
    expect(row.closest('[role="treeitem"]')).not.toHaveTextContent('1. 1.');
  });

  it('a click on a folder toggles it; arrow keys move and expand', () => {
    const t = tree();
    renderTab(t);
    fireEvent.click(screen.getByText('src'));
    expect(t.toggle).toHaveBeenCalledWith('src');
    const list = screen.getByRole('tree');
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // onto src/a.ts
    fireEvent.keyDown(list, { key: 'ArrowLeft' }); // a file: back to its folder
    expect(t.toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(list, { key: 'ArrowLeft' }); // an open folder: collapse
    expect(t.toggle).toHaveBeenCalledTimes(2);
  });

  it('search lists matches; picking one reveals it in the tree', async () => {
    const t = tree();
    renderTab(t);
    fireEvent.change(screen.getByPlaceholderText('Search files'), { target: { value: 'a.ts' } });
    const hit = await screen.findByRole('button', { name: 'src/a.ts' });
    fireEvent.click(hit);
    expect(t.reveal).toHaveBeenCalledWith('src/a.ts');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'src/a.ts' })).toBeNull());
  });

  it('picking a search hit selects its row', async () => {
    const t = tree();
    renderTab(t);
    fireEvent.change(screen.getByPlaceholderText('Search files'), { target: { value: 'a.ts' } });
    fireEvent.click(await screen.findByRole('button', { name: 'src/a.ts' }));
    await waitFor(() => expect(screen.getByText('a.ts').closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true'));
  });

  it('selection follows the path when rows appear above it', () => {
    const t = tree();
    const { rerender } = renderTab(t);
    const list = screen.getByRole('tree');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // src, then src/a.ts
    expect(screen.getByText('a.ts').closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true');
    const root = t.listings.get('')!;
    const next = tree({
      listings: new Map([
        ['', { ...root, entries: [{ name: 'new', isDir: true, size: 0, mtimeMs: 1 }, ...root.entries] }],
        ['src', t.listings.get('src')!],
      ]),
    });
    rerender(
      <ThemeProvider theme={darkTheme}>
        <FilesTab tree={next} />
      </ThemeProvider>,
    );
    expect(screen.getByText('a.ts').closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true');
  });

  it('arrow keys on an empty tree do nothing', () => {
    renderTab(tree({ listings: new Map(), expanded: new Set() }));
    const list = screen.getByRole('tree');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('an inline note replaces the tree when the folder is gone', () => {
    renderTab(tree({ error: 'Folder not found', listings: new Map() }));
    expect(screen.getByText('Folder not found')).toBeInTheDocument();
  });

  it('flashes rows Claude just touched', () => {
    renderTab(tree(), new Map([['src/a.ts', { kind: 'write', at: 5 }]]));
    expect(screen.getByText('a.ts').closest('[data-flash]')).toHaveAttribute('data-flash', 'write');
  });
});
