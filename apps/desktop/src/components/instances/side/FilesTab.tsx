import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/cs';
import { Box, ButtonBase, InputBase, Typography } from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { GitFileStatus } from '@watchtower/shared/fileTree.js';
import type { FileTreeState } from '../../../state/useFileTree.js';
import { CZ_DATE_FORMAT } from '../../../util/format.js';
import { branchLabel, buildRows, indexGit, rowStatus } from './fileTreeModel.js';

const STATUS_COLOR: Partial<Record<GitFileStatus, string>> = {
  modified: '#e0a43a',
  renamed: '#e0a43a',
  added: '#5fbf8f',
  untracked: '#5fbf8f',
  deleted: '#e5534b',
};
const FLASH_COLOR = { read: '#8f8cf4', write: '#d97757' } as const;
const ROW_H = 22;

// File-type tint for the icon; anything else stays neutral.
const EXT_COLOR: Record<string, string> = { ts: '#3178c6', tsx: '#3178c6', js: '#e8c547', json: '#c49a3a', md: '#8a8a86', css: '#5b8dd6', swift: '#f05138', cs: '#68217a' };

interface Props {
  tree: FileTreeState;
  /** Rows Claude just read or wrote, keyed by cwd-relative path. */
  flash?: ReadonlyMap<string, { kind: 'read' | 'write'; at: number }>;
}

/** The side panel's Files tab: git-aware tree, branch row and search. */
export function FilesTab({ tree, flash }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const idx = useMemo(() => indexGit(tree.git), [tree.git]);
  const rows = useMemo(() => buildRows(tree.listings, tree.expanded), [tree.listings, tree.expanded]);

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    let alive = true;
    tree.search(query).then((r) => alive && setHits(r), () => alive && setHits([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex((r) => r.path === selected);
    const row = rows[index];
    const step = (dir: 1 | -1) => {
      // Skip "+N more" notes; clamp at the ends; from no selection ArrowDown takes the first row.
      for (let i = index + dir; i >= 0 && i < rows.length; i += dir) {
        const r = rows[i];
        if (r && !r.isMore) {
          setSelected(r.path);
          return;
        }
      }
    };
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (!row) return;
    else if (e.key === 'ArrowRight' && row.isDir && !row.isOpen) tree.toggle(row.path);
    else if (e.key === 'ArrowLeft' && row.isDir && row.isOpen) tree.toggle(row.path);
    else if (e.key === 'ArrowLeft') {
      const parent = row.path.split('/').slice(0, -1).join('/');
      if (rows.some((r) => r.path === parent)) setSelected(parent);
    } else if (e.key === 'Enter' && row.isDir) tree.toggle(row.path);
    else return;
    e.preventDefault();
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1, pb: 1 }}>
      <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary', px: 0.5, pb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        {branchLabel(tree.git)}
      </Typography>
      <InputBase
        placeholder="Search files"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ fontSize: 12.5, px: 1, py: 0.25, mb: 0.5, borderRadius: '6px', backgroundColor: 'action.hover' }}
      />
      {tree.error ? (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', p: 1 }}>{tree.error}</Typography>
      ) : hits ? (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {hits.length === 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1 }}>No matches</Typography>}
          {hits.map((h) => (
            <ButtonBase
              key={h}
              aria-label={h}
              onClick={() => {
                tree.reveal(h);
                setSelected(h);
                setQuery('');
              }}
              sx={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 12, px: 0.5, py: 0.25, borderRadius: '4px', ':hover': { backgroundColor: 'action.hover' } }}
            >
              {h}
            </ButtonBase>
          ))}
        </Box>
      ) : (
        <Box role="tree" tabIndex={0} onKeyDown={onKeyDown} sx={{ flex: 1, overflowY: 'auto', outline: 'none' }}>
          {rows.map((r) => {
            if (r.isMore)
              return (
                <Typography key={r.path} sx={{ fontSize: 11.5, color: 'text.secondary', height: ROW_H, pl: `${r.depth * 12 + 20}px` }}>
                  {r.name}
                </Typography>
              );
            const status = rowStatus(r.path, idx);
            const totals = r.isDir ? idx.dirTotals.get(r.path) : idx.files.get(r.path);
            const fl = flash?.get(r.path);
            const ext = r.name.split('.').pop() ?? '';
            return (
              <Box
                key={r.path}
                role="treeitem"
                aria-expanded={r.isDir ? r.isOpen : undefined}
                aria-selected={r.path === selected}
                data-flash={fl?.kind}
                onClick={() => {
                  setSelected(r.path);
                  if (r.isDir) tree.toggle(r.path);
                }}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  height: ROW_H,
                  pl: `${r.depth * 12 + 2}px`,
                  pr: 0.5,
                  borderRadius: '4px',
                  cursor: 'default',
                  opacity: status === 'ignored' ? 0.45 : 1,
                  backgroundColor: r.path === selected ? 'action.selected' : 'transparent',
                  ':hover': { backgroundColor: 'action.hover' },
                }}
              >
                {fl && (
                  // Purely visual; keyed by `at` so each new touch replays the fade.
                  <Box
                    key={fl.at}
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '4px',
                      pointerEvents: 'none',
                      backgroundColor: `${FLASH_COLOR[fl.kind]}55`,
                      animation: 'wt-flash 4s ease-out forwards',
                      '@keyframes wt-flash': { from: { opacity: 1 }, to: { opacity: 0 } },
                    }}
                  />
                )}
                {r.isDir ? (
                  r.isOpen ? <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.secondary' }} /> : <ChevronRightIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                ) : (
                  <Box sx={{ width: 14 }} />
                )}
                {r.isDir ? (
                  r.isOpen ? <FolderOpenOutlinedIcon sx={{ fontSize: 15, color: '#c9a35a' }} /> : <FolderOutlinedIcon sx={{ fontSize: 15, color: '#c9a35a' }} />
                ) : (
                  <InsertDriveFileOutlinedIcon sx={{ fontSize: 14, color: EXT_COLOR[ext] ?? 'text.secondary' }} />
                )}
                <Typography noWrap data-status={status ?? undefined} sx={{ fontSize: 12.5, flex: 1, minWidth: 0, color: (status && STATUS_COLOR[status]) ?? 'text.primary' }}>
                  {r.name}
                </Typography>
                <Typography
                  noWrap
                  data-testid={r.isDir ? `totals-${r.path}` : undefined}
                  sx={{ fontSize: 11, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                >
                  {totals && (totals.added || totals.deleted)
                    ? `+${totals.added} −${totals.deleted}`
                    : r.isDir
                      ? ''
                      : dayjs(r.mtimeMs).locale('cs').format(`${CZ_DATE_FORMAT} H:mm`)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
