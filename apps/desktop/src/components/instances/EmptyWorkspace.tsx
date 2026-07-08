import { Box, Button, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

interface Props {
  onNew(): void;
}

/**
 * Placeholder shown in the Instances workspace when no session tab is open
 * (fresh launch, or the last session tab was closed). Replaces the old
 * in-workspace Dashboard tab — the session overview now lives in the
 * standalone Dashboard module. The layout still falls back to this leaf, so
 * it doubles as the workspace's empty state.
 */
export function EmptyWorkspace({ onNew }: Props) {
  return (
    <Box
      sx={{
        flex: 1,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 4,
      }}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 420, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          No sessions open
        </Typography>
        <Typography variant="body2" color="text.disabled">
          Click <strong>New instance</strong> (or <strong>+</strong> in the tab strip) to spawn a
          claude session in a working directory of your choice.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={onNew}>
          New instance
        </Button>
      </Stack>
    </Box>
  );
}
