import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, TextField, Typography } from '@mui/material';

export function DevopsPatField({ projectId }: { projectId: number }): JSX.Element | null {
  const [loading, setLoading] = useState(true);
  const [devopsHost, setDevopsHost] = useState<string | null>(null);
  const [repoLabel, setRepoLabel] = useState<string | null>(null);
  const [hasPat, setHasPat] = useState(false);
  const [pat, setPat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const info = await window.watchtower.invoke('reviews:projectRepo', { projectId });
        if (cancelled) return;
        if (info.host !== 'azdo' || !info.devopsHost) {
          setDevopsHost(null);
          setRepoLabel(null);
          setLoading(false);
          return;
        }
        setDevopsHost(info.devopsHost);
        setRepoLabel(info.repoLabel);
        const { hasPat: has } = await window.watchtower.invoke('devops:hasPat', { host: info.devopsHost });
        if (cancelled) return;
        setHasPat(has);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading || devopsHost === null) return null;

  const save = async () => {
    if (!pat.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await window.watchtower.invoke('devops:setPat', { host: devopsHost, pat: pat.trim() });
      setHasPat(true);
      setPat('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
        AZURE DEVOPS
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontFamily: 'Menlo, monospace' }}>{repoLabel}</Typography>
        {hasPat && <Chip size="small" color="success" label="uloženo" />}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder={hasPat ? '•••••• (uloženo, ponechat beze změny)' : 'vložit PAT'}
          fullWidth
          sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
        />
        <Button variant="outlined" size="small" disabled={saving || !pat.trim()} onClick={() => void save()}>
          Uložit PAT
        </Button>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
        Jeden PAT platí pro celý server (všechny projekty na tomto hostu).
      </Typography>
    </Box>
  );
}
