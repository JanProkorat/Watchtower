import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

interface Saved {
  quietMs: string;
  defaultCwd: string;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{label}</Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
      <Box sx={{ mt: 1 }}>{children}</Box>
    </Stack>
  );
}

export function SettingsPanel() {
  const [saved, setSaved] = useState<Saved>({ quietMs: '90000', defaultCwd: '~/Projects' });
  const [quietMs, setQuietMs] = useState<string>('90000');
  const [defaultCwd, setDefaultCwd] = useState<string>('~/Projects');
  const [hookStatus, setHookStatus] = useState<string | null>(null);
  const [hookError, setHookError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.watchtower.invoke('getSetting', { key: 'quiet_timer_ms' }),
      window.watchtower.invoke('getSetting', { key: 'default_cwd' }),
    ]).then(([q, c]) => {
      if (cancelled) return;
      const next: Saved = {
        quietMs: q.value || '90000',
        defaultCwd: c.value || '~/Projects',
      };
      setSaved(next);
      setQuietMs(next.quietMs);
      setDefaultCwd(next.defaultCwd);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (key: string, value: string) => {
    await window.watchtower.invoke('setSetting', { key, value });
  };

  const onQuietBlur = async () => {
    if (quietMs === saved.quietMs) return;
    const n = Number(quietMs);
    if (!Number.isFinite(n) || n < 1000) {
      setQuietMs(saved.quietMs);
      return;
    }
    await persist('quiet_timer_ms', quietMs);
    setSaved((s) => ({ ...s, quietMs }));
  };

  const onCwdBlur = async () => {
    if (defaultCwd === saved.defaultCwd) return;
    await persist('default_cwd', defaultCwd);
    setSaved((s) => ({ ...s, defaultCwd }));
  };

  const reinstallHooks = async () => {
    setHookError(null);
    setHookStatus('Working…');
    try {
      const res = await window.watchtower.invoke('installHooks', {});
      setHookStatus(
        res.changed
          ? `Reinstalled${res.backedUp ? ` (backup: ${res.backedUp})` : ''}.`
          : 'Already installed — no change.',
      );
    } catch (e) {
      setHookError(e instanceof Error ? e.message : String(e));
      setHookStatus(null);
    }
  };

  const uninstallHooks = async () => {
    setHookError(null);
    setHookStatus('Working…');
    try {
      const res = await window.watchtower.invoke('uninstallHooks', {});
      setHookStatus(
        res.changed ? 'Uninstalled — Watchtower entries removed.' : 'Nothing to uninstall.',
      );
    } catch (e) {
      setHookError(e instanceof Error ? e.message : String(e));
      setHookStatus(null);
    }
  };

  const sendTest = async () => {
    await window.watchtower.invoke('sendTestNotification', {});
  };

  return (
    <Box sx={{ p: 4, height: '100%', overflow: 'auto', maxWidth: 720 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Settings
      </Typography>
      <Stack spacing={3}>
        <SettingRow
          label="Notification quiet timer"
          description="How long (ms) Claude stays at end-of-turn before Watchtower escalates to a notification. Default 90 000."
        >
          <TextField
            size="small"
            value={quietMs}
            onChange={(e) => setQuietMs(e.target.value)}
            onBlur={() => void onQuietBlur()}
            slotProps={{ input: { sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } } }}
            sx={{ maxWidth: 200 }}
          />
        </SettingRow>

        <SettingRow
          label="Default working directory"
          description="Pre-filled in the New Instance modal."
        >
          <TextField
            size="small"
            fullWidth
            value={defaultCwd}
            onChange={(e) => setDefaultCwd(e.target.value)}
            onBlur={() => void onCwdBlur()}
            slotProps={{ input: { sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } } }}
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Claude Code hooks"
          description="Watchtower needs hooks in ~/.claude/settings.json to receive SessionStart / Notification / Stop events. Hooks installed on first run can be reinstalled (e.g. after a helper path change) or removed entirely."
        >
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" onClick={() => void reinstallHooks()}>
              Reinstall hooks
            </Button>
            <Button variant="outlined" size="small" color="warning" onClick={() => void uninstallHooks()}>
              Uninstall hooks
            </Button>
          </Stack>
          {hookStatus && (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              {hookStatus}
            </Alert>
          )}
          {hookError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {hookError}
            </Alert>
          )}
        </SettingRow>

        <Divider />

        <SettingRow
          label="Diagnostics"
          description="Verify macOS notification permissions or reset first-run state."
        >
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" onClick={() => void sendTest()}>
              Send test notification
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() =>
                void window.watchtower.invoke('setSetting', {
                  key: 'first_run_completed_at',
                  value: '',
                })
              }
            >
              Reset first-run flag
            </Button>
          </Stack>
        </SettingRow>
      </Stack>
    </Box>
  );
}
