import { useEffect, useState } from 'react';
import { Box, Button, Chip, TextField, Typography } from '@mui/material';
import { invoke } from '../../state/ipc';
import { patFieldView, type PatFieldStatus } from './patFieldView';

export function DevopsPatField({ projectId }: { projectId: number }): JSX.Element | null {
  const [loading, setLoading] = useState(true);
  const [devopsHost, setDevopsHost] = useState<string | null>(null);
  const [repoLabel, setRepoLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<PatFieldStatus>('none');
  const [pat, setPat] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const info = await invoke('reviews:projectRepo', { projectId });
        if (cancelled) return;
        if (info.host !== 'azdo' || !info.devopsHost) {
          setDevopsHost(null);
          setRepoLabel(null);
          setLoading(false);
          return;
        }
        setDevopsHost(info.devopsHost);
        setRepoLabel(info.repoLabel);
        const { hasPat: has, unreadable } = await invoke('devops:hasPat', { host: info.devopsHost });
        if (cancelled) return;
        setStatus(unreadable ? 'unreadable' : has ? 'saved' : 'none');
      } catch {
        /* surfaced via the global error toast */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading || devopsHost === null) return null;

  const view = patFieldView(status);

  const save = async () => {
    if (!pat.trim()) return;
    setSaving(true);
    try {
      await invoke('devops:setPat', { host: devopsHost, pat: pat.trim() });
      setStatus('saved');
      setPat('');
    } catch {
      /* surfaced via the global error toast */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
        AZURE DEVOPS
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontFamily: 'Menlo, monospace' }}>{repoLabel}</Typography>
        {view.chip && <Chip size="small" color={view.chip.color} label={view.chip.label} />}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder={view.placeholder}
          fullWidth
          sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
        />
        <Button variant="outlined" size="small" disabled={saving || !pat.trim()} onClick={() => void save()}>
          Save PAT
        </Button>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
        One PAT applies to the whole server (all projects on this host).
      </Typography>
    </Box>
  );
}
