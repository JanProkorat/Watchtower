import { Box, Button, Grid, Paper, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import type { InstanceView } from '../../state/useInstances.js';
import { SessionRow } from './SessionRow.js';

const LIVE_STATUSES = new Set([
  'spawning', 'working', 'waiting-permission', 'waiting-input', 'idle-notify', 'resuming',
]);
const RECENT_STATUSES = new Set(['finished', 'crashed', 'suspended']);
const RECENT_CAP = 5;

export interface SessionsCardProps {
  instances: InstanceView[];
  onActivateInstance(id: string): void;
  onKill(id: string): void;
  onStartNewInstance(): void;
}

function ColumnHead({ label, count }: { label: string; count: number }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75, px: 0.25 }}>
      <Typography
        sx={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 11, fontWeight: 600, color: 'text.secondary' }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          px: 1, py: 0.25, borderRadius: 999,
          backgroundColor: 'background.default',
          color: 'text.secondary',
          fontSize: 11,
        }}
      >
        {count}
      </Box>
    </Stack>
  );
}

function EmptyState({ label, onStartNewInstance }: { label: string; onStartNewInstance?: () => void }) {
  return (
    <Stack
      alignItems="center"
      spacing={1.5}
      sx={{
        py: 2.25,
        px: 1.5,
        border: 1,
        borderColor: 'divider',
        borderStyle: 'dashed',
        borderRadius: 1.25,
      }}
    >
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      {onStartNewInstance && (
        <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={onStartNewInstance}>
          Start a new instance
        </Button>
      )}
    </Stack>
  );
}

export function SessionsCard({
  instances,
  onActivateInstance,
  onKill,
  onStartNewInstance,
}: SessionsCardProps) {
  const live = instances.filter((i) => LIVE_STATUSES.has(i.status));
  const recent = instances
    .filter((i) => RECENT_STATUSES.has(i.status))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, RECENT_CAP);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>Sessions</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <ColumnHead label="Live" count={live.length} />
          {live.length === 0 ? (
            <EmptyState label="No live sessions" onStartNewInstance={onStartNewInstance} />
          ) : (
            <Stack spacing={1}>
              {live.map((i) => (
                <SessionRow key={i.id} instance={i} onOpen={onActivateInstance} onKill={onKill} />
              ))}
            </Stack>
          )}
        </Grid>

        <Grid item xs={12} md={6}>
          <ColumnHead label="Recent" count={recent.length} />
          {recent.length === 0 ? (
            <EmptyState label="No recent sessions" />
          ) : (
            <Stack spacing={1}>
              {recent.map((i) => (
                <SessionRow key={i.id} instance={i} onOpen={onActivateInstance} onKill={onKill} />
              ))}
            </Stack>
          )}
        </Grid>
      </Grid>
    </Paper>
  );
}
