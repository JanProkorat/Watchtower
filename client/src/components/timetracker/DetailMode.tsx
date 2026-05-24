import { useState } from 'react';
import { Alert, Box, Button, Skeleton, Stack, Tab, Tabs } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { DETAIL_TABS, type DetailTab } from '../../util/timetrackerUrl.js';
import { useProject } from '../../state/useProject.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import { ProjectDetailHeader } from './ProjectDetailHeader.js';
import { ProjectDrawer } from './ProjectDrawer.js';
import { EpicsTreeView } from './EpicsTreeView.js';
import { WorklogsList } from './WorklogsList.js';
import { ContractsTab } from './ContractsTab.js';

interface Props {
  projectId: number;
  tab: DetailTab;
  onTabChange(tab: DetailTab): void;
  onBack(): void;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
}

const TAB_LABELS: Record<DetailTab, string> = {
  epics: 'Epics & Tasks',
  worklogs: 'Worklogs',
  contracts: 'Contracts',
};

export function DetailMode({
  projectId,
  tab,
  onTabChange,
  onBack,
  onActivateInstance,
  onOpenNewInstanceForCwd,
}: Props) {
  const state = useProject(projectId);
  const { showError } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1,
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
      </Box>

      {state.loading && !state.project && (
        <Stack spacing={1.5} sx={{ p: 2 }}>
          <Skeleton variant="rounded" height={64} />
          <Skeleton variant="rounded" height={44} />
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={120} />
        </Stack>
      )}

      {state.error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {state.error}
        </Alert>
      )}

      {state.project && (
        <>
          <ProjectDetailHeader
            project={state.project}
            onEdit={() => setEditOpen(true)}
            onArchive={() => {
              state.archive(!state.project!.archived).catch((err) => showError(toastMessage(err)));
            }}
            onActivateInstance={onActivateInstance}
            onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
          />

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
            {tab === 'epics' && <EpicsTreeView projectId={projectId} />}
            {tab === 'worklogs' && <WorklogsList projectId={projectId} />}
            {tab === 'contracts' && <ContractsTab projectId={projectId} />}
          </Box>

          <ProjectDrawer
            open={editOpen}
            project={state.project}
            onClose={() => setEditOpen(false)}
            onSubmit={async (input) => {
              await state.update(input);
            }}
          />
        </>
      )}
    </Box>
  );
}
