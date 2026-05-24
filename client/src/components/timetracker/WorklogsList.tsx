import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  useWorklogs,
  type PeriodPreset,
  type SourceFilter,
} from '../../state/useWorklogs.js';
import { WorklogDrawer } from './WorklogDrawer.js';
import type { ProjectViewPayload, WorklogViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  /**
   * When set, narrows the list to one project and hides the project filter
   * (used by the detail-mode Worklogs tab).
   */
  projectId?: number;
}

function fmtMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDayHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date();
  const todayStr =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const yesterdayStr =
    yest.getFullYear() +
    '-' +
    String(yest.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(yest.getDate()).padStart(2, '0');
  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';
  const dt = new Date(y!, m! - 1, d!);
  return `${DAY_NAMES[dt.getDay()]}, ${d} ${MONTH_NAMES[m! - 1]} ${y}`;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'manual',
  'watchtower-auto': 'watchtower',
  'jira-sync': 'jira',
};

export function WorklogsList({ projectId }: Props) {
  const state = useWorklogs({ projectId: projectId ?? null });
  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<WorklogViewPayload | null>(null);

  // Load active projects once for the project filter dropdown (list mode only).
  useEffect(() => {
    if (projectId !== undefined) return;
    void window.watchtower
      .invoke('projects:list', { archived: false })
      .then((r) => setProjects(r.projects));
  }, [projectId]);

  // Group rows by work_date for the day headers + totals. Already sorted by
  // work_date DESC on the server, so consecutive runs share a date.
  const groups = useMemo(() => {
    const out: Array<{ date: string; rows: WorklogViewPayload[]; total: number }> = [];
    for (const w of state.worklogs) {
      const last = out[out.length - 1];
      if (last && last.date === w.workDate) {
        last.rows.push(w);
        last.total += w.minutes;
      } else {
        out.push({ date: w.workDate, rows: [w], total: w.minutes });
      }
    }
    return out;
  }, [state.worklogs]);

  const totalMinutes = state.worklogs.reduce((acc, w) => acc + w.minutes, 0);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        {projectId === undefined && (
          <TextField
            select
            size="small"
            value={state.filter.projectId ?? ''}
            onChange={(e) =>
              state.setProjectId(e.target.value === '' ? null : Number(e.target.value))
            }
            sx={{ minWidth: 180 }}
            label="Project"
          >
            <MenuItem value="">All projects</MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label="Period"
          value={state.filter.period}
          onChange={(e) => state.setPeriod(e.target.value as PeriodPreset)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="today">Today</MenuItem>
          <MenuItem value="week">This week</MenuItem>
          <MenuItem value="month">This month</MenuItem>
          <MenuItem value="all">All time</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Source"
          value={state.filter.source}
          onChange={(e) => state.setSource(e.target.value as SourceFilter)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="all">Any source</MenuItem>
          <MenuItem value="manual">Manual</MenuItem>
          <MenuItem value="watchtower-auto">Watchtower auto</MenuItem>
          <MenuItem value="jira-sync">Jira sync</MenuItem>
        </TextField>
        <TextField
          size="small"
          placeholder="Search comment / key / title…"
          value={state.filter.search}
          onChange={(e) => state.setSearch(e.target.value)}
          sx={{ minWidth: 220, flex: 1 }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {state.worklogs.length}{' '}
          {state.worklogs.length === 1 ? 'entry' : 'entries'}
          {totalMinutes > 0 ? ` · ${fmtMinutes(totalMinutes)}` : ''}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
        >
          Log work
        </Button>
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {state.error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {state.error}
          </Alert>
        )}

        {!state.loading && state.worklogs.length === 0 && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              No worklogs in the selected range.
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              Log your first worklog
            </Button>
          </Box>
        )}

        {groups.map((group) => (
          <Box key={group.date} sx={{ mb: 3 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                px: 0.5,
                py: 1,
                borderBottom: 1,
                borderColor: 'divider',
                mb: 1,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {fmtDayHeader(group.date)}
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ color: 'text.secondary', ml: 1 }}
                >
                  {group.date}
                </Typography>
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
              >
                {group.rows.length} {group.rows.length === 1 ? 'entry' : 'entries'} ·{' '}
                <strong style={{ color: 'rgba(255,255,255,0.92)' }}>
                  {fmtMinutes(group.total)}
                </strong>
              </Typography>
            </Box>
            <Stack spacing={0.5}>
              {group.rows.map((w) => (
                <WorklogRow
                  key={w.id}
                  worklog={w}
                  onEdit={() => {
                    setEditing(w);
                    setDrawerOpen(true);
                  }}
                  onDelete={() => void state.remove(w.id)}
                />
              ))}
            </Stack>
          </Box>
        ))}
      </Box>

      <WorklogDrawer
        open={drawerOpen}
        worklog={editing}
        initialProjectId={projectId ?? null}
        onClose={() => setDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editing) {
            await state.update(editing.id, input);
          } else {
            await state.create(input);
          }
        }}
        onDelete={
          editing
            ? async () => {
                await state.remove(editing.id);
              }
            : undefined
        }
      />
    </Box>
  );
}

function WorklogRow({
  worklog,
  onEdit,
  onDelete,
}: {
  worklog: WorklogViewPayload;
  onEdit(): void;
  onDelete(): void;
}) {
  const sourceLabel =
    worklog.source && SOURCE_LABELS[worklog.source] ? SOURCE_LABELS[worklog.source] : worklog.source;
  // Surface reported_minutes only when it's explicitly different from the
  // tracked value. NULL or equal-to-tracked stays implicit to keep the row
  // compact for the common case.
  const reportedDiffers =
    worklog.reportedMinutes != null && worklog.reportedMinutes !== worklog.minutes;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '12px 110px minmax(0, 1fr) 100px 90px auto',
        gap: 1.5,
        alignItems: 'center',
        px: 1.25,
        py: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: worklog.projectColor,
        }}
      />
      <Typography
        variant="caption"
        sx={{ fontFamily: 'Menlo, monospace', fontSize: 11, color: 'text.secondary' }}
        noWrap
      >
        {worklog.taskNumber}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {worklog.description ?? worklog.taskTitle}
        </Typography>
        {worklog.description && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {worklog.projectName} · {worklog.taskTitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}
          title={
            reportedDiffers
              ? `Tracked ${fmtMinutes(worklog.minutes)} · Reported ${fmtMinutes(worklog.reportedMinutes!)}`
              : undefined
          }
        >
          {fmtMinutes(worklog.minutes)}
          {reportedDiffers && (
            <Box
              component="span"
              sx={{
                color: 'text.secondary',
                fontWeight: 400,
                ml: 0.5,
              }}
            >
              / {fmtMinutes(worklog.reportedMinutes!)}
            </Box>
          )}
        </Typography>
        {reportedDiffers && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: 'text.disabled',
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              mt: -0.25,
            }}
          >
            tracked / reported
          </Typography>
        )}
      </Box>
      {sourceLabel ? (
        <Chip
          label={sourceLabel}
          size="small"
          variant="outlined"
          sx={{
            height: 18,
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: worklog.source === 'manual' ? 'text.secondary' : 'primary.main',
            borderColor: worklog.source === 'manual' ? 'divider' : 'primary.main',
          }}
        />
      ) : (
        <Box />
      )}
      <Stack direction="row" spacing={0.25}>
        <Tooltip title="Edit">
          <IconButton size="small" onClick={onEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" onClick={onDelete}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}
