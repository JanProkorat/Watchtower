import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import type { InstanceView } from '../state/useInstances.js';
import { chipColorFor, isLiveStatus, relativeTime } from '../util/instanceStatus.js';

const ATTENTION_STATUSES = new Set(['waiting-permission', 'idle-notify']);
const RECENT_STATUSES = new Set(['finished', 'crashed', 'suspended']);

function basename(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

interface InstanceRowProps {
  instance: InstanceView;
  onOpen(id: string): void;
  onKill(id: string): void;
  onRemove(id: string): void;
}

function InstanceRow({ instance, onOpen, onKill, onRemove }: InstanceRowProps) {
  const live = isLiveStatus(instance.status);
  return (
    <Paper
      sx={{
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Chip
        size="small"
        label={instance.status}
        color={chipColorFor(instance.status)}
        sx={{ textTransform: 'lowercase', minWidth: 120, fontSize: 11, fontWeight: 600 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontFamily: 'Menlo, monospace', fontSize: 13 }} noWrap>
          {basename(instance.cwd) || instance.cwd}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }} noWrap>
          {instance.cwd}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}
      >
        {relativeTime(instance.lastActivityAt)}
      </Typography>
      <Stack direction="row" spacing={0.5}>
        <Button size="small" onClick={() => onOpen(instance.id)} disabled={!live}>
          Open
        </Button>
        {live ? (
          <Button size="small" color="error" onClick={() => onKill(instance.id)}>
            Kill
          </Button>
        ) : (
          <Button size="small" color="error" onClick={() => onRemove(instance.id)}>
            Remove
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

interface SectionProps {
  label: string;
  instances: InstanceView[];
  onOpen(id: string): void;
  onKill(id: string): void;
  onRemove(id: string): void;
}

function Section({ label, instances, onOpen, onKill, onRemove }: SectionProps) {
  if (instances.length === 0) return null;
  return (
    <Stack spacing={1}>
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ letterSpacing: 1.1, textTransform: 'uppercase', fontWeight: 600 }}
      >
        {label} · {instances.length}
      </Typography>
      <Stack spacing={0.75}>
        {instances.map((i) => (
          <InstanceRow
            key={i.id}
            instance={i}
            onOpen={onOpen}
            onKill={onKill}
            onRemove={onRemove}
          />
        ))}
      </Stack>
    </Stack>
  );
}

interface Props {
  instances: InstanceView[];
  onOpen(id: string): void;
  onKill(id: string): void;
  onRemove(id: string): void;
  onNew(): void;
}

export function DashboardTab({ instances, onOpen, onKill, onRemove, onNew }: Props) {
  const attention = instances.filter((i) => ATTENTION_STATUSES.has(i.status));
  const live = instances.filter(
    (i) => isLiveStatus(i.status) && !ATTENTION_STATUSES.has(i.status),
  );
  const recent = instances.filter((i) => RECENT_STATUSES.has(i.status));
  const waitingCount = attention.length;

  return (
    <Box sx={{ p: 4, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
        <Stack>
          <Typography variant="h5">Instances</Typography>
          <Typography variant="body2" color="text.secondary">
            {instances.length === 0
              ? 'No instances yet.'
              : `${live.length + attention.length} running · ${waitingCount} needing attention`}
          </Typography>
        </Stack>
        <Button variant="contained" onClick={onNew}>
          New instance
        </Button>
      </Stack>

      {instances.length === 0 ? (
        <Paper
          sx={{
            p: 5,
            textAlign: 'center',
            backgroundColor: 'background.paper',
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Click <strong>New instance</strong> (or <strong>+</strong> in the tab strip) to spawn a
            claude session in a working directory of your choice.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={3}>
          <Section
            label="Needs attention"
            instances={attention}
            onOpen={onOpen}
            onKill={onKill}
            onRemove={onRemove}
          />
          <Section
            label="Live"
            instances={live}
            onOpen={onOpen}
            onKill={onKill}
            onRemove={onRemove}
          />
          <Section
            label="Recent"
            instances={recent}
            onOpen={onOpen}
            onKill={onKill}
            onRemove={onRemove}
          />
        </Stack>
      )}
    </Box>
  );
}
