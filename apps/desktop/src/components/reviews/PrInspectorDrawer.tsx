import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, Tabs, Tab, Alert, CircularProgress } from '@mui/material';
import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import { DiffView } from './DiffView.js';

export function PrInspectorDrawer({ pr, onClose, loadDiff }: {
  pr: PullRequestPayload | null; onClose(): void;
  loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]>;
}): JSX.Element {
  const [tab, setTab] = useState(0);
  const [files, setFiles] = useState<DiffFilePayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pr) return;
    setTab(0); setFiles([]); setError(null); setLoading(true);
    void loadDiff(pr).then(setFiles).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, [pr, loadDiff]);

  return (
    <Drawer anchor="right" open={pr != null} onClose={onClose} PaperProps={{ sx: { width: 'min(1200px, 92vw)', maxWidth: '92vw', display: 'flex', flexDirection: 'column' } }}>
      {pr && (
        <>
          <Box sx={{ p: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              {(pr.host === 'github' ? '#' : '!') + pr.number} · {pr.title}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
              {pr.repoLabel} · {pr.sourceBranch} → {pr.targetBranch} · {pr.author}
            </Typography>
          </Box>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 1, minHeight: 40 }}>
            <Tab label={`Diff${files.length ? ` (${files.length})` : ''}`} sx={{ minHeight: 40 }} />
            <Tab label="Report" sx={{ minHeight: 40 }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {tab === 0 && (
              <>
                {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
                {loading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}
                {!loading && !error && <DiffView files={files} />}
              </>
            )}
            {tab === 1 && (
              <Typography sx={{ p: 2, color: 'text.secondary', fontSize: 13 }}>
                Zatím bez recenze. Spuštění review agenta přijde v dalším kroku (SP2).
              </Typography>
            )}
          </Box>
        </>
      )}
    </Drawer>
  );
}
