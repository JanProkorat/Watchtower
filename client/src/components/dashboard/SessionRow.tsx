import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import type { InstanceView } from '../../state/useInstances.js';

const LIVE_STATUSES = new Set([
  'spawning', 'working', 'waiting-permission', 'waiting-input', 'idle-notify', 'resuming',
]);

function chipColorFor(
  status: string,
): 'default' | 'primary' | 'warning' | 'error' | 'success' | 'info' {
  switch (status) {
    case 'waiting-permission':
    case 'crashed':
      return 'error';
    case 'waiting-input':
      return 'warning';
    case 'idle-notify':
      return 'default';
    case 'working':
    case 'spawning':
    case 'resuming':
      return 'primary';
    case 'finished':
      return 'success';
    default:
      return 'default';
  }
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)} s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} h ago`;
  return `${Math.floor(delta / 86_400_000)} d ago`;
}

export interface SessionRowProps {
  instance: InstanceView;
  onOpen(id: string): void;
  onKill(id: string): void;
}

export function SessionRow({ instance, onOpen, onKill }: SessionRowProps) {
  const live = LIVE_STATUSES.has(instance.status);
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{
        p: 1.25,
        backgroundColor: 'background.default',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.25,
      }}
    >
      <Chip
        size="small"
        label={instance.status}
        color={chipColorFor(instance.status)}
        sx={{ textTransform: 'lowercase', minWidth: 110, fontSize: 10.5, fontWeight: 600, justifyContent: 'center' }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily: 'Menlo, monospace',
            fontSize: 12,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {instance.cwd}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {relativeTime(instance.lastActivityAt)}
        </Typography>
      </Box>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Button size="small" variant={live ? 'contained' : 'outlined'} onClick={() => onOpen(instance.id)}>
          Open
        </Button>
        {live && (
          <Tooltip title="Kill">
            <IconButton size="small" onClick={() => onKill(instance.id)}>
              <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}
