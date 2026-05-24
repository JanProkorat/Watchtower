import { Box, Button, Tab, Tabs, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { DETAIL_TABS, type DetailTab } from '../../util/timetrackerUrl.js';
import { EmptyTabState } from './EmptyTabState.js';

interface Props {
  projectId: number;
  tab: DetailTab;
  onTabChange(tab: DetailTab): void;
  onBack(): void;
}

const TAB_LABELS: Record<DetailTab, string> = {
  epics: 'Epics & Tasks',
  worklogs: 'Worklogs',
  contracts: 'Contracts',
};

export function DetailMode({ projectId, tab, onTabChange, onBack }: Props) {
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={onBack}
          sx={{ textTransform: 'none' }}
        >
          Back to projects
        </Button>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            Project #{projectId}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Header (color · name · meta · stats · Edit/Archive) ships in Phase 15.
          </Typography>
        </Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, next: DetailTab) => onTabChange(next)}
          variant="standard"
          sx={{ minHeight: 44 }}
        >
          {DETAIL_TABS.map((id) => (
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
        {tab === 'epics' && (
          <EmptyTabState
            title="Epics & Tasks (Phase 15)"
            hint="Expandable epics tree with per-epic Add Task. Epic and Task create/edit drawers land in the same phase."
          />
        )}
        {tab === 'worklogs' && (
          <EmptyTabState
            title="Worklogs (Phase 16)"
            hint="Project-scoped worklog list, grouped by day, with epic + period + source filters."
          />
        )}
        {tab === 'contracts' && (
          <EmptyTabState
            title="Contracts (Phase 17)"
            hint="Active-contract summary card + rate-period cards with create/edit drawer. Overlap validation enforced server-side."
          />
        )}
      </Box>
    </Box>
  );
}
