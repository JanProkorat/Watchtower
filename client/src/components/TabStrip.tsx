import { Box, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import type { InstanceView } from '../state/useInstances.js';

const DASHBOARD_TAB = '__dashboard__';

function basename(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function statusColor(status: string): string {
  switch (status) {
    case 'waiting-permission':
    case 'crashed':
      return '#ef5350';
    case 'waiting-input':
      return '#ffb74d';
    case 'idle-notify':
      return '#9e9e9e';
    case 'working':
    case 'spawning':
    case 'resuming':
      return '#7aa7ff';
    case 'finished':
      return '#66bb6a';
    case 'suspended':
      return '#5a6068';
    default:
      return '#666';
  }
}

interface Props {
  instances: InstanceView[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew(): void;
}

export function TabStrip({ instances, activeId, onSelect, onNew }: Props) {
  const tabs: Array<{ id: string; label: string; status: string }> = [
    { id: DASHBOARD_TAB, label: 'Dashboard', status: 'dashboard' },
    ...instances.map((i) => ({
      id: i.id,
      label: basename(i.cwd) || i.cwd,
      status: i.status,
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
            sx={{ minHeight: 40, textTransform: 'none', fontSize: 13 }}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {t.status !== 'dashboard' && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: statusColor(t.status),
                    }}
                  />
                )}
                {t.label}
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
