import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import type {
  JiraSyncEntryPayload,
  JiraSyncEntryStatus,
  JiraSyncRequestPayload,
  JiraSyncResultPayload,
  ProjectViewPayload,
} from '@watchtower/shared/ipcContract.js';
import { CZ_DATE_FORMAT, formatDateShortCz } from '../../util/format.js';
import { invoke } from '../../state/ipc';

const ALL_PROJECTS = 'all' as const;
type ProjectChoice = number | typeof ALL_PROJECTS;

interface Props {
  open: boolean;
  initialFrom: Dayjs;
  initialTo: Dayjs;
  initialProjectId: number | null;
  projects: ProjectViewPayload[];
  onClose: () => void;
  /** Called after a successful sync so the grid can refetch. */
  onSynced?: () => void;
}

type Phase = 'idle' | 'previewing' | 'syncing' | 'done';

function statusChip(status: JiraSyncEntryStatus) {
  switch (status) {
    case 'posted':
      return (
        <Chip
          size="small"
          color="success"
          icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
          label="Posted"
        />
      );
    case 'failed':
      return (
        <Chip
          size="small"
          color="error"
          icon={<ErrorIcon sx={{ fontSize: 16 }} />}
          label="Failed"
        />
      );
    case 'skipped':
      return (
        <Chip
          size="small"
          icon={<RemoveCircleOutlineIcon sx={{ fontSize: 16 }} />}
          label="Skipped"
        />
      );
    default:
      return (
        <Chip
          size="small"
          variant="outlined"
          icon={<HourglassEmptyIcon sx={{ fontSize: 16 }} />}
          label="Pending"
        />
      );
  }
}

export function JiraSyncDialog({
  open,
  initialFrom,
  initialTo,
  initialProjectId,
  projects,
  onClose,
  onSynced,
}: Props) {
  const [from, setFrom] = useState<Dayjs>(initialFrom);
  const [to, setTo] = useState<Dayjs>(initialTo);
  const [projectChoice, setProjectChoice] = useState<ProjectChoice>(
    initialProjectId ?? ALL_PROJECTS,
  );
  const [onlyUnposted, setOnlyUnposted] = useState(true);

  const [phase, setPhase] = useState<Phase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<JiraSyncResultPayload | null>(null);
  const [result, setResult] = useState<JiraSyncResultPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(initialFrom);
    setTo(initialTo);
    setProjectChoice(initialProjectId ?? ALL_PROJECTS);
    setOnlyUnposted(true);
    setPhase('idle');
    setStatusMessage(null);
    setError(null);
    setPreview(null);
    setResult(null);
  }, [open, initialFrom, initialTo, initialProjectId]);

  const display = result ?? preview;

  const requestBody = useMemo<JiraSyncRequestPayload>(
    () => ({
      from: from.format('YYYY-MM-DD'),
      to: to.format('YYYY-MM-DD'),
      projectId: projectChoice === ALL_PROJECTS ? undefined : projectChoice,
      onlyUnposted,
    }),
    [from, to, projectChoice, onlyUnposted],
  );

  const validRange = from.isValid() && to.isValid() && !from.isAfter(to);
  const busy = phase === 'previewing' || phase === 'syncing';

  async function runPreview() {
    if (!validRange) return;
    setPhase('previewing');
    setError(null);
    setResult(null);
    setStatusMessage('Building preview…');
    try {
      const data = await invoke('jira:syncPreview', requestBody);
      if (data.error) {
        setError(data.error);
        setPreview(null);
      } else {
        setPreview(data);
      }
      setStatusMessage(null);
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
      setStatusMessage(null);
    }
  }

  async function runSync() {
    if (!validRange) return;
    setPhase('syncing');
    setError(null);
    setResult(null);
    setStatusMessage(
      'Syncing to Jira… if a browser window opens, complete the SSO login. Do not close this dialog.',
    );
    try {
      const data = await invoke('jira:sync', requestBody);
      if (data.error) {
        setError(data.error);
        setResult(null);
        setPhase('idle');
      } else {
        setResult(data);
        setPhase('done');
        onSynced?.();
      }
      setStatusMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
      setStatusMessage(null);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Sync worklogs to Jira
        <IconButton
          aria-label="close"
          onClick={onClose}
          disabled={busy}
          sx={{ position: 'absolute', right: 8, top: 8 }}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <DatePicker
              label="From"
              value={from}
              onChange={(v) => v && setFrom(v.startOf('day'))}
              format={CZ_DATE_FORMAT}
              disabled={busy}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={to}
              onChange={(v) => v && setTo(v.endOf('day'))}
              format={CZ_DATE_FORMAT}
              disabled={busy}
              slotProps={{ textField: { size: 'small' } }}
            />
            <FormControl size="small" sx={{ minWidth: 240 }}>
              <InputLabel id="jira-sync-project-label">Project</InputLabel>
              <Select
                labelId="jira-sync-project-label"
                label="Project"
                value={projectChoice}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value;
                  setProjectChoice(v === ALL_PROJECTS ? ALL_PROJECTS : Number(v));
                }}
              >
                <MenuItem value={ALL_PROJECTS}>All projects</MenuItem>
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            bgcolor: p.color,
                          }}
                        />
                        <span>{p.name}</span>
                      </Stack>
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={onlyUnposted}
                  disabled={busy}
                  onChange={(_, checked) => setOnlyUnposted(checked)}
                />
              }
              label="Skip already-posted"
            />
          </Stack>

          {!validRange && (
            <Alert severity="warning">Pick a valid date range (from ≤ to).</Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {statusMessage && (
            <Alert
              severity="info"
              icon={<CircularProgress size={18} />}
              sx={{ alignItems: 'center' }}
            >
              {statusMessage}
            </Alert>
          )}

          {display && (
            <>
              <Divider />
              <Stack
                direction="row"
                spacing={2}
                flexWrap="wrap"
                useFlexGap
                alignItems="center"
              >
                <Typography variant="body2">
                  <strong>{display.totalCandidates}</strong> worklog
                  {display.totalCandidates === 1 ? '' : 's'} in range
                </Typography>
                {display.skippedNoJiraKey > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    · {display.skippedNoJiraKey} skipped (not a Jira key)
                  </Typography>
                )}
                {display.skippedTaskNotOpen > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    · {display.skippedTaskNotOpen} skipped (task not open)
                  </Typography>
                )}
                {display.skippedAlreadyPosted > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    · {display.skippedAlreadyPosted} already in Jira
                  </Typography>
                )}
                {display.dryRun ? (
                  <Typography variant="body2">
                    · <strong>{display.attempted}</strong> would be posted
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" color="success.main">
                      · <strong>{display.posted}</strong> posted
                    </Typography>
                    {display.failed > 0 && (
                      <Typography variant="body2" color="error.main">
                        · <strong>{display.failed}</strong> failed
                      </Typography>
                    )}
                    {display.tasksMarkedDone > 0 && (
                      <Typography variant="body2" color="success.main">
                        · <strong>{display.tasksMarkedDone}</strong> task
                        {display.tasksMarkedDone === 1 ? '' : 's'} marked done
                      </Typography>
                    )}
                    {display.neededBrowserRefresh && (
                      <Chip
                        size="small"
                        color="info"
                        label="Re-authenticated via browser"
                      />
                    )}
                  </>
                )}
              </Stack>

              {display.entries.length > 0 && (
                <TableContainer sx={{ maxHeight: 420 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Status</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Task</TableCell>
                        <TableCell>Time</TableCell>
                        <TableCell>Comment</TableCell>
                        <TableCell>Detail</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {display.entries.map((e: JiraSyncEntryPayload) => (
                        <TableRow key={e.worklogId} hover>
                          <TableCell>{statusChip(e.status)}</TableCell>
                          <TableCell>{formatDateShortCz(e.workDate)}</TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {e.taskNumber}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: 'block',
                                maxWidth: 360,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {e.taskTitle}
                            </Typography>
                          </TableCell>
                          <TableCell>{e.timeSpent}</TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{
                                maxWidth: 320,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={e.comment}
                            >
                              {e.comment}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {e.jiraWorklogUrl && (
                              <Link
                                href={e.jiraWorklogUrl}
                                target="_blank"
                                rel="noreferrer"
                                variant="body2"
                              >
                                Open
                              </Link>
                            )}
                            {e.reason && (
                              <Typography variant="caption" color="text.secondary">
                                {e.reason}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {display.entries.length === 0 && (
                <Alert severity="info">
                  No worklogs to send for this range and project.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {phase === 'done' ? 'Close' : 'Cancel'}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          onClick={runPreview}
          disabled={busy || !validRange}
          startIcon={phase === 'previewing' ? <CircularProgress size={16} /> : null}
        >
          Preview
        </Button>
        <Button
          variant="contained"
          onClick={runSync}
          disabled={
            busy ||
            !validRange ||
            (preview !== null &&
              preview.entries.filter((e) => e.status !== 'skipped').length === 0)
          }
          startIcon={phase === 'syncing' ? <CircularProgress size={16} /> : null}
        >
          {phase === 'syncing' ? 'Syncing…' : 'Sync to Jira'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Default range = current calendar month. */
export function defaultJiraSyncRange(): { from: Dayjs; to: Dayjs } {
  const now = dayjs();
  return { from: now.startOf('month'), to: now.endOf('month') };
}
