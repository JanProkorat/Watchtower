import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { invoke } from '../../state/ipc';
import type {
  EpicWithProjectPayload,
  TaskByNumberPayload,
} from '@watchtower/shared/ipcContract.js';
import { SettingRow } from './SettingRow.js';

/**
 * Meeting → worklog routing targets.
 *
 * `/sync-meetings` fetches the calendar and hands the events to
 * `~/.claude/commands/log-meetings.mjs`, which reads these keys out of the
 * `settings` table to decide where each meeting lands. No task number is
 * hardcoded in the routing: an unset key means the matching meetings are
 * reported as *unresolved* and nothing is logged for them.
 *
 * The in-repo mirror of the rules is `orchestrator/services/meetingRules.ts`.
 */
export const MEETINGS_DEFAULT_TASK_KEY = 'meetings.default_task_id';
export const MEETINGS_ONE_ON_ONE_TASK_KEY = 'meetings.one_on_one_task_id';
export const MEETINGS_ALL_COMPANY_TASK_KEY = 'meetings.all_company_task_id';

interface MeetingTaskSettingProps {
  /** Which `settings` row this picker reads and writes. */
  settingKey: string;
  label: string;
  description: string;
  /** Example task number for the empty TextField. */
  placeholder: string;
  /**
   * Shown while the setting is unset. Omit for the default-task row, where an
   * empty value is a soft fallback rather than a routing hole.
   */
  unsetWarning?: string;
}

/**
 * One task picker bound to a single meetings setting key. Type a task number →
 * it resolves to a Project · Epic · Title chip → Save stores the task id. If
 * the number doesn't exist yet, an inline create form offers to make the task
 * and save it in one step.
 */
export function MeetingTaskSetting({
  settingKey,
  label,
  description,
  placeholder,
  unsetWarning,
}: MeetingTaskSettingProps) {
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskNumber, setTaskNumber] = useState('');
  const [resolved, setResolved] = useState<TaskByNumberPayload | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Create-task fallback (shown when lookup returns null).
  const [showCreate, setShowCreate] = useState(false);
  const [allEpics, setAllEpics] = useState<EpicWithProjectPayload[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newEpicId, setNewEpicId] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);

  // Initial load: read the setting, then resolve the saved task id into the
  // joined Project · Epic · Title chip + pre-fill the number TextField so the
  // user can see what's currently configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await invoke('getSetting', { key: settingKey });
        if (cancelled) return;
        const v = s.value?.trim() || null;
        setSavedTaskId(v);
        if (!v) return;
        const id = Number(v);
        if (!Number.isFinite(id)) return;
        const r = await invoke('tasks:findById', { id });
        if (cancelled) return;
        if (r.task) {
          setTaskNumber(r.task.number);
          setResolved(r.task);
        }
      } catch {
        /* surfaced via the global error toast */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingKey]);

  const lookup = async (number: string) => {
    const trimmed = number.trim();
    setLookupError(null);
    setResolved(null);
    setShowCreate(false);
    if (!trimmed) return;
    setLookingUp(true);
    try {
      const r = await invoke('tasks:findByNumber', { number: trimmed });
      if (r.task) {
        setResolved(r.task);
      } else {
        setLookupError(`No task with number "${trimmed}".`);
        setNewTitle(trimmed);
        setShowCreate(true);
        // Lazy-load epics for the picker.
        if (allEpics.length === 0) {
          const ep = await invoke('epics:listAll', {});
          setAllEpics(ep.epics);
        }
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookingUp(false);
    }
  };

  // Seed a sensible default for the epic picker when the create form opens.
  useEffect(() => {
    if (!showCreate || newEpicId !== '' || allEpics.length === 0) return;
    const meetings =
      allEpics.find((e) => /meeting/i.test(e.name) && /green/i.test(e.projectName)) ??
      allEpics.find((e) => /meeting/i.test(e.name)) ??
      allEpics[0];
    if (meetings) setNewEpicId(meetings.id);
  }, [showCreate, allEpics, newEpicId]);

  const persistTaskId = async (id: number) => {
    setBusy(true);
    try {
      await invoke('setSetting', { key: settingKey, value: String(id) });
      setSavedTaskId(String(id));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      /* surfaced via the global error toast */
    } finally {
      setBusy(false);
    }
  };

  const saveResolved = async () => {
    if (!resolved) return;
    await persistTaskId(resolved.id);
  };

  const createAndSave = async () => {
    if (newEpicId === '' || !taskNumber.trim() || !newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await invoke('tasks:create', {
        epicId: newEpicId,
        number: taskNumber.trim(),
        title: newTitle.trim(),
      });
      // Pull the joined view so the chip displays correctly.
      const r = await invoke('tasks:findByNumber', { number: created.task.number });
      if (r.task) setResolved(r.task);
      setShowCreate(false);
      setLookupError(null);
      await persistTaskId(created.task.id);
    } catch {
      /* surfaced via the global error toast */
    } finally {
      setCreating(false);
    }
  };

  return (
    <SettingRow label={label} description={description}>
      {loading ? (
        <CircularProgress size={20} />
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
          <TextField
            label="Task number"
            placeholder={placeholder}
            size="small"
            value={taskNumber}
            onChange={(e) => {
              setTaskNumber(e.target.value);
              setResolved(null);
              setLookupError(null);
              setShowCreate(false);
            }}
            onBlur={() => void lookup(taskNumber)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void lookup(taskNumber);
            }}
            sx={{ width: { xs: '100%', sm: 220 } }}
          />
          <Button
            variant="contained"
            size="small"
            disabled={!resolved || lookingUp || busy}
            onClick={() => void saveResolved()}
            sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      )}

      <Box sx={{ mt: 1 }}>
        {lookingUp && <CircularProgress size={16} />}
        {lookupError && !showCreate && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {lookupError}
          </Alert>
        )}
        {resolved && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Chip
              size="small"
              sx={{ bgcolor: resolved.projectColor, color: '#fff' }}
              label={resolved.projectName}
            />
            <Typography variant="body2" color="text.secondary">
              {resolved.epicName} ·
            </Typography>
            <Typography variant="body2">{resolved.title}</Typography>
          </Stack>
        )}
        {!resolved && savedTaskId && !lookingUp && !lookupError && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Saved task id <strong>{savedTaskId}</strong> couldn't be resolved
            (deleted?). Pick a new one.
          </Alert>
        )}
        {/* Unset rule → the sync reports those meetings instead of filing them
            somewhere arbitrary, so say so before the next sync surprises us. */}
        {!loading && !savedTaskId && unsetWarning && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {unsetWarning}
          </Alert>
        )}
        {savedFlash && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <CheckCircleIcon color="success" fontSize="small" />
            <Typography variant="body2" color="success.main">
              Saved
            </Typography>
          </Stack>
        )}
      </Box>

      {showCreate && (
        <Box sx={{ mt: 2 }}>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            No task with number <strong>{taskNumber.trim()}</strong> exists yet.
            Create it and use it here in one step:
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
            <TextField
              label="Title"
              size="small"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              sx={{ flexGrow: 1, minWidth: 220 }}
            />
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Epic</InputLabel>
              <Select
                label="Epic"
                value={newEpicId}
                onChange={(e) => setNewEpicId(Number(e.target.value))}
              >
                {allEpics.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: e.projectColor,
                        }}
                      />
                      <span>
                        {e.projectName} › {e.name}
                      </span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              size="small"
              disabled={creating || newEpicId === '' || !newTitle.trim() || !taskNumber.trim()}
              onClick={() => void createAndSave()}
              sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
            >
              {creating ? 'Creating…' : 'Create & save'}
            </Button>
          </Stack>
        </Box>
      )}
    </SettingRow>
  );
}

/**
 * The Meetings block of Settings → General: one task picker per routing rule.
 * Order matches the order `decide()` evaluates them in, so the panel reads like
 * the rule chain it configures.
 */
export function MeetingTaskSettings() {
  return (
    <Stack spacing={2.5}>
      <Typography variant="overline" color="text.secondary">
        Meetings
      </Typography>
      <MeetingTaskSetting
        settingKey={MEETINGS_ONE_ON_ONE_TASK_KEY}
        label="1:1 & .NET sync task"
        description='Meetings whose subject contains "1:1" or ".NET sync" are logged under this task.'
        placeholder="GREEN-100"
        unsetWarning="Not set — 1:1 and .NET sync meetings will be reported as unresolved and not logged."
      />
      <MeetingTaskSetting
        settingKey={MEETINGS_ALL_COMPANY_TASK_KEY}
        label="All-company meeting task"
        description='Meetings whose subject matches "celofiremní porada" are logged under this task.'
        placeholder="GREEN-34"
        unsetWarning="Not set — all-company meetings will be reported as unresolved and not logged."
      />
      <MeetingTaskSetting
        settingKey={MEETINGS_DEFAULT_TASK_KEY}
        label="Default meetings task"
        description="Fallback for every other meeting, unless its subject carries a known task number. Update it whenever your sprint task number changes."
        placeholder="GREEN-345"
      />
    </Stack>
  );
}
