import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import type { InstanceView } from '../../state/useInstances.js';
import { chipColorFor, isLiveStatus, relativeTime } from '../../util/instanceStatus.js';

export interface SessionRowProps {
  instance: InstanceView;
  onOpen(id: string): void;
  onKill(id: string): void;
}

export function SessionRow({ instance, onOpen, onKill }: SessionRowProps) {
  const live = isLiveStatus(instance.status);
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
