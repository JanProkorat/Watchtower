import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditIcon from '@mui/icons-material/Edit';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import type {
  TaskInputPayload,
  TaskViewPayload,
  WorklogInputPayload,
  WorklogViewPayload,
} from '../../../../shared/ipcContract.js';
import {
  CZ_DATE_FORMAT,
  buildTaskUrl,
  formatDateCz,
  formatHoursTrim,
  formatMinutes,
  parseMinutes,
} from '../../util/format.js';

interface Props {
  open: boolean;
  task: TaskViewPayload | null;
  projectName: string;
  projectColor: string;
  epicName: string;
  /** Per-task URL template (e.g. https://.../browse/{n}) — optional. */
  taskUrlTemplate?: string | null;
  onClose(): void;
  onUpdate(input: Partial<TaskInputPayload>): Promise<void>;
  onDelete?(): Promise<void> | void;
  onOpenExternal?(url: string): void;
}

const STATUS_OPTIONS: { value: 'open' | 'in_progress' | 'to_accept' | 'done'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'to_accept', label: 'To accept' },
  { value: 'done', label: 'Done' },
];

export function TaskDetailDrawer({
  open,
  task,
  projectName,
  projectColor,
  epicName,
  taskUrlTemplate,
  onClose,
  onUpdate,
  onDelete,
  onOpenExternal,
}: Props) {
  const [worklogs, setWorklogs] = useState<WorklogViewPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingWorklogId, setEditingWorklogId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState<Dayjs>(dayjs());
  const [editMinutes, setEditMinutes] = useState('');
  const [editReported, setEditReported] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const reload = async () => {
    if (!task) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('worklogs:list', { taskId: task.id });
      const sorted = [...res.worklogs].sort((a, b) =>
        a.workDate < b.workDate ? 1 : a.workDate > b.workDate ? -1 : b.id - a.id,
      );
      setWorklogs(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !task) return;
    setEditingWorklogId(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  if (!task) {
    return (
      <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 880 } }}>
        <Box sx={{ p: 3 }} />
      </Drawer>
    );
  }

  const totalMinutes =
    worklogs.reduce((sum, w) => sum + (w.reportedMinutes ?? w.minutes), 0) || task.totalMinutes;
  const externalUrl = taskUrlTemplate ? buildTaskUrl(taskUrlTemplate, task.number) : null;
  const handleOpenExternal = (e: React.MouseEvent) => {
    if (!externalUrl) return;
    e.preventDefault();
    if (onOpenExternal) onOpenExternal(externalUrl);
    else void window.watchtower.invoke('openExternalUrl', { url: externalUrl });
  };

  const handleAddWorklog = async (values: {
    work_date: string;
    minutes: number;
    reported_minutes: number | null;
    description: string | null;
  }) => {
    setError(null);
    try {
      const input: WorklogInputPayload = {
        taskId: task.id,
        workDate: values.work_date,
        minutes: values.minutes,
        reportedMinutes: values.reported_minutes,
        description: values.description,
      };
      const res = await window.watchtower.invoke('worklogs:create', input);
      if ('lockedThrough' in res) {
        setError(`Worklog window is locked through ${res.lockedThrough}.`);
        return;
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateWorklog = async (
    id: number,
    values: Partial<Pick<WorklogInputPayload, 'workDate' | 'minutes' | 'reportedMinutes' | 'description' | 'jiraUploaded'>>,
  ) => {
    setError(null);
    try {
      const res = await window.watchtower.invoke('worklogs:update', { id, input: values });
      if ('lockedThrough' in res) {
        setError(`Worklog window is locked through ${res.lockedThrough}.`);
        return;
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteWorklog = async (w: WorklogViewPayload) => {
    if (!window.confirm(`Smazat worklog z ${formatDateCz(w.workDate)} (${formatMinutes(w.minutes)})?`)) {
      return;
    }
    setError(null);
    try {
      const res = await window.watchtower.invoke('worklogs:delete', { id: w.id });
      if ('lockedThrough' in res) {
        setError(`Worklog window is locked through ${res.lockedThrough}.`);
        return;
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const changeStatus = async (next: 'open' | 'in_progress' | 'to_accept' | 'done') => {
    if (next === task.status) return;
    try {
      await onUpdate({ status: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveEstimate = async (value: number | null) => {
    try {
      await onUpdate({ estimatedMinutes: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteTask = async () => {
    if (!onDelete) return;
    if (
      !window.confirm(`Smazat úkol ${task.number} "${task.title}"? Worklogy budou také odstraněny.`)
    ) {
      return;
    }
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startEditWorklog = (w: WorklogViewPayload) => {
    setEditingWorklogId(w.id);
    setEditDate(dayjs(w.workDate));
    setEditMinutes(formatMinutes(w.minutes));
    setEditReported(w.reportedMinutes == null ? '' : formatMinutes(w.reportedMinutes));
    setEditDescription(w.description ?? '');
  };

  const commitEditWorklog = async () => {
    if (editingWorklogId == null) return;
    const minutes = parseMinutes(editMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const reportedTrimmed = editReported.trim();
    let reportedMinutes: number | null = null;
    if (reportedTrimmed !== '') {
      const parsed = parseMinutes(editReported);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      reportedMinutes = parsed;
    }
    await handleUpdateWorklog(editingWorklogId, {
      workDate: editDate.format('YYYY-MM-DD'),
      minutes,
      reportedMinutes,
      description: editDescription.trim() === '' ? null : editDescription.trim(),
    });
    setEditingWorklogId(null);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '95%', md: 880, lg: 1040, xl: 1200 },
          maxWidth: '100vw',
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            background: 'inherit',
            zIndex: 1,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
            Task detail
          </Typography>
          <IconButton onClick={onClose} aria-label="close" size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Box sx={{ p: 3, overflowY: 'auto', flexGrow: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Header card */}
          <Paper
            variant="outlined"
            sx={{ p: 3, mb: 3, position: 'relative', overflow: 'hidden' }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: `linear-gradient(90deg, ${projectColor}, ${alpha(projectColor, 0.25)})`,
              }}
            />
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, mt: 0.5 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: projectColor,
                }}
              />
              <Typography variant="overline" color="text.secondary">
                {projectName} · {epicName}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary">
                {task.number}
              </Typography>
              {externalUrl && (
                <Tooltip title={externalUrl}>
                  <IconButton
                    size="small"
                    component="a"
                    href={externalUrl}
                    onClick={handleOpenExternal}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Typography variant="h6">{task.title}</Typography>
            <Stack
              direction="row"
              spacing={2}
              sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
            >
              <Select
                size="small"
                value={task.status}
                onChange={(e) => void changeStatus(e.target.value as 'open' | 'in_progress' | 'to_accept' | 'done')}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
              <EstimateChip
                totalMinutes={totalMinutes}
                estimatedMinutes={task.estimatedMinutes}
                onSave={(v) => void saveEstimate(v)}
              />
            </Stack>
          </Paper>

          {/* Add worklog form */}
          <Box sx={{ mb: 3 }}>
            <AddWorklogForm onSubmit={(v) => void handleAddWorklog(v)} />
          </Box>

          {/* Worklog table */}
          <Paper variant="outlined">
            {loading ? (
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Loading worklogs…
                </Typography>
              </Stack>
            ) : worklogs.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No worklogs yet.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 150 }}>Date</TableCell>
                    <TableCell sx={{ width: 110 }}>Tracked</TableCell>
                    <TableCell sx={{ width: 110 }}>Reported</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell sx={{ width: 144, whiteSpace: 'nowrap' }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {worklogs.map((w) => {
                    const isEditing = editingWorklogId === w.id;
                    return (
                      <TableRow key={w.id} hover>
                        <TableCell>
                          {isEditing ? (
                            <DatePicker
                              value={editDate}
                              onChange={(v) => v && setEditDate(v)}
                              format={CZ_DATE_FORMAT}
                              slotProps={{ textField: { size: 'small', sx: { width: 140 } } }}
                            />
                          ) : (
                            formatDateCz(w.workDate)
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              value={editMinutes}
                              onChange={(e) => setEditMinutes(e.target.value)}
                              sx={{ width: 90 }}
                            />
                          ) : (
                            formatMinutes(w.minutes)
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              placeholder="—"
                              value={editReported}
                              onChange={(e) => setEditReported(e.target.value)}
                              sx={{ width: 90 }}
                            />
                          ) : w.reportedMinutes != null ? (
                            formatMinutes(w.reportedMinutes)
                          ) : (
                            <Typography variant="body2" color="text.disabled">
                              —
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              fullWidth
                              multiline
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                            />
                          ) : (
                            <span style={{ whiteSpace: 'pre-wrap' }}>
                              {w.description ?? ''}
                            </span>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <>
                              <Tooltip title="Save">
                                <IconButton size="small" onClick={() => void commitEditWorklog()}>
                                  <CheckIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Cancel">
                                <IconButton size="small" onClick={() => setEditingWorklogId(null)}>
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          ) : (
                            <>
                              <Tooltip
                                title={
                                  w.jiraUploaded
                                    ? 'Synced to Jira — click to unmark'
                                    : 'Not in Jira — click to mark as synced'
                                }
                              >
                                <IconButton
                                  size="small"
                                  onClick={() =>
                                    void handleUpdateWorklog(w.id, { jiraUploaded: !w.jiraUploaded })
                                  }
                                >
                                  {w.jiraUploaded ? (
                                    <CloudDoneIcon fontSize="small" sx={{ color: 'success.main' }} />
                                  ) : (
                                    <CloudOffIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                                  )}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Edit">
                                <IconButton size="small" onClick={() => startEditWorklog(w)}>
                                  <EditOutlinedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete">
                                <IconButton size="small" onClick={() => void handleDeleteWorklog(w)}>
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Paper>

          {onDelete && (
            <Stack direction="row" sx={{ mt: 2, justifyContent: 'flex-end' }}>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                onClick={() => void handleDeleteTask()}
              >
                Smazat úkol
              </Button>
            </Stack>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}

interface EstimateChipProps {
  totalMinutes: number;
  estimatedMinutes: number | null;
  onSave: (value: number | null) => void;
}

function EstimateChip({ totalMinutes, estimatedMinutes, onSave }: EstimateChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!editing) {
      setDraft(estimatedMinutes != null ? formatHoursTrim(estimatedMinutes) : '');
    }
  }, [estimatedMinutes, editing]);

  const parsed = draft.trim() === '' ? null : parseMinutes(draft);
  const valid =
    draft.trim() === '' || (Number.isFinite(parsed) && (parsed as number) > 0);

  const commit = () => {
    if (!valid) return;
    onSave(draft.trim() === '' ? null : (parsed as number));
    setEditing(false);
  };

  const overrun =
    estimatedMinutes != null && estimatedMinutes > 0 && totalMinutes > estimatedMinutes;
  const nearLimit =
    estimatedMinutes != null &&
    estimatedMinutes > 0 &&
    !overrun &&
    totalMinutes / estimatedMinutes >= 0.8;
  const chipColor: 'primary' | 'warning' | 'error' = overrun
    ? 'error'
    : nearLimit
      ? 'warning'
      : 'primary';

  if (editing) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          autoFocus
          label="Estimate"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          error={!valid}
          placeholder="e.g. 2.5, 2h 30m"
          sx={{ width: 180 }}
        />
        <IconButton size="small" color="primary" onClick={commit} disabled={!valid} aria-label="save estimate">
          <CheckIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => setEditing(false)} aria-label="cancel">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    );
  }

  return (
    <Tooltip title="Click to edit estimate">
      <Chip
        color={chipColor}
        variant={estimatedMinutes != null ? 'filled' : 'outlined'}
        onClick={() => setEditing(true)}
        deleteIcon={<EditIcon fontSize="small" />}
        onDelete={() => setEditing(true)}
        label={
          estimatedMinutes != null
            ? `${formatMinutes(totalMinutes)} / ${formatMinutes(estimatedMinutes)}`
            : `${formatMinutes(totalMinutes)} logged · set estimate`
        }
        className="tt-num"
      />
    </Tooltip>
  );
}

interface AddWorklogFormProps {
  onSubmit: (values: {
    work_date: string;
    minutes: number;
    reported_minutes: number | null;
    description: string | null;
  }) => void;
}

function AddWorklogForm({ onSubmit }: AddWorklogFormProps) {
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [minutesInput, setMinutesInput] = useState('');
  const [reportedInput, setReportedInput] = useState('');
  const [description, setDescription] = useState('');

  const minutes = parseMinutes(minutesInput);
  const minutesValid = Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60;
  const reportedTrimmed = reportedInput.trim();
  const reportedMinutes = reportedTrimmed === '' ? null : parseMinutes(reportedInput);
  const reportedValid =
    reportedMinutes === null ||
    (Number.isFinite(reportedMinutes) && reportedMinutes > 0 && reportedMinutes <= 24 * 60);
  const dateValid = !!date && date.isValid();
  const valid = minutesValid && reportedValid && dateValid;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
        Add worklog
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <DatePicker
          label="Date"
          value={date}
          onChange={(v) => setDate(v)}
          format={CZ_DATE_FORMAT}
          slotProps={{
            textField: { sx: { width: { xs: '100%', sm: 180 } } },
          }}
        />
        <TextField
          label="Tracked"
          placeholder="1.5, 1h 30m, 1:30, or 90m"
          value={minutesInput}
          onChange={(e) => setMinutesInput(e.target.value)}
          error={minutesInput !== '' && !minutesValid}
          helperText={
            minutesInput === ''
              ? undefined
              : minutesValid
                ? `= ${formatMinutes(minutes)}`
                : 'Invalid format'
          }
          sx={{ width: { xs: '100%', sm: 180 } }}
        />
        <TextField
          label="Reported"
          placeholder="optional"
          value={reportedInput}
          onChange={(e) => setReportedInput(e.target.value)}
          error={reportedTrimmed !== '' && !reportedValid}
          helperText={
            reportedTrimmed === ''
              ? undefined
              : reportedValid && reportedMinutes !== null
                ? `= ${formatMinutes(reportedMinutes)}`
                : 'Invalid format'
          }
          sx={{ width: { xs: '100%', sm: 180 } }}
        />
        <TextField
          label="Description"
          multiline
          minRows={1}
          maxRows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
        />
        <Box sx={{ pt: { xs: 0, sm: 1 } }}>
          <Button
            variant="contained"
            disabled={!valid}
            onClick={() => {
              if (!valid || !date) return;
              onSubmit({
                work_date: date.format('YYYY-MM-DD'),
                minutes,
                reported_minutes: reportedMinutes,
                description: description.trim() === '' ? null : description.trim(),
              });
              setMinutesInput('');
              setReportedInput('');
              setDescription('');
            }}
          >
            Add
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
