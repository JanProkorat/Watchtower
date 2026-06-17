import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Divider,
  IconButton,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import {
  CZ_DATE_FORMAT,
  effectiveMinutes,
  formatEarnings,
  formatMinutes,
  formatWeekdayDateLongCz,
  parseMinutes,
} from '../../util/format.js';
import { isLocked, useWorklogLock } from '../../util/lockSetting.js';
import type {
  ContractViewPayload,
  WorklogViewPayload,
} from '../../../../shared/ipcContract.js';

interface Props {
  anchor: HTMLElement | null;
  /** ISO yyyy-mm-dd of the cell — drives the header + create work_date. */
  ymd: string;
  /** Task whose cell was clicked. Null while the popover is closing. */
  taskId: number | null;
  /** Owning project for rate lookups. */
  projectId: number | null;
  onClose(): void;
  /** Called after any successful create / update / delete so the grid refreshes. */
  onChanged(): void;
}

/**
 * Click-on-cell editor. Shows every worklog for the (task, day) pair with
 * inline edit / add / delete / Jira-sync toggling — no drawer round-trips
 * for everyday changes. Earnings are computed client-side from the project's
 * rate active on `ymd` so the popover doesn't need a custom IPC.
 */
export function WorklogCellPopover({
  anchor,
  ymd,
  taskId,
  projectId,
  onClose,
  onChanged,
}: Props) {
  const open = anchor != null;
  const lockedThrough = useWorklogLock();
  const dayLocked = isLocked(ymd, lockedThrough);

  const [worklogs, setWorklogs] = useState<WorklogViewPayload[]>([]);
  const [rate, setRate] = useState<ContractViewPayload | null>(null);

  // Inline edit state.
  const [editId, setEditId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState<Dayjs>(dayjs(ymd));
  const [editMinutes, setEditMinutes] = useState('');
  const [editReported, setEditReported] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Surfaces a failed mutation (e.g. the worklog's task is Done, or the day
  // became locked) inline instead of silently swallowing the rejection.
  const [actionError, setActionError] = useState<string | null>(null);

  // Inline add state.
  const [isAdding, setIsAdding] = useState(false);
  const [addMinutes, setAddMinutes] = useState('');
  const [addReported, setAddReported] = useState('');
  const [addDescription, setAddDescription] = useState('');

  // Reset on close so re-opening a different cell doesn't show stale state.
  useEffect(() => {
    if (!open) {
      setEditId(null);
      setIsAdding(false);
      setAddMinutes('');
      setAddReported('');
      setAddDescription('');
      setWorklogs([]);
      setRate(null);
      setActionError(null);
    }
  }, [open]);

  // Fetch the day's worklogs + the active rate every time the cell changes.
  useEffect(() => {
    if (!open || taskId == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.watchtower.invoke('worklogs:list', {
          taskId,
          from: ymd,
          to: ymd,
        });
        if (!cancelled) setWorklogs(res.worklogs);
      } catch {
        if (!cancelled) setWorklogs([]);
      }
    })();
    if (projectId != null) {
      void (async () => {
        try {
          const res = await window.watchtower.invoke('contracts:listForProject', {
            projectId,
          });
          if (cancelled) return;
          // Pick the rate whose [effectiveFrom, endDate] contains ymd. Falls
          // back to null so the earnings column renders blank rather than
          // showing a stale rate.
          const active =
            res.contracts.find(
              (c) =>
                c.effectiveFrom <= ymd && (c.endDate === null || c.endDate >= ymd),
            ) ?? null;
          setRate(active);
        } catch {
          if (!cancelled) setRate(null);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [open, taskId, projectId, ymd]);

  // Auto-show the add panel when the list is empty + the day isn't locked, so
  // a click on an empty cell goes straight to entry. Skip while editing.
  useEffect(() => {
    if (open && worklogs.length === 0 && !dayLocked && editId == null) {
      setIsAdding(true);
    }
  }, [open, worklogs.length, dayLocked, editId]);

  const computeEarned = (minutes: number): number | null => {
    if (!rate) return null;
    const hours = minutes / 60;
    return rate.rateType === 'hourly'
      ? hours * rate.rateAmount
      : (hours / rate.hoursPerDay) * rate.rateAmount;
  };

  const reload = async () => {
    if (taskId == null) return;
    try {
      const res = await window.watchtower.invoke('worklogs:list', {
        taskId,
        from: ymd,
        to: ymd,
      });
      setWorklogs(res.worklogs);
    } catch {
      // ignore — keep showing the last good list
    }
  };

  // Runs a worklog mutation, surfacing any rejection (locked day, Done task)
  // as an inline alert. Returns true on success so callers can clear edit
  // state only when the write actually landed.
  const runMutation = async (fn: () => Promise<void>): Promise<boolean> => {
    setActionError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const startEdit = (entry: WorklogViewPayload) => {
    setEditId(entry.id);
    setEditDate(dayjs(entry.workDate));
    setEditMinutes(formatMinutes(entry.minutes));
    setEditReported(
      entry.reportedMinutes == null ? '' : formatMinutes(entry.reportedMinutes),
    );
    setEditDescription(entry.description ?? '');
  };

  const commitEdit = async () => {
    if (editId == null) return;
    if (!editDate.isValid()) return;
    const minutes = parseMinutes(editMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const reportedTrimmed = editReported.trim();
    let reportedMinutes: number | null = null;
    if (reportedTrimmed !== '') {
      const parsed = parseMinutes(editReported);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      reportedMinutes = parsed;
    }
    const ok = await runMutation(async () => {
      await window.watchtower.invoke('worklogs:update', {
        id: editId,
        input: {
          workDate: editDate.format('YYYY-MM-DD'),
          minutes,
          reportedMinutes,
          description: editDescription.trim() === '' ? null : editDescription.trim(),
        },
      });
    });
    if (!ok) return;
    setEditId(null);
    await reload();
    onChanged();
  };

  const toggleJiraUploaded = async (entry: WorklogViewPayload) => {
    if (dayLocked) return;
    const ok = await runMutation(async () => {
      await window.watchtower.invoke('worklogs:update', {
        id: entry.id,
        input: { jiraUploaded: !entry.jiraUploaded },
      });
    });
    if (!ok) return;
    await reload();
    onChanged();
  };

  const deleteEntry = async (entry: WorklogViewPayload) => {
    if (dayLocked) return;
    const ok = await runMutation(async () => {
      await window.watchtower.invoke('worklogs:delete', { id: entry.id });
    });
    if (!ok) return;
    await reload();
    onChanged();
  };

  const addMinutesParsed = parseMinutes(addMinutes);
  const addMinutesValid =
    Number.isFinite(addMinutesParsed) &&
    addMinutesParsed > 0 &&
    addMinutesParsed <= 24 * 60;
  const addReportedTrimmed = addReported.trim();
  const addReportedParsed =
    addReportedTrimmed === '' ? null : parseMinutes(addReported);
  const addReportedValid =
    addReportedParsed === null ||
    (Number.isFinite(addReportedParsed) &&
      addReportedParsed > 0 &&
      addReportedParsed <= 24 * 60);
  const addValid =
    addMinutesValid &&
    addReportedValid &&
    taskId != null &&
    !dayLocked;

  const commitAdd = async () => {
    if (!addValid || taskId == null) return;
    const ok = await runMutation(async () => {
      await window.watchtower.invoke('worklogs:create', {
        taskId,
        workDate: ymd,
        minutes: addMinutesParsed,
        reportedMinutes: addReportedParsed,
        description: addDescription.trim() === '' ? null : addDescription.trim(),
      });
    });
    if (!ok) return;
    setIsAdding(false);
    setAddMinutes('');
    setAddReported('');
    setAddDescription('');
    await reload();
    onChanged();
  };

  const totalMinutes = worklogs.reduce((acc, e) => acc + effectiveMinutes({
    minutes: e.minutes,
    reported_minutes: e.reportedMinutes,
  }), 0);

  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { sx: { p: 2, maxWidth: 540, minWidth: 480 } } }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'capitalize' }}
          >
            {formatWeekdayDateLongCz(ymd)}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography
              variant="subtitle2"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMinutes(totalMinutes)}
            </Typography>
            {worklogs.length > 0 && !isAdding && (
              <Tooltip
                title={dayLocked ? `Locked through ${lockedThrough}` : 'Add worklog'}
              >
                <span>
                  <IconButton
                    size="small"
                    onClick={() => setIsAdding(true)}
                    disabled={taskId === null || dayLocked}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        </Stack>
        <Divider />

        {worklogs.length === 0 && !isAdding && (
          <Typography variant="body2" color="text.secondary">
            No worklogs on this day.
          </Typography>
        )}

        {worklogs.length > 0 && (
          <Stack spacing={1.25} divider={<Divider flexItem />}>
            {worklogs.map((entry) => {
              const isEditing = editId === entry.id;
              const eff = effectiveMinutes({
                minutes: entry.minutes,
                reported_minutes: entry.reportedMinutes,
              });
              const earned = computeEarned(eff);
              return (
                <Box key={entry.id}>
                  {isEditing ? (
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <DatePicker
                          value={editDate}
                          onChange={(v) => v && setEditDate(v)}
                          format={CZ_DATE_FORMAT}
                          slotProps={{
                            textField: { size: 'small', sx: { width: 150 } },
                          }}
                        />
                        <TextField
                          size="small"
                          label="Tracked"
                          value={editMinutes}
                          onChange={(e) => setEditMinutes(e.target.value)}
                          sx={{ width: 100 }}
                          autoFocus
                        />
                        <TextField
                          size="small"
                          label="Reported"
                          placeholder="—"
                          value={editReported}
                          onChange={(e) => setEditReported(e.target.value)}
                          sx={{ width: 100 }}
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        <Tooltip title="Save">
                          <IconButton size="small" onClick={commitEdit}>
                            <CheckIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Cancel">
                          <IconButton size="small" onClick={() => setEditId(null)}>
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      <TextField
                        size="small"
                        label="Description"
                        fullWidth
                        multiline
                        minRows={1}
                        maxRows={4}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </Stack>
                  ) : (
                    <Stack spacing={0.5}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{ minHeight: 28 }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {formatMinutes(eff)}
                        </Typography>
                        {entry.reportedMinutes != null &&
                          entry.reportedMinutes !== entry.minutes && (
                            <Typography variant="caption" color="text.secondary">
                              (tracked {formatMinutes(entry.minutes)})
                            </Typography>
                          )}
                        <Box sx={{ flexGrow: 1 }} />
                        {earned != null && rate && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatEarnings(earned, rate.currency)}
                          </Typography>
                        )}
                        <Tooltip
                          title={
                            dayLocked
                              ? `Locked through ${lockedThrough}`
                              : entry.jiraUploaded
                                ? 'Synced to Jira — click to unmark'
                                : 'Not in Jira — click to mark as synced'
                          }
                        >
                          <span>
                            <IconButton
                              size="small"
                              disabled={dayLocked}
                              onClick={() => {
                                void toggleJiraUploaded(entry);
                              }}
                            >
                              {entry.jiraUploaded ? (
                                <CloudDoneIcon
                                  fontSize="small"
                                  sx={{ color: 'success.main' }}
                                />
                              ) : (
                                <CloudOffIcon
                                  fontSize="small"
                                  sx={{ color: 'text.disabled' }}
                                />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip
                          title={dayLocked ? `Locked through ${lockedThrough}` : 'Edit'}
                        >
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => startEdit(entry)}
                              disabled={dayLocked}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip
                          title={dayLocked ? `Locked through ${lockedThrough}` : 'Delete'}
                        >
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => {
                                void deleteEntry(entry);
                              }}
                              disabled={dayLocked}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                      {entry.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ whiteSpace: 'pre-wrap' }}
                        >
                          {entry.description}
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}

        {isAdding && (
          <>
            {worklogs.length > 0 && <Divider />}
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                Add worklog
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Tracked"
                  placeholder="1.5, 1h 30m, 1:30, or 90m"
                  value={addMinutes}
                  onChange={(e) => setAddMinutes(e.target.value)}
                  error={addMinutes !== '' && !addMinutesValid}
                  autoFocus
                  sx={{ width: 130 }}
                />
                <TextField
                  size="small"
                  label="Reported"
                  placeholder="optional"
                  value={addReported}
                  onChange={(e) => setAddReported(e.target.value)}
                  error={addReportedTrimmed !== '' && !addReportedValid}
                  sx={{ width: 130 }}
                />
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Add">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!addValid}
                      onClick={() => {
                        void commitAdd();
                      }}
                    >
                      <CheckIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Cancel">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setIsAdding(false);
                      setAddMinutes('');
                      setAddReported('');
                      setAddDescription('');
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <TextField
                size="small"
                label="Description"
                fullWidth
                multiline
                minRows={1}
                maxRows={4}
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
              />
            </Stack>
          </>
        )}

        {actionError && (
          <Alert severity="error" onClose={() => setActionError(null)} sx={{ fontSize: 12, py: 0 }}>
            {actionError}
          </Alert>
        )}

        {dayLocked && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              color: 'warning.main',
              fontSize: 11,
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 14 }} />
            <span>Locked through {lockedThrough}</span>
          </Box>
        )}
      </Stack>
    </Popover>
  );
}
