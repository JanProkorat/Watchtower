import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, TextField, Button, Stack, Alert, Chip } from '@mui/material';
import type { DevopsRepoConfigPayload } from '@watchtower/shared/ipcContract.js';

export function ConnectDevopsDrawer({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(): void }): JSX.Element {
  const [orgBaseUrl, setOrgBaseUrl] = useState('');
  const [reposText, setReposText] = useState(''); // "PPS/technology" per line
  const [pat, setPat] = useState('');
  const [hasPat, setHasPat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setPat('');
    void (async () => {
      const cfg = await window.watchtower.invoke('reviews:getDevopsConfig', {});
      setOrgBaseUrl(cfg.orgBaseUrl);
      setReposText(cfg.repos.map((r) => `${r.project}/${r.repo}`).join('\n'));
      setHasPat(cfg.hasPat);
    })();
  }, [open]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const repos: DevopsRepoConfigPayload[] = reposText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [project, repo] = l.split('/');
        return { orgBaseUrl, project: project!, repo: repo! };
      });
      await window.watchtower.invoke('reviews:setDevopsConfig', { orgBaseUrl, repos });
      if (pat.trim()) await window.watchtower.invoke('devops:setPat', { pat: pat.trim() });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 460 } }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Připojit Azure DevOps</Typography>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        <Stack spacing={2}>
          <TextField label="Collection / org URL" value={orgBaseUrl} onChange={(e) => setOrgBaseUrl(e.target.value)}
            placeholder="https://devops.skoda/tfs/DefaultCollection" fullWidth size="small" />
          <TextField label="Repozitáře (project/repo na řádek)" value={reposText} onChange={(e) => setReposText(e.target.value)}
            placeholder={'PPS/technology\nSpot/spot'} fullWidth multiline minRows={3} size="small" />
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
              Personal Access Token {hasPat && <Chip size="small" label="uloženo" color="success" sx={{ ml: 1 }} />}
            </Typography>
            <TextField type="password" value={pat} onChange={(e) => setPat(e.target.value)}
              placeholder={hasPat ? '•••••• (ponechat beze změny)' : 'vložit PAT'} fullWidth size="small" />
          </Box>
          <Button variant="contained" disabled={saving} onClick={() => void save()}>Uložit</Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
