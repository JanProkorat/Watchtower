import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Paper,
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
import LaunchIcon from '@mui/icons-material/Launch';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import type {
  BoardCardPayload,
  WorklogInputPayload,
  WorklogViewPayload,
} from '@watchtower/shared/ipcContract.js';
import {
  CZ_DATE_FORMAT,
  buildTaskUrl,
  formatDateCz,
  formatMinutes,
  parseMinutes,
} from '../../util/format.js';
import { invoke } from '../../state/ipc';

interface Props {
  open: boolean;
  card: BoardCardPayload | null;
  /**
   * Jira host root (e.g. `https://jira.skoda.vwgroup.com`). Used to absolute-ise
   * relative `src=` / `href=` references inside Jira description HTML. Open-in-
   * tracker link comes from `taskUrlTemplate` instead.
   */
  jiraBaseUrl: string | null;
  /**
   * Per-project URL template for the open-in-tracker link (`{n}` → task number).
   * When null, the link icon is hidden.
   */
  taskUrlTemplate: string | null;
  onClose(): void;
  onOpenJira(url: string): void;
  onRemove(taskId: number): void;
}

export function BoardTaskDetailDrawer({
  open,
  card,
  jiraBaseUrl,
  taskUrlTemplate,
  onClose,
  onOpenJira,
  onRemove,
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
    if (!card) return;
    setLoading(true);
    setError(null);
    try {
      const res = await invoke('worklogs:list', { taskId: card.taskId });
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
    if (!open || !card) return;
    setEditingWorklogId(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.taskId]);

  // Jira returns the description as HTML — sanitize with DOMPurify before
  // dropping into the DOM. The default config strips <script>, on*=, javascript:
  // URLs etc. while keeping the formatting tags Jira uses (b, i, ul, code, …).
  // Jira embeds relative attachment paths (/secure/attachment/...) in img/src
  // and a/href; rewrite them to absolute URLs against the Jira host so they
  // resolve when the renderer fetches them. Memo runs unconditionally (above
  // the early-return) so the hook order stays stable across `card` changes.
  const rawDescription = card?.description ?? null;
  const descriptionHtml = useMemo(() => {
    if (!rawDescription) return '';
    const absolutise = (raw: string): string => {
      if (!jiraBaseUrl) return raw;
      if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) return raw;
      if (raw.startsWith('/')) return `${jiraBaseUrl}${raw}`;
      return raw;
    };
    const rewritten = rawDescription
      .replace(/(\ssrc=")([^"]+)(")/g, (_, p1, url, p3) => `${p1}${absolutise(url)}${p3}`)
      .replace(/(\shref=")([^"]+)(")/g, (_, p1, url, p3) => `${p1}${absolutise(url)}${p3}`);
    return DOMPurify.sanitize(rewritten, { USE_PROFILES: { html: true } });
  }, [rawDescription, jiraBaseUrl]);

  if (!card) {
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
        <Box sx={{ p: 3 }} />
      </Drawer>
    );
  }

  const totalMinutes =
    worklogs.reduce((sum, w) => sum + (w.reportedMinutes ?? w.minutes), 0) ||
    card.loggedMinutes;
  const estimateMinutes =
    card.estimateSeconds != null ? Math.round(card.estimateSeconds / 60) : null;
  const externalUrl = buildTaskUrl(taskUrlTemplate, card.jiraKey);

  // Intercept link clicks inside the rendered description so they open in
  // the system browser via the existing openExternalUrl IPC instead of
  // navigating the Electron renderer (which would unload the whole app).
  const handleDescriptionClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    if (/^https:\/\//i.test(href)) onOpenJira(href);
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
        taskId: card.taskId,
        workDate: values.work_date,
        minutes: values.minutes,
        reportedMinutes: values.reported_minutes,
        description: values.description,
      };
      const res = await invoke('worklogs:create', input);
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
      const res = await invoke('worklogs:update', { id, input: values });
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
    if (
      !window.confirm(`Delete worklog from ${formatDateCz(w.workDate)} (${formatMinutes(w.minutes)})?`)
    ) {
      return;
    }
    setError(null);
    try {
      const res = await invoke('worklogs:delete', { id: w.id });
      if ('lockedThrough' in res) {
        setError(`Worklog window is locked through ${res.lockedThrough}.`);
        return;
      }
      await reload();
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
                background: `linear-gradient(90deg, ${card.projectColor}, ${alpha(card.projectColor, 0.25)})`,
              }}
            />
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, mt: 0.5 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: card.projectColor,
                }}
              />
              <Typography variant="overline" color="text.secondary">
                {card.projectName} · {card.epicName || 'Epic'}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary">
                {card.jiraKey}
              </Typography>
              {externalUrl && (
                <Tooltip title={externalUrl}>
                  <IconButton
                    size="small"
                    onClick={() => onOpenJira(externalUrl)}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Typography variant="h6">{card.title}</Typography>
            <Stack
              direction="row"
              spacing={2}
              sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
            >
              <Chip size="small" label={card.jiraStatus} variant="outlined" />
              <Chip
                color="primary"
                variant={estimateMinutes != null ? 'filled' : 'outlined'}
                label={
                  estimateMinutes != null
                    ? `${formatMinutes(totalMinutes)} / ${formatMinutes(estimateMinutes)}`
                    : `${formatMinutes(totalMinutes)} logged`
                }
                className="tt-num"
              />
            </Stack>
            {descriptionHtml && (
              <Box
                className="board-task-description"
                onClick={handleDescriptionClick}
                sx={{
                  mt: 2,
                  p: 1.5,
                  bgcolor: 'background.default',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  fontSize: 13,
                  color: 'text.secondary',
                  maxHeight: 320,
                  overflowY: 'auto',
                  // Tame Jira's HTML so it inherits the drawer's typography
                  // instead of carrying over server-side defaults.
                  '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
                  '& a': { color: 'primary.main' },
                  '& ul, & ol': { pl: 2.5, my: 1 },
                  '& li': { mb: 0.25 },
                  '& code': {
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    bgcolor: 'action.hover',
                    px: 0.5,
                    borderRadius: 0.5,
                  },
                  '& pre': {
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    bgcolor: 'action.hover',
                    p: 1,
                    borderRadius: 0.5,
                    overflowX: 'auto',
                  },
                  '& img': { maxWidth: '100%' },
                  '& blockquote': {
                    borderLeft: 3,
                    borderColor: 'divider',
                    pl: 1.5,
                    ml: 0,
                    color: 'text.disabled',
                  },
                  '& table': { borderCollapse: 'collapse' },
                  '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5 },
                }}
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            )}
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

          <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'flex-end' }}>
            {externalUrl && (
              <Button
                size="small"
                startIcon={<LaunchIcon fontSize="small" />}
                onClick={() => onOpenJira(externalUrl)}
              >
                Open in Jira
              </Button>
            )}
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon fontSize="small" />}
              onClick={() => onRemove(card.taskId)}
            >
              Remove from board
            </Button>
          </Stack>
        </Box>
      </Box>
    </Drawer>
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
