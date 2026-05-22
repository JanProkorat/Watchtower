import { Box, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import type { InstanceView } from '../state/useInstances.js';

const DASHBOARD_TAB = '__dashboard__';
const LIVE_STATUSES = new Set([
  'spawning',
  'working',
  'waiting-permission',
  'waiting-input',
  'idle-notify',
  'resuming',
]);

function basename(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// Per-instance palette — picked to be saturated enough to stand out on a
// dark background and distinct under a quick glance.
const INSTANCE_PALETTE = [
  '#7aa7ff', // soft blue
  '#f0a868', // amber-orange
  '#66bb6a', // green
  '#ce93d8', // lavender
  '#4dd0e1', // cyan
  '#ffd54f', // yellow
  '#a1887f', // taupe
  '#90caf9', // pale blue
  '#ef9a9a', // pink-red
  '#80cbc4', // teal
];

function instanceColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return INSTANCE_PALETTE[Math.abs(hash) % INSTANCE_PALETTE.length] ?? '#7aa7ff';
}

// Attention states keep their canonical color (red = needs me now, amber = end
// of turn waiting). Non-attention states use the per-instance color so two
// "working" tabs are distinguishable at a glance.
const ATTENTION_COLORS: Record<string, string> = {
  'waiting-permission': '#ef5350',
  'waiting-input': '#ffb74d',
  'idle-notify': '#9e9e9e',
  crashed: '#ef5350',
  finished: '#66bb6a',
  suspended: '#5a6068',
};

function dotColor(id: string, status: string): string {
  return ATTENTION_COLORS[status] ?? instanceColor(id);
}

interface Props {
  instances: InstanceView[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onRemove(id: string, isLive: boolean): void;
}

export function TabStrip({ instances, activeId, onSelect, onNew, onRemove }: Props) {
  const tabs: Array<{ id: string; label: string; status: string; closable: boolean }> = [
    { id: DASHBOARD_TAB, label: 'Dashboard', status: 'dashboard', closable: false },
    ...instances.map((i) => ({
      id: i.id,
      label: basename(i.cwd) || i.cwd,
      status: i.status,
      closable: true,
    })),
  ];

  const value = activeId ?? DASHBOARD_TAB;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        flexShrink: 0,
      }}
    >
      <Tabs
        value={value}
        onChange={(_e, v: string) => onSelect(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, flex: 1 }}
      >
        {tabs.map((t) => (
          <Tab
            key={t.id}
            value={t.id}
            sx={{ minHeight: 40, textTransform: 'none', fontSize: 13, pr: t.closable ? 0.5 : 2 }}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {t.status !== 'dashboard' && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: dotColor(t.id, t.status),
                    }}
                  />
                )}
                {t.label}
                {t.closable && (
                  <Box
                    component="span"
                    role="button"
                    aria-label={`close ${t.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(t.id, LIVE_STATUSES.has(t.status));
                    }}
                    sx={{
                      ml: 0.5,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      height: 18,
                      borderRadius: '4px',
                      color: 'text.disabled',
                      ':hover': { backgroundColor: 'action.hover', color: 'text.primary' },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </Box>
                )}
              </Box>
            }
          />
        ))}
      </Tabs>
      <Tooltip title="New instance" placement="left">
        <IconButton
          onClick={onNew}
          size="small"
          sx={{ mr: 1, color: 'text.secondary', ':hover': { color: 'primary.main' } }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export { DASHBOARD_TAB };
