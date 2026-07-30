import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { CZ_DATE_FORMAT } from '../util/format.js';
import { WORKLOG_LOCK_SETTING_KEY } from '../util/lockSetting.js';
import { invoke } from '../state/ipc';
import { useStatuslineCapture } from '../state/useStatuslineCapture';
import { glassSurface } from '../theme/glass.js';
import { SettingRow } from './settings/SettingRow.js';
import { MeetingTaskSettings } from './settings/MeetingTaskSettings.js';

interface Saved {
  quietMs: string;
  defaultCwd: string;
  sprintStartDate: string;
  sprintLengthDays: string;
}

export function SettingsPanel() {
  const theme = useTheme();
  const capture = useStatuslineCapture();
  const [saved, setSaved] = useState<Saved>({
    quietMs: '90000',
    defaultCwd: '~/Projects',
    sprintStartDate: '2026-01-05',
    sprintLengthDays: '14',
  });
  const [quietMs, setQuietMs] = useState<string>('90000');
  const [defaultCwd, setDefaultCwd] = useState<string>('~/Projects');
  const [sprintStartDate, setSprintStartDate] = useState<string>('2026-01-05');
  const [sprintLengthDays, setSprintLengthDays] = useState<string>('14');
  const [hookStatus, setHookStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      invoke('getSetting', { key: 'quiet_timer_ms' }),
      invoke('getSetting', { key: 'default_cwd' }),
      invoke('getSetting', { key: 'dashboard.sprint.startDate' }),
      invoke('getSetting', { key: 'dashboard.sprint.lengthDays' }),
    ]).then(([q, c, sd, sl]) => {
      if (cancelled) return;
      const next: Saved = {
        quietMs: q.value || '90000',
        defaultCwd: c.value || '~/Projects',
        sprintStartDate: sd.value || '2026-01-05',
        sprintLengthDays: sl.value || '14',
      };
      setSaved(next);
      setQuietMs(next.quietMs);
      setDefaultCwd(next.defaultCwd);
      setSprintStartDate(next.sprintStartDate);
      setSprintLengthDays(next.sprintLengthDays);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (key: string, value: string) => {
    await invoke('setSetting', { key, value });
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

  const onSprintStartChange = async (val: string) => {
    setSprintStartDate(val);
    await persist('dashboard.sprint.startDate', val);
    setSaved((s) => ({ ...s, sprintStartDate: val }));
  };

  const onSprintLengthBlur = async () => {
    if (sprintLengthDays === saved.sprintLengthDays) return;
    const n = Number(sprintLengthDays);
    if (!Number.isInteger(n) || n < 1 || n > 56) {
      setSprintLengthDays(saved.sprintLengthDays);
      return;
    }
    await persist('dashboard.sprint.lengthDays', sprintLengthDays);
    setSaved((s) => ({ ...s, sprintLengthDays }));
  };

  const reinstallHooks = async () => {
    setHookStatus('Working…');
    try {
      const res = await invoke('installHooks', {});
      setHookStatus(
        res.changed
          ? `Reinstalled${res.backedUp ? ` (backup: ${res.backedUp})` : ''}.`
          : 'Already installed — no change.',
      );
    } catch {
      setHookStatus(null);
    }
  };

  const uninstallHooks = async () => {
    setHookStatus('Working…');
    try {
      const res = await invoke('uninstallHooks', {});
      setHookStatus(
        res.changed ? 'Uninstalled — Watchtower entries removed.' : 'Nothing to uninstall.',
      );
    } catch {
      setHookStatus(null);
    }
  };

  const sendTest = async () => {
    await invoke('sendTestNotification', {});
  };

  return (
    // glassSurface: singleton panel that fills the General tab viewport
    <Box sx={{ p: 4, height: '100%', overflow: 'auto', ...glassSurface(theme, { elevation: 1 }) }}>
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
            InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
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
            InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Sprint start date"
          description="Reference date used to compute past and future sprints in the Dashboard."
        >
          <DatePicker
            value={dayjs(sprintStartDate)}
            onChange={(v) => { if (v) void onSprintStartChange(v.format('YYYY-MM-DD')); }}
            slotProps={{ textField: { size: 'small' } }}
          />
        </SettingRow>

        <SettingRow
          label="Sprint length (days)"
          description="How long each sprint lasts. Commonly 7, 14, or 21 days."
        >
          <TextField
            type="number"
            size="small"
            value={sprintLengthDays}
            onChange={(e) => setSprintLengthDays(e.target.value)}
            onBlur={() => void onSprintLengthBlur()}
            inputProps={{ min: 1, max: 56 }}
            sx={{ width: 100 }}
          />
        </SettingRow>

        <Divider />

        <WorklogLockSettings />

        <Divider />

        <MeetingTaskSettings />

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
        </SettingRow>

        <Divider />

        <SettingRow
          label="Capture usage from statusline"
          description="Wrap the Claude Code statusLine command so Watchtower can show Session + Week usage bars. Reversible; backs up settings.json."
        >
          <Switch
            checked={capture.enabled}
            disabled={capture.loading || (!capture.available && !capture.enabled)}
            onChange={(e) => void capture.save(e.target.checked)}
            size="small"
          />
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
                void invoke('setSetting', {
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

function WorklogLockSettings() {
  const [lockDate, setLockDate] = useState<Dayjs | null>(null);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('getSetting', { key: WORKLOG_LOCK_SETTING_KEY })
      .then((r) => {
        if (cancelled) return;
        const v = r.value?.trim() || null;
        setSavedValue(v);
        setLockDate(v ? dayjs(v) : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const valid = lockDate === null || (lockDate?.isValid() ?? false);
  const nextValue = lockDate?.isValid() ? lockDate.format('YYYY-MM-DD') : null;
  const dirty = nextValue !== savedValue;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      // Empty string clears the setting — the WorklogsRepo treats anything
      // not matching YYYY-MM-DD as "no lock", and useWorklogLock matches.
      await invoke('setSetting', {
        key: WORKLOG_LOCK_SETTING_KEY,
        value: nextValue ?? '',
      });
      setSavedValue(nextValue);
      // Notify open useWorklogLock subscribers to re-read without an
      // app-wide invalidation channel.
      window.dispatchEvent(new Event('worklog-lock-changed'));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      /* surfaced via the global error toast */
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      label="Worklog lock"
      description="Once a month is invoiced, set the lock to the last day of that month. Worklogs on or before this date can't be added, edited, or deleted — unlock by clearing the field."
    >
      {loading ? (
        <CircularProgress size={20} />
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
          <DatePicker
            label="Lock through"
            value={lockDate}
            onChange={(v) => setLockDate(v)}
            format={CZ_DATE_FORMAT}
            slotProps={{
              textField: { size: 'small', sx: { width: { xs: '100%', sm: 220 } } },
              field: { clearable: true },
            }}
          />
          <Button
            variant="contained"
            size="small"
            disabled={!valid || busy || !dirty}
            onClick={() => void save()}
            sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
          >
            {busy ? 'Saving…' : nextValue ? 'Save' : 'Clear'}
          </Button>
        </Stack>
      )}
      {savedFlash && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <CheckCircleIcon color="success" fontSize="small" />
          <Typography variant="body2" color="success.main">
            Saved
          </Typography>
        </Stack>
      )}
    </SettingRow>
  );
}
