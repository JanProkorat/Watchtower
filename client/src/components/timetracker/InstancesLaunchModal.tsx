import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import TerminalIcon from '@mui/icons-material/Terminal';
import CloseIcon from '@mui/icons-material/Close';
import type { RunningInstancePayload } from '../../../../shared/ipcContract.js';

interface Props {
  open: boolean;
  projectName: string;
  cwd: string;
  /** The running instances matching this project's cwd. */
  runningInstances: RunningInstancePayload[];
  onClose(): void;
  onActivateInstance(id: string): void;
  onSpawnNew(cwd: string): void;
}

const STATE_DOT_COLOR: Record<string, string> = {
  working: '#66bb6a',
  'waiting-permission': '#ef5350',
  'waiting-input': '#ffb74d',
  'idle-notify': '#9e9e9e',
  spawning: '#7aa7ff',
};

const STATE_LABEL: Record<string, string> = {
  working: 'working',
  'waiting-permission': 'waiting permission',
  'waiting-input': 'waiting input',
  'idle-notify': 'idle',
  spawning: 'spawning',
};

function fmtAge(lastActivityAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - lastActivityAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Choice modal shown when a project's folder already has live Claude
 * instances. Each running instance is one card-button; "Create new" sits
 * underneath so the spawn flow is always reachable.
 */
export function InstancesLaunchModal({
  open,
  projectName,
  cwd,
  runningInstances,
  onClose,
  onActivateInstance,
  onSpawnNew,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          Open <strong>{projectName}</strong> in Instances
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {runningInstances.length}{' '}
            running {runningInstances.length === 1 ? 'instance' : 'instances'} for{' '}
            <code style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>{cwd}</code>
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {runningInstances.map((inst) => (
          <ChoiceCard
            key={inst.id}
            title="Open existing instance"
            onClick={() => {
              onActivateInstance(inst.id);
              onClose();
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: STATE_DOT_COLOR[inst.status] ?? '#7aa7ff',
                  boxShadow: `0 0 0 3px ${alpha(STATE_DOT_COLOR[inst.status] ?? '#7aa7ff', 0.18)}`,
                }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {STATE_LABEL[inst.status] ?? inst.status} · {fmtAge(inst.lastActivityAt)}
              </Typography>
              {inst.jiraKeyHint && (
                <>
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    ·
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: 'Menlo, monospace', fontSize: 11, color: 'text.secondary' }}
                  >
                    {inst.jiraKeyHint}
                  </Typography>
                </>
              )}
            </Stack>
          </ChoiceCard>
        ))}
        <ChoiceCard
          icon={<AddIcon />}
          title="Create new instance"
          onClick={() => {
            onSpawnNew(cwd);
            onClose();
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Spawn a fresh <code style={{ fontFamily: 'Menlo, monospace', fontSize: 11 }}>claude</code>{' '}
            in <code style={{ fontFamily: 'Menlo, monospace', fontSize: 11 }}>{cwd}</code>
          </Typography>
        </ChoiceCard>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

function ChoiceCard({
  icon,
  title,
  children,
  onClick,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  onClick(): void;
}) {
  return (
    <Box
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        cursor: 'pointer',
        backgroundColor: 'background.paper',
        transition: 'background-color 80ms ease, border-color 80ms ease',
        ':hover': {
          backgroundColor: 'action.hover',
          borderColor: 'primary.main',
        },
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1,
          backgroundColor: 'action.hover',
          color: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon ?? <TerminalIcon fontSize="small" />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        {children}
      </Box>
      <Typography sx={{ color: 'text.disabled', fontSize: 18 }}>›</Typography>
    </Box>
  );
}
