import { useEffect, useState, type ReactNode } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard';
import TerminalIcon from '@mui/icons-material/Terminal';
import TimerIcon from '@mui/icons-material/Timer';
import SettingsIcon from '@mui/icons-material/Settings';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

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

const COLLAPSED_WIDTH = 52;
const EXPANDED_WIDTH = 200;
const STORAGE_KEY = 'watchtower.moduleRail.expanded';

function WatchtowerLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polygon points="512,152 664,240 664,416 512,504 360,416 360,240" fill="#4dd0e1" />
      <polygon points="320,496 472,584 472,760 320,848 168,760 168,584" fill="#1abc9c" />
      <polygon points="704,496 856,584 856,760 704,848 552,760 552,584" fill="#2980b9" />
    </svg>
  );
}

interface Props {
  active: ModuleId;
  onSelect(id: ModuleId): void;
}

export function ModuleRail({ active, onSelect }: Props) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
    } catch {
      // ignore — persistence is best-effort
    }
  }, [expanded]);

  return (
    <Box
      sx={{
        width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        backgroundColor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        pb: 1,
        px: expanded ? 1 : 0,
        gap: 0.5,
        flexShrink: 0,
        transition: 'width 160ms ease, padding 160ms ease',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          gap: 1.25,
          height: 56,
          px: expanded ? 1 : 0,
          mb: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <WatchtowerLogo size={28} />
        </Box>
        {expanded && (
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: 0.2,
              color: 'text.primary',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Watchtower
          </Typography>
        )}
      </Box>

      {ITEMS.map((item) => {
        const isActive = active === item.id && item.enabled;
        const row = (
          <ButtonBase
            disabled={!item.enabled}
            onClick={() => item.enabled && onSelect(item.id)}
            sx={{
              width: expanded ? '100%' : 40,
              height: 40,
              alignSelf: expanded ? 'stretch' : 'center',
              borderRadius: 1,
              px: expanded ? 1 : 0,
              justifyContent: expanded ? 'flex-start' : 'center',
              gap: expanded ? 1.25 : 0,
              color: isActive
                ? 'primary.main'
                : item.enabled
                  ? 'text.secondary'
                  : 'text.disabled',
              backgroundColor: isActive ? 'action.selected' : 'transparent',
              transition: 'background-color 120ms ease, color 120ms ease',
              ':hover': {
                backgroundColor: isActive ? 'action.selected' : 'action.hover',
                color: item.enabled ? 'text.primary' : 'text.disabled',
              },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24 }}>
              {item.icon}
            </Box>
            {expanded && (
              <Typography
                variant="body2"
                sx={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: 'inherit',
                }}
              >
                {item.label}
              </Typography>
            )}
          </ButtonBase>
        );

        if (expanded) {
          return (
            <Box key={item.id} sx={{ display: 'flex' }}>
              {row}
            </Box>
          );
        }

        return (
          <Tooltip
            key={item.id}
            title={item.enabled ? item.label : `${item.label} (coming soon)`}
            placement="right"
          >
            <span style={{ display: 'flex', justifyContent: 'center' }}>{row}</span>
          </Tooltip>
        );
      })}

      <Box sx={{ flex: 1 }} />

      <Tooltip title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} placement="right">
        <Box sx={{ display: 'flex', justifyContent: expanded ? 'flex-end' : 'center' }}>
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            sx={{
              width: 32,
              height: 32,
              color: 'text.secondary',
              ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            }}
          >
            {expanded ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        </Box>
      </Tooltip>
    </Box>
  );
}
