import { Box, Button, Tab, Tabs } from '@mui/material';
import { LIST_TABS, type ListTab } from '../../util/timetrackerUrl.js';
import { EmptyTabState } from './EmptyTabState.js';

interface Props {
  tab: ListTab;
  onTabChange(tab: ListTab): void;
  /** Mock affordance for Phase 13 — Phase 14 replaces the Projects tab body with a real list. */
  onOpenMockProject(): void;
}

const TAB_LABELS: Record<ListTab, string> = {
  projects: 'Projects',
  worklogs: 'Worklogs',
  grid: 'Task grid',
  timeoff: 'Time off',
  reports: 'Reports',
};

export function ListMode({ tab, onTabChange, onOpenMockProject }: Props) {
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, next: ListTab) => onTabChange(next)}
          variant="standard"
          sx={{ minHeight: 44 }}
        >
          {LIST_TABS.map((id) => (
            <Tab
              key={id}
              value={id}
              label={TAB_LABELS[id]}
              sx={{ textTransform: 'none', fontSize: 13, minHeight: 44, fontWeight: 500 }}
            />
          ))}
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'auto', minHeight: 0 }}>
        {tab === 'projects' && (
          <EmptyTabState
            title="No projects yet"
            hint="Create your first project to start tracking time. The Projects list, search, and create/edit drawer ship in Phase 14."
            action={
              <Button variant="contained" size="small" onClick={onOpenMockProject}>
                Open mock project (#1)
              </Button>
            }
          />
        )}
        {tab === 'worklogs' && (
          <EmptyTabState
            title="No worklogs"
            hint="The flat, day-grouped worklog list with filters ships in Phase 16. Manual entries land first; the watchtower-auto ingest path from the MVP keeps working through the migration."
          />
        )}
        {tab === 'grid' && (
          <EmptyTabState
            title="Task grid (Phase 18)"
            hint="A monthly per-task ⇄ per-day matrix with sticky borders and stacked sticky earnings rows."
          />
        )}
        {tab === 'timeoff' && (
          <EmptyTabState
            title="Time off (Phase 19)"
            hint="3-month calendar plus a paged Upcoming days off list. Includes Czech public holidays (computed)."
          />
        )}
        {tab === 'reports' && (
          <EmptyTabState
            title="Reports (Phase 20)"
            hint="Sticky filter bar, trend chart, project donut + earnings, active contracts, activity heatmap."
          />
        )}
      </Box>
    </Box>
  );
}
