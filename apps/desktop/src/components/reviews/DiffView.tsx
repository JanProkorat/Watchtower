import { useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { DiffFilePayload, PrCommentThreadPayload, PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import { CommentThread } from './CommentThread.js';
import { FindingCard } from './FindingCard.js';
import { worstSeverity } from '../../state/useReviews.js';

const SEVERITY_DOT_COLOR: Record<PrFindingPayload['severity'], string> = {
  error: 'error.main', warn: 'warning.main', info: 'info.main',
};

export function DiffView({ files, threads = [], findings = [] }: {
  files: DiffFilePayload[]; threads?: PrCommentThreadPayload[]; findings?: PrFindingPayload[];
}): JSX.Element {
  const [active, setActive] = useState(0);
  const commentsByFile = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) {
      if (t.file) m.set(t.file, (m.get(t.file) ?? 0) + 1);
    }
    return m;
  }, [threads]);
  const findingsByFile = useMemo(() => {
    const m = new Map<string, PrFindingPayload[]>();
    for (const f of findings) {
      const list = m.get(f.file) ?? [];
      list.push(f);
      m.set(f.file, list);
    }
    return m;
  }, [findings]);
  if (files.length === 0) return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: 13 }}>No changes to display.</Typography>;
  const file = files[Math.min(active, files.length - 1)]!;
  const threadsByLine = useMemo(() => {
    const map = new Map<number, PrCommentThreadPayload[]>();
    for (const t of threads) {
      if (t.file !== file.path || t.line == null) continue;
      const list = map.get(t.line) ?? [];
      list.push(t);
      map.set(t.line, list);
    }
    return map;
  }, [threads, file.path]);
  const findingsByLine = useMemo(() => {
    const map = new Map<number, PrFindingPayload[]>();
    for (const f of findings) {
      if (f.file !== file.path) continue;
      const list = map.get(f.line) ?? [];
      list.push(f);
      map.set(f.line, list);
    }
    return map;
  }, [findings, file.path]);
  return (
    <PanelGroup direction="horizontal" autoSaveId="reviews-diff-tree" style={{ height: '100%' }}>
      <Panel defaultSize={24} minSize={12} maxSize={55}>
        <Box sx={{ height: '100%', overflow: 'auto', py: 1 }}>
          <Typography sx={{ px: 1.5, py: 0.5, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
            {files.length} files
          </Typography>
          {files.map((f, i) => {
            const commentCount = commentsByFile.get(f.path) ?? 0;
            const fileFindings = findingsByFile.get(f.path) ?? [];
            const worst = worstSeverity(fileFindings);
            return (
              <Box key={f.path} onClick={() => setActive(i)} title={f.path}
                sx={{ px: 1.5, py: 0.5, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.75,
                  bgcolor: i === active ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
                <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path.split('/').pop()}</Box>
                {worst != null && (
                  <Box component="span" title={`${fileFindings.length} finding${fileFindings.length > 1 ? 's' : ''}`}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: SEVERITY_DOT_COLOR[worst], fontSize: 10, flexShrink: 0 }}>
                    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: SEVERITY_DOT_COLOR[worst] }} />
                    {fileFindings.length}
                  </Box>
                )}
                {commentCount > 0 && (
                  <Box component="span" title={`${commentCount} comment${commentCount > 1 ? 's' : ''}`}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'primary.main', fontSize: 10, flexShrink: 0 }}>
                    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />
                    {commentCount}
                  </Box>
                )}
                <Box component="span" sx={{ color: 'success.main', fontSize: 10, flexShrink: 0 }}>+{f.additions}</Box>
                <Box component="span" sx={{ color: 'error.main', fontSize: 10, flexShrink: 0 }}>−{f.deletions}</Box>
              </Box>
            );
          })}
        </Box>
      </Panel>
      <PanelResizeHandle style={{ width: 6, background: 'rgba(255,255,255,0.08)', cursor: 'col-resize' }} />
      <Panel minSize={30}>
        <Box sx={{ height: '100%', overflow: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>
          <Typography sx={{ position: 'sticky', top: 0, px: 1.5, py: 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', fontFamily: 'inherit', fontSize: 11 }}>{file.path}</Typography>
          {file.lines.map((l, i) => {
            const lineThreads = l.newNo != null ? threadsByLine.get(l.newNo) : undefined;
            const lineFindings = l.newNo != null ? findingsByLine.get(l.newNo) : undefined;
            return (
              <Box key={i}>
                <Box sx={{ display: 'flex', px: 1.5, lineHeight: 1.6,
                  bgcolor: l.kind === 'add' ? 'success.main' : l.kind === 'del' ? 'error.main' : l.kind === 'hunk' ? 'action.hover' : 'transparent',
                  ...(l.kind === 'add' || l.kind === 'del' ? { bgcolor: (t) => `${t.palette[l.kind === 'add' ? 'success' : 'error'].main}22` } : {}) }}>
                  <Box component="span" sx={{ width: 40, color: 'text.secondary', textAlign: 'right', pr: 1.5, userSelect: 'none', flexShrink: 0 }}>{l.newNo ?? l.oldNo ?? ''}</Box>
                  <Box component="span" sx={{ whiteSpace: 'pre', color: l.kind === 'hunk' ? 'primary.main' : 'text.primary' }}>{l.text}</Box>
                </Box>
                {lineFindings && lineFindings.length > 0 && (
                  <Box sx={{ ml: 5, mr: 1.5, my: 0.5, maxWidth: 640,
                    display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {lineFindings.map((f, fi) => <FindingCard key={`${f.file}:${f.line}:${fi}`} finding={f} />)}
                  </Box>
                )}
                {lineThreads && lineThreads.length > 0 && (
                  <Box sx={{ ml: 5, mr: 1.5, my: 0.5, maxWidth: 640, bgcolor: 'action.hover', borderRadius: 1, p: 0.5,
                    display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {lineThreads.map((t) => <CommentThread key={t.id} thread={t} />)}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Panel>
    </PanelGroup>
  );
}
