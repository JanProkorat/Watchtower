import { Box, Tab, Tabs } from '@mui/material';
import { LIST_TABS, type ListTab } from '../../util/timetrackerUrl.js';
import { EmptyTabState } from './EmptyTabState.js';
import { ProjectsList } from './ProjectsList.js';
import { WorklogsList } from './WorklogsList.js';
import { TaskGridView } from './TaskGridView.js';
import { TimeOffTab } from './TimeOffTab.js';
import { ReportsTab } from './ReportsTab.js';

interface Props {
  tab: ListTab;
  onTabChange(tab: ListTab): void;
  /** Project row → open detail mode for that project. */
  onOpenProject(projectId: number): void;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
}

const TAB_LABELS: Record<ListTab, string> = {
  projects: 'Projects',
  worklogs: 'Worklogs',
  grid: 'Task grid',
  timeoff: 'Time off',
  reports: 'Reports',
};

export function ListMode({
  tab,
  onTabChange,
  onOpenProject,
  onActivateInstance,
  onOpenNewInstanceForCwd,
}: Props) {
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
          <ProjectsList
            onOpenProject={onOpenProject}
            onActivateInstance={onActivateInstance}
            onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
          />
        )}
        {tab === 'worklogs' && <WorklogsList />}
        {tab === 'grid' && <TaskGridView />}
        {tab === 'timeoff' && <TimeOffTab />}
        {tab === 'reports' && <ReportsTab />}
      </Box>
    </Box>
  );
}
