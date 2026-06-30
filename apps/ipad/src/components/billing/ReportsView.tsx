// apps/ipad/src/components/billing/ReportsView.tsx
import { useMemo } from 'react';
import { useBilling } from '../../state/useBilling.js';
import { useReportsFilters } from '../../state/useReportsFilters.js';
import { trendSeries, rateChangeMarkers } from '@watchtower/shared/billing/reports/trend.js';
import { earningsSummary } from '@watchtower/shared/billing/reports/earnings-summary.js';
import { projectBreakdown } from '@watchtower/shared/billing/reports/breakdown.js';
import { activityHeatmapRange } from '@watchtower/shared/billing/heatmap.js';
import { ReportsFilterBar } from './reports/ReportsFilterBar.js';
import { TrendChart } from './reports/TrendChart.js';
import { EarningsSummaryPanel } from './reports/EarningsSummaryPanel.js';
import { ProjectDonut } from './reports/ProjectDonut.js';
import { ActivityHeatmapPanel } from './reports/ActivityHeatmapPanel.js';
import { C } from './reports/tokens.js';
import { text } from '../../theme/glass.js';

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: text.muted, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function ReportsView({ onOpenProject }: { onOpenProject(id: number): void }): JSX.Element {
  const { data, state } = useBilling();
  const today = new Date().toISOString().slice(0, 10);

  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const contracts = data?.contracts ?? [];

  const earliest = useMemo(
    () => (worklogs.length ? worklogs.reduce((min, r) => (r.workDate < min ? r.workDate : min), worklogs[0]!.workDate) : undefined),
    [worklogs],
  );

  const f = useReportsFilters(today, earliest);

  const trend = useMemo(
    () => trendSeries(worklogs, { from: f.from, to: f.to, granularity: f.granularity, projectId: f.projectId }),
    [worklogs, f.from, f.to, f.granularity, f.projectId],
  );
  const markers = useMemo(
    () => rateChangeMarkers(contracts, { from: f.from, to: f.to, projectId: f.projectId }),
    [contracts, f.from, f.to, f.projectId],
  );
  const earnings = useMemo(
    () => earningsSummary(worklogs, { from: f.from, to: f.to, projectId: f.projectId }),
    [worklogs, f.from, f.to, f.projectId],
  );
  const breakdown = useMemo(
    () => projectBreakdown(worklogs, { from: f.from, to: f.to }),
    [worklogs, f.from, f.to],
  );
  const heatmap = useMemo(
    () => activityHeatmapRange(worklogs, { from: f.from, to: f.to }),
    [worklogs, f.from, f.to],
  );

  if (state === 'loading' && data == null) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text.muted, fontSize: 15, fontFamily: 'system-ui, sans-serif' }}>
        Načítání…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: 'transparent', minHeight: '100%', color: C.text }}>
      <ReportsFilterBar
        preset={f.preset}
        granularity={f.granularity}
        projectId={f.projectId}
        projects={projects}
        from={f.from}
        to={f.to}
        onPreset={f.setPreset}
        onGranularity={f.setGranularity}
        onProject={f.setProjectId}
      />
      <div style={{ padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Section title="Trend">
          <TrendChart series={trend} markers={markers} from={f.from} to={f.to} granularity={f.granularity} />
        </Section>
        <Section title="Výdělky">
          <EarningsSummaryPanel summary={earnings} onOpenProject={onOpenProject} />
        </Section>
        <Section title="Podle projektů">
          <ProjectDonut slices={breakdown} onOpenProject={onOpenProject} />
        </Section>
        <Section title="Aktivita">
          <ActivityHeatmapPanel heatmap={heatmap} />
        </Section>
      </div>
    </div>
  );
}
