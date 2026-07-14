import { Box, ButtonBase, Grid, Paper, Stack, Typography } from '@mui/material';
import type { DashboardActiveContractPayload } from '@watchtower/shared/ipcContract.js';
import ContractStatusCard from '../timetracker/charts/ContractStatusCard.js';

export interface ActiveContractsCardProps {
  contracts: DashboardActiveContractPayload[];
  /** Clicking a contract card hands the project id back so the parent can
   *  switch to the TimeTracker module and select the project. */
  onOpenProject(projectId: number): void;
}

export function ActiveContractsCard({ contracts, onOpenProject }: ActiveContractsCardProps) {
  if (contracts.length === 0) return null;

  // A pooled contract covers several projects but shows as one card, so count
  // distinct projects across every card rather than the number of cards.
  const projectCount = new Set(contracts.flatMap((c) => c.groupProjects.map((p) => p.id))).size;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" alignItems="baseline" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Active contracts
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </Typography>
      </Stack>
      <Grid container spacing={2}>
        {contracts.map((c) => (
          <Grid item xs={12} md={6} lg={4} key={c.projectId}>
            <ButtonBase
              onClick={() => onOpenProject(c.projectId)}
              sx={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                borderRadius: 1.5,
                '&:hover': { filter: 'brightness(1.05)' },
                '&:focus-visible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
              }}
            >
              <Box sx={{ width: '100%' }}>
                <ContractStatusCard
                  contract={c.contract}
                  projectName={c.projectName}
                  projectColor={c.projectColor}
                  projects={c.groupProjects.map((p) => ({ name: p.name, color: p.color }))}
                />
              </Box>
            </ButtonBase>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}
