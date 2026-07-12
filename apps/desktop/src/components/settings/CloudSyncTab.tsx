import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { useCloudSyncConfig } from '../../state/useCloudSyncConfig.js';

export function CloudSyncTab(): JSX.Element {
  const { enabled, configured, loading, error, needsRestart, save } = useCloudSyncConfig();
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraftEnabled(enabled); }, [enabled]);

  const dirty = draftEnabled !== enabled || url.trim().length > 0;

  const onSave = async () => {
    setSaving(true);
    try {
      await save({ enabled: draftEnabled, url: url.trim() ? url.trim() : undefined });
      setUrl('');
    } catch {
      /* error surfaced via hook.error */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 640 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>Cloud Sync</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Push billing data to Supabase so the iPad and iPhone apps can read it. The connection
        string is encrypted with your OS keychain and stored only on this Mac. Changes apply on
        the next launch.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2}>
        <FormControlLabel
          control={<Switch checked={draftEnabled} onChange={(e) => setDraftEnabled(e.target.checked)} disabled={loading} />}
          label="Enable cloud sync"
        />

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>CONNECTION STRING</Typography>
            {configured && <Chip size="small" color="success" label="saved" />}
          </Box>
          <TextField
            type="password"
            size="small"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={configured ? '•••••• (saved, leave unchanged)' : 'postgresql://…'}
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
          />
        </Box>

        <Box>
          <Button variant="contained" size="small" disabled={saving || loading || !dirty} onClick={() => void onSave()}>
            Save
          </Button>
        </Box>

        {needsRestart && (
          <Alert severity="info">Restart Watchtower to apply — cloud sync starts on next launch.</Alert>
        )}
      </Stack>
    </Box>
  );
}
