import { useState } from 'react';
import {
  Box, Stack, Typography, TextField, Switch, FormControlLabel, Button, Alert,
  MenuItem,
} from '@mui/material';
import { useHubConfig } from '../../state/useHubConfig.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import type { HubConfig } from '@watchtower/shared/hubConfig.js';

export function HubTab() {
  const { config, loading, error, save } = useHubConfig();
  const { showError } = useToast();
  const [draft, setDraft] = useState<HubConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? config;
  const patch = (p: Partial<HubConfig>) => setDraft({ ...value, ...p });

  const onSave = async () => {
    setSaving(true);
    try {
      await save(value);
      setDraft(null);
    } catch (err) {
      showError(toastMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box sx={{ p: 3 }}><Typography>Loading…</Typography></Box>;

  return (
    <Box sx={{ p: 3, maxWidth: 560, width: '100%' }}>
      <Stack spacing={2}>
        <Typography variant="h6">Messaging hub</Typography>
        <Typography variant="body2" color="text.secondary">
          APNs configuration for sending push notifications to iPad / iPhone via the messaging hub.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        <FormControlLabel
          control={<Switch checked={value.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />}
          label="Enable"
        />

        <TextField
          label="APNs key (.p8)"
          multiline
          minRows={4}
          fullWidth
          value={value.apnsKey}
          onChange={(e) => patch({ apnsKey: e.target.value })}
          placeholder="-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----"
        />
        <TextField
          label="Key ID"
          fullWidth
          value={value.apnsKeyId}
          onChange={(e) => patch({ apnsKeyId: e.target.value })}
        />
        <TextField
          label="Team ID"
          fullWidth
          value={value.apnsTeamId}
          onChange={(e) => patch({ apnsTeamId: e.target.value })}
        />
        <TextField
          select
          label="Environment"
          fullWidth
          value={value.apnsEnv}
          onChange={(e) => patch({ apnsEnv: e.target.value as HubConfig['apnsEnv'] })}
        >
          <MenuItem value="sandbox">sandbox</MenuItem>
          <MenuItem value="production">production</MenuItem>
        </TextField>

        <TextField
          label="Delay (ms)"
          type="number"
          fullWidth
          value={value.escalateMs}
          onChange={(e) => patch({ escalateMs: Number(e.target.value) })}
          inputProps={{ min: 0 }}
        />

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Triggers
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={value.triggers.permission}
                onChange={(e) =>
                  patch({ triggers: { ...value.triggers, permission: e.target.checked } })
                }
              />
            }
            label="Permission"
          />
          <FormControlLabel
            control={
              <Switch
                checked={value.triggers.idle}
                onChange={(e) =>
                  patch({ triggers: { ...value.triggers, idle: e.target.checked } })
                }
              />
            }
            label="Idle"
          />
          <FormControlLabel
            control={
              <Switch
                checked={value.triggers.crash}
                onChange={(e) =>
                  patch({ triggers: { ...value.triggers, crash: e.target.checked } })
                }
              />
            }
            label="Crash"
          />
        </Box>

        <Box>
          <Button variant="contained" onClick={onSave} disabled={saving || draft === null}>
            Save
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
