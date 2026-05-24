import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Grid,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { useReports, type Granularity } from '../../state/useReports.js';
import { CZ_DATE_FORMAT } from '../../util/format.js';
import type { ProjectViewPayload } from '../../../../shared/ipcContract.js';
import ChartCard from './charts/ChartCard.js';
import TrendChart, {
  type RateChangeMarker,
  type TrendDatum,
} from './charts/TrendChart.js';
import ProjectDonut, { type ProjectSlice } from './charts/ProjectDonut.js';
import EarningsSummary, { type EarningsData } from './charts/EarningsSummary.js';
import Heatmap, { type HeatmapDatum } from './charts/Heatmap.js';
import ContractStatusCard from './charts/ContractStatusCard.js';
import type { RateChangeMarkerPayload } from '../../../../shared/ipcContract.js';

// ─── Date helpers ────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function endOfMonthStr(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function startOfYearStr(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function endOfYearStr(): string {
  return `${new Date().getFullYear()}-12-31`;
}

/**
 * Mirrors the server's strftime('%Y-W%W', date) bucket key — Monday-based
 * week, zero-padded to 2 digits. Used so rate-change markers (which arrive
 * with a raw `effective_from` date) can be matched against the trend's
 * pre-bucketed x-axis.
 */
function bucketKeyFor(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  // week — %W: week of year starting Monday, 00..53
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  const jan1 = new Date(y, 0, 1);
  const jan1Dow = jan1.getDay(); // 0=Sun..6=Sat
  const offsetToFirstMonday = (8 - (jan1Dow === 0 ? 7 : jan1Dow)) % 7;
  const firstMonday = new Date(y, 0, 1 + offsetToFirstMonday);
  const weekNum =
    dt < firstMonday
      ? 0
      : Math.floor((dt.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${y}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export function ReportsTab() {
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(todayStr());
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);

  // Load active projects once + snap the filter to the default project on
  // first load. Same useRef-guarded pattern as TaskGridView so subsequent
  // manual changes stick.
  const initialProjectSelectionDoneRef = useRef(false);
  useEffect(() => {
    void window.watchtower.invoke('projects:list', { archived: false }).then((r) => {
      setProjects(r.projects);
      if (!initialProjectSelectionDoneRef.current) {
        initialProjectSelectionDoneRef.current = true;
        const def = r.projects.find((p) => p.isDefault);
        if (def) setProjectFilter(def.id);
      }
    });
  }, []);

  const state = useReports(from, to, granularity, projectFilter);

  const presets = useMemo(
    () => [
      { label: '7d', set: () => setRange(daysAgoStr(6), todayStr()) },
      { label: '30d', set: () => setRange(daysAgoStr(29), todayStr()) },
      { label: 'Month', set: () => setRange(startOfMonthStr(), endOfMonthStr()) },
      { label: 'Year', set: () => setRange(startOfYearStr(), endOfYearStr()) },
      { label: 'All', set: () => setRange('2000-01-01', todayStr()) },
    ],
    [],
  );

  function setRange(f: string, t: string) {
    setFrom(f);
    setTo(t);
  }

  const rateChangeMarkers = useMemo<RateChangeMarker[]>(() => {
    return state.rateChanges.map((r: RateChangeMarkerPayload) => ({
      bucket: bucketKeyFor(r.effectiveFrom, granularity),
      label: `${r.rateAmount} ${r.currency}${r.rateType === 'hourly' ? '/hr' : '/MD'}`,
      project_color: r.projectColor,
    }));
  }, [state.rateChanges, granularity]);

  // Adapt the camelCase wire shape to the snake_case shape the ported charts
  // expect. Keeping the chart files unmodified makes future re-syncs from TT
  // a 1:1 copy job.
  const trendData: TrendDatum[] = useMemo(
    () =>
      state.trend.map((t) => ({
        bucket: t.bucket,
        minutes: t.minutes,
        earned_by_currency: t.earnedByCurrency,
      })),
    [state.trend],
  );

  const projectSlices: ProjectSlice[] = useMemo(
    () =>
      state.byProject.map((p) => ({
        project_id: p.projectId,
        project_name: p.projectName,
        project_color: p.projectColor,
        minutes: p.minutes,
      })),
    [state.byProject],
  );

  const earningsData: EarningsData = useMemo(
    () => ({
      billable_minutes: state.earnings?.billableMinutes ?? 0,
      unbillable_minutes: state.earnings?.unbillableMinutes ?? 0,
      total_earned: state.earnings?.totalEarned ?? {},
      avg_effective_hourly_rate: state.earnings?.avgEffectiveHourlyRate ?? {},
      // Chart requires non-null currency + earned_amount. The server's
      // by_project list already filters to billable projects with a rate
      // present, but the wire type allows null for safety — coerce here.
      by_project:
        state.earnings?.byProject.flatMap((p) =>
          p.currency != null && p.earned_amount != null
            ? [
                {
                  project_id: p.project_id,
                  project_name: p.project_name,
                  project_color: p.project_color,
                  currency: p.currency,
                  earned_amount: p.earned_amount,
                  minutes: p.minutes,
                },
              ]
            : [],
        ) ?? [],
    }),
    [state.earnings],
  );

  const heatmapData: HeatmapDatum[] = state.heatmap;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          m: 2,
          mb: 2,
          position: 'sticky',
          top: 0,
          zIndex: 2,
          backgroundColor: 'background.default',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <DatePicker
            label="From"
            value={dayjs(from)}
            onChange={(v: Dayjs | null) => v && setFrom(v.format('YYYY-MM-DD'))}
            format={CZ_DATE_FORMAT}
            slotProps={{ textField: { size: 'small', sx: { minWidth: 170 } } }}
          />
          <DatePicker
            label="To"
            value={dayjs(to)}
            onChange={(v: Dayjs | null) => v && setTo(v.format('YYYY-MM-DD'))}
            format={CZ_DATE_FORMAT}
            slotProps={{ textField: { size: 'small', sx: { minWidth: 170 } } }}
          />
          <ButtonGroup variant="outlined" size="small">
            {presets.map((p) => (
              <Button key={p.label} onClick={p.set}>
                {p.label}
              </Button>
            ))}
          </ButtonGroup>
          <TextField
            select
            size="small"
            label="Project"
            value={projectFilter ?? ''}
            onChange={(e) =>
              setProjectFilter(e.target.value === '' ? null : Number(e.target.value))
            }
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All projects</MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ flexGrow: 1 }} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={granularity}
            onChange={(_, v: Granularity | null) => v && setGranularity(v)}
          >
            <ToggleButton value="day" sx={{ textTransform: 'none' }}>Day</ToggleButton>
            <ToggleButton value="week" sx={{ textTransform: 'none' }}>Week</ToggleButton>
            <ToggleButton value="month" sx={{ textTransform: 'none' }}>Month</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Paper>

      {state.errors.length > 0 && (
        <Box sx={{ px: 2, pb: 1 }}>
          <Alert severity="error">
            {state.errors.length === 1
              ? state.errors[0]
              : `${state.errors.length} reports failed to load — see DevTools for details.`}
          </Alert>
        </Box>
      )}

      <Box sx={{ px: 2, pb: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <ChartCard
              title="Time trend"
              subtitle={`Hours logged per ${granularity}`}
              height={300}
            >
              {state.loading && state.trend.length === 0 ? (
                <Loading />
              ) : (
                <TrendChart
                  data={trendData}
                  granularity={granularity}
                  rateChanges={rateChangeMarkers}
                />
              )}
            </ChartCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <ChartCard title="Time by project" height={320}>
              {state.loading && state.byProject.length === 0 ? (
                <Loading />
              ) : (
                <ProjectDonut data={projectSlices} />
              )}
            </ChartCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <ChartCard title="Earnings & billable summary" height={320}>
              {state.loading && !state.earnings ? <Loading /> : <EarningsSummary data={earningsData} />}
            </ChartCard>
          </Grid>

          {state.contracts.length > 0 && (
            <Grid item xs={12}>
              <ChartCard
                title="Active contracts"
                subtitle="Man-day budgets vs. workdays remaining until contract end"
                height="auto"
              >
                <Grid container spacing={2}>
                  {state.contracts.map((c) => (
                    <Grid item xs={12} md={6} lg={4} key={c.projectId}>
                      <ContractStatusCard
                        contract={c.contract}
                        projectName={c.projectName}
                        projectColor={c.projectColor}
                      />
                    </Grid>
                  ))}
                </Grid>
              </ChartCard>
            </Grid>
          )}

          <Grid item xs={12}>
            <ChartCard
              title="Activity heatmap"
              subtitle="Daily logged time across the selected range"
              height="auto"
            >
              {state.loading && state.heatmap.length === 0 ? (
                <Loading />
              ) : (
                <Heatmap data={heatmapData} from={from} to={to} />
              )}
            </ChartCard>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

function Loading() {
  return <Skeleton variant="rounded" sx={{ height: '100%', width: '100%' }} animation="wave" />;
}

// Touch unused-warning workaround for the Typography import — kept on
// import list so the loading state stays compositional with the
// surrounding Paper.
void Typography;
