import { useEffect, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { useCloudSyncConfig } from '../../state/useCloudSyncConfig.js';

export function CloudSyncTab(): JSX.Element {
  const { enabled, available, loading, error, needsRestart, save } = useCloudSyncConfig();
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraftEnabled(enabled); }, [enabled]);

  const dirty = draftEnabled !== enabled;

  const onSave = async () => {
    setSaving(true);
    try {
      await save({ enabled: draftEnabled });
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
        Push billing data to Supabase so the iPad and iPhone apps can read it. The hub is baked
        into this build; enabling starts the sync on the next launch.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && !available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This build has no hub configured, so cloud sync can't run. Rebuild with a Supabase URL to
          enable it.
        </Alert>
      )}

      <Stack spacing={2}>
        <FormControlLabel
          control={
            <Switch
              checked={draftEnabled}
              onChange={(e) => setDraftEnabled(e.target.checked)}
              disabled={loading || !available}
            />
          }
          label="Enable cloud sync"
        />

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
