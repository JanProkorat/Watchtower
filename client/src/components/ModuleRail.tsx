import type { ReactNode } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard';
import TerminalIcon from '@mui/icons-material/Terminal';
import TimerIcon from '@mui/icons-material/Timer';
import SettingsIcon from '@mui/icons-material/Settings';

export type ModuleId = 'dashboard' | 'instances' | 'timetracker' | 'settings';

interface RailItem {
  id: ModuleId;
  label: string;
  icon: ReactNode;
  enabled: boolean;
}

const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <SpaceDashboardIcon fontSize="small" />, enabled: false },
  { id: 'instances', label: 'Instances', icon: <TerminalIcon fontSize="small" />, enabled: true },
  { id: 'timetracker', label: 'TimeTracker', icon: <TimerIcon fontSize="small" />, enabled: false },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon fontSize="small" />, enabled: true },
];

interface Props {
  active: ModuleId;
  onSelect(id: ModuleId): void;
}

export function ModuleRail({ active, onSelect }: Props) {
  return (
    <Box
      sx={{
        width: 52,
        backgroundColor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        gap: 0.5,
        flexShrink: 0,
      }}
    >
      {ITEMS.map((item) => (
        <Tooltip
          key={item.id}
          title={item.enabled ? item.label : `${item.label} (coming soon)`}
          placement="right"
        >
          <span>
            <IconButton
              disabled={!item.enabled}
              onClick={() => item.enabled && onSelect(item.id)}
              size="small"
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1,
                color:
                  active === item.id && item.enabled
                    ? 'primary.main'
                    : item.enabled
                      ? 'text.secondary'
                      : 'text.disabled',
                backgroundColor:
                  active === item.id && item.enabled ? 'action.selected' : 'transparent',
                ':hover': {
                  backgroundColor:
                    active === item.id && item.enabled ? 'action.selected' : 'action.hover',
                  color: item.enabled ? 'text.primary' : 'text.disabled',
                },
              }}
            >
              {item.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Box>
  );
}
