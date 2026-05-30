import { useState } from 'react';
import {
  Box, Stack, Typography, TextField, Switch, FormControlLabel, Button, Alert, Divider, Chip,
} from '@mui/material';
import { useSlackConfig } from '../../state/useSlackConfig.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import type { SlackConfig } from '../../../../shared/slackConfig.js';

export function SlackTab() {
  const { config, connected, loading, error, save, sendTest } = useSlackConfig();
  const { showError } = useToast();
  const [draft, setDraft] = useState<SlackConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const value = draft ?? config;
  const patch = (p: Partial<SlackConfig>) => setDraft({ ...value, ...p });

  const onSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await save(value);
      setDraft(null);
    } catch (err) {
      showError(toastMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTestResult(null);
    try {
      const res = await sendTest();
      setTestResult(res.ok ? { ok: true, text: 'Sent — check your Slack DM.' } : { ok: false, text: res.error ?? 'failed' });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  if (loading) return <Box sx={{ p: 3 }}><Typography>Loading…</Typography></Box>;

  return (
    <Box sx={{ p: 3, maxWidth: 560, width: '100%' }}>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">Slack escalation</Typography>
          {connected && <Chip size="small" color="success" label="configured" />}
        </Box>
        <Typography variant="body2" color="text.secondary">
          When an instance needs you and the Watchtower window is unfocused, escalate to a Slack DM
          after a delay. Reply in the thread to send input back into the session.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        <FormControlLabel
          control={<Switch checked={value.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />}
          label="Enable Slack escalation"
        />

        <TextField
          label="Bot token (xoxb-…)" type="password" fullWidth value={value.botToken}
          onChange={(e) => patch({ botToken: e.target.value })}
        />
        <TextField
          label="App-level token (xapp-…, for replies)" type="password" fullWidth value={value.appToken}
          onChange={(e) => patch({ appToken: e.target.value })}
        />
        <TextField
          label="Your Slack user id (e.g. U0123ABCD)" fullWidth value={value.dmUserId}
          onChange={(e) => patch({ dmUserId: e.target.value })}
        />
        <TextField
          label="Escalate after (minutes)" type="number" fullWidth
          value={Math.round(value.escalateMs / 60_000)}
          onChange={(e) => patch({ escalateMs: Math.max(1, Number(e.target.value)) * 60_000 })}
        />

        <Divider />
        <Typography variant="subtitle2">Triggers</Typography>
        <FormControlLabel
          control={<Switch checked={value.triggers.permission} onChange={(e) => patch({ triggers: { ...value.triggers, permission: e.target.checked } })} />}
          label="Permission prompts"
        />
        <FormControlLabel
          control={<Switch checked={value.triggers.idle} onChange={(e) => patch({ triggers: { ...value.triggers, idle: e.target.checked } })} />}
          label="Finished / waiting for input"
        />
        <FormControlLabel
          control={<Switch checked={value.triggers.crash} onChange={(e) => patch({ triggers: { ...value.triggers, crash: e.target.checked } })} />}
          label="Crashes / exits"
        />

        {testResult && <Alert severity={testResult.ok ? 'success' : 'error'}>{testResult.text}</Alert>}

        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={onSave} disabled={saving || draft === null}>Save</Button>
          <Button variant="outlined" onClick={onTest} disabled={!value.botToken || !value.dmUserId}>Send test message</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
