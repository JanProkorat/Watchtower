import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard';
import TerminalIcon from '@mui/icons-material/Terminal';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import RateReviewIcon from '@mui/icons-material/RateReview';
import SettingsIcon from '@mui/icons-material/Settings';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import BeachAccessOutlinedIcon from '@mui/icons-material/BeachAccessOutlined';
import BarChartIcon from '@mui/icons-material/BarChart';
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import DataObjectIcon from '@mui/icons-material/DataObject';
import WebhookIcon from '@mui/icons-material/Webhook';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CableIcon from '@mui/icons-material/Cable';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import type { ThemeMode } from '../theme.js';
import type { ListTab } from '../util/timetrackerUrl.js';
import type { SettingsTab } from '../util/settingsUrl.js';
import { glassFloating, accentWash, accentRing, accentIconColor } from '../theme/glass.js';

export type ModuleId = 'dashboard' | 'instances' | 'billing' | 'reviews' | 'settings';

interface RailItem {
  id: ModuleId;
  label: string;
  icon: ReactNode;
  enabled: boolean;
}

const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <SpaceDashboardIcon fontSize="inherit" />, enabled: true },
  { id: 'instances', label: 'Instances', icon: <TerminalIcon fontSize="inherit" />, enabled: true },
  { id: 'billing', label: 'Billing', icon: <RequestQuoteIcon fontSize="inherit" />, enabled: true },
  { id: 'reviews', label: 'Reviews', icon: <RateReviewIcon fontSize="inherit" />, enabled: true },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon fontSize="inherit" />, enabled: true },
];

/** Sub-tab metadata for a module that exposes children under its rail entry. */
interface SubTabMeta<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

/**
 * Billing sub-section: tabs that used to live as an in-page tab strip on the
 * Billing module. Rendered indented under the Billing parent when the rail
 * and the Billing section are both expanded.
 */
const BILLING_TABS: Array<SubTabMeta<ListTab>> = [
  { id: 'projects', label: 'Projects', icon: <FolderOutlinedIcon fontSize="inherit" /> },
  { id: 'worklogs', label: 'Worklogs', icon: <AccessTimeIcon fontSize="inherit" /> },
  { id: 'grid', label: 'Task grid', icon: <TableChartOutlinedIcon fontSize="inherit" /> },
  { id: 'timeoff', label: 'Time off', icon: <BeachAccessOutlinedIcon fontSize="inherit" /> },
  { id: 'reports', label: 'Reports', icon: <BarChartIcon fontSize="inherit" /> },
  { id: 'board', label: 'Board', icon: <ViewKanbanOutlinedIcon fontSize="inherit" /> },
];

/** Settings sub-section: same pattern as Billing, for the six settings tabs. */
const SETTINGS_SUB_TABS: Array<SubTabMeta<SettingsTab>> = [
  { id: 'general', label: 'General', icon: <TuneIcon fontSize="inherit" /> },
  { id: 'json', label: 'settings.json', icon: <DataObjectIcon fontSize="inherit" /> },
  { id: 'hooks', label: 'Hooks', icon: <WebhookIcon fontSize="inherit" /> },
  { id: 'skills', label: 'Skills', icon: <AutoAwesomeIcon fontSize="inherit" /> },
  { id: 'agents', label: 'Agents', icon: <SmartToyIcon fontSize="inherit" /> },
  { id: 'mcp', label: 'MCP', icon: <CableIcon fontSize="inherit" /> },
  { id: 'hub', label: 'Messaging hub', icon: <PhoneIphoneIcon fontSize="inherit" /> },
];

// Wide enough to clear the macOS traffic lights (which the OS pins to the
// rail's top-left at x12), so the collapsed rail still fully contains them.
const COLLAPSED_WIDTH = 78;
const EXPANDED_WIDTH = 232;
const STORAGE_KEY = 'watchtower.moduleRail.expanded';
const BILLING_STORAGE_KEY = 'watchtower.moduleRail.billingExpanded';
const SETTINGS_STORAGE_KEY = 'watchtower.moduleRail.settingsExpanded';

function readPersistedBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

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
  /** Selected sub-tab in the Billing module (highlights a rail child). */
  billingTab: ListTab;
  /** Selected sub-tab in the Settings module (highlights a rail child). */
  settingsTab: SettingsTab;
  onSelect(id: ModuleId): void;
  /** Switch to Billing and route to a specific sub-tab. */
  onSelectBillingTab(tab: ListTab): void;
  /** Switch to Settings and route to a specific sub-tab. */
  onSelectSettingsTab(tab: SettingsTab): void;
  mode: ThemeMode;
  onToggleMode(): void;
}

/**
 * Runtime descriptor for the expandable sub-section under a rail item. Shared
 * shape so the render loop can treat Billing and Settings identically.
 */
interface SubSection {
  tabs: Array<SubTabMeta<string>>;
  expanded: boolean;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  activeTab: string;
  onSelect(tab: string): void;
  label: string;
}

export function ModuleRail({
  active,
  billingTab,
  settingsTab,
  onSelect,
  onSelectBillingTab,
  onSelectSettingsTab,
  mode,
  onToggleMode,
}: Props) {
  const theme = useTheme();
  // Active nav item styling — derived from the theme accent (see glass.ts), so
  // the rail, TabStrip, and SessionTabBar share one active-state language.
  const activeItemBg = accentWash(theme);
  const activeItemRingShadow = accentRing(theme);
  const accentColor = accentIconColor(theme);

  const [expanded, setExpanded] = useState<boolean>(() => readPersistedBool(STORAGE_KEY, true));
  const [billingExpanded, setBillingExpanded] = useState<boolean>(() =>
    readPersistedBool(BILLING_STORAGE_KEY, true),
  );
  const [settingsExpanded, setSettingsExpanded] = useState<boolean>(() =>
    readPersistedBool(SETTINGS_STORAGE_KEY, true),
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
    } catch {
      /* best-effort */
    }
  }, [expanded]);

  useEffect(() => {
    try {
      localStorage.setItem(BILLING_STORAGE_KEY, billingExpanded ? '1' : '0');
    } catch {
      /* best-effort */
    }
  }, [billingExpanded]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, settingsExpanded ? '1' : '0');
    } catch {
      /* best-effort */
    }
  }, [settingsExpanded]);

  const subSections: Partial<Record<ModuleId, SubSection>> = {
    billing: {
      tabs: BILLING_TABS as Array<SubTabMeta<string>>,
      expanded: billingExpanded,
      setExpanded: setBillingExpanded,
      activeTab: billingTab,
      onSelect: (t) => onSelectBillingTab(t as ListTab),
      label: 'Billing',
    },
    settings: {
      tabs: SETTINGS_SUB_TABS as Array<SubTabMeta<string>>,
      expanded: settingsExpanded,
      setExpanded: setSettingsExpanded,
      activeTab: settingsTab,
      onSelect: (t) => onSelectSettingsTab(t as SettingsTab),
      label: 'Settings',
    },
  };

  const handleParentClick = (id: ModuleId) => {
    const sub = subSections[id];
    if (!sub) {
      onSelect(id);
      return;
    }
    // When already on this module, the parent click toggles the sub-list
    // (user's collapse/expand). When switching in from elsewhere, activate
    // the module and force the sub-list open so the active child is visible.
    if (active === id) {
      sub.setExpanded((v) => !v);
    } else {
      onSelect(id);
      sub.setExpanded(true);
    }
  };

  return (
    <Box
      sx={{
        width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        // Full-height floating frosted panel. Hugs the window's top-left corner
        // (margin 0 there) so the macOS traffic lights sit on a flat area of the
        // rail, and floats on the right + bottom so the vibrancy shows around it.
        ...glassFloating(theme, { radius: 12, elevation: 1 }),
        m: '0 8px 8px 0',
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
      {/* Top drag strip — hosts the macOS traffic lights (drawn by the OS at
          x12/y14) and keeps the window draggable now that the old title bar is
          gone. Interactive rail rows below are outside this region, so they
          stay clickable. */}
      <Box style={{ WebkitAppRegion: 'drag' } as CSSProperties} sx={{ height: 30, flexShrink: 0 }} />
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
          <>
            <Typography
              sx={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0.2,
                color: 'text.primary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
              }}
            >
              Watchtower
            </Typography>
            <Tooltip
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              placement="right"
            >
              <IconButton
                size="small"
                onClick={onToggleMode}
                aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                sx={{
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
                }}
              >
                {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      {ITEMS.map((item) => {
        const isActive = active === item.id && item.enabled;
        const sub = subSections[item.id];
        const row = (
          <ButtonBase
            disabled={!item.enabled}
            onClick={() => item.enabled && handleParentClick(item.id)}
            sx={{
              width: expanded ? '100%' : 56,
              height: expanded ? 40 : 48,
              alignSelf: expanded ? 'stretch' : 'center',
              borderRadius: expanded ? 1 : '14px',
              px: expanded ? 1 : 0,
              justifyContent: expanded ? 'flex-start' : 'center',
              gap: expanded ? 1.25 : 0,
              color: isActive
                ? 'text.primary'
                : item.enabled
                  ? 'text.secondary'
                  : 'text.disabled',
              // Active: purple wash fill + 1px purple ring (prototype #s-rail .nav.on).
              backgroundColor: isActive ? activeItemBg : 'transparent',
              boxShadow: isActive
                ? activeItemRingShadow
                : 'none',
              transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
              ':hover': {
                backgroundColor: isActive ? activeItemBg : 'action.hover',
                color: item.enabled ? 'text.primary' : 'text.disabled',
              },
            }}
          >
            {/* Active item: icon tinted with theme accent color (prototype .nav.on svg). */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: expanded ? 24 : 'auto',
                // Larger glyphs when collapsed so they fill the wider icon rail.
                fontSize: expanded ? 20 : 26,
                color: isActive ? accentColor : 'inherit',
              }}
            >
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
                  flex: 1,
                  textAlign: 'left',
                }}
              >
                {item.label}
              </Typography>
            )}
          </ButtonBase>
        );

        // Chevron lives outside the ButtonBase so clicking it doesn't also
        // fire the row's onClick (which would switch modules). Only rendered
        // for items that own a sub-section and when the rail is expanded.
        const chevron = sub && expanded ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              sub.setExpanded((v) => !v);
            }}
            aria-label={`${sub.expanded ? 'Collapse' : 'Expand'} ${sub.label}`}
            sx={{
              width: 28,
              height: 28,
              ml: 0.5,
              color: 'text.secondary',
              ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            }}
          >
            {sub.expanded ? (
              <ExpandLessIcon fontSize="small" />
            ) : (
              <ExpandMoreIcon fontSize="small" />
            )}
          </IconButton>
        ) : null;

        const parentRow = expanded ? (
          <Box key={item.id} sx={{ display: 'flex', alignItems: 'center' }}>
            <Box sx={{ flex: 1, display: 'flex' }}>{row}</Box>
            {chevron}
          </Box>
        ) : (
          <Tooltip
            key={item.id}
            title={item.enabled ? item.label : `${item.label} (coming soon)`}
            placement="right"
          >
            <span style={{ display: 'flex', justifyContent: 'center' }}>{row}</span>
          </Tooltip>
        );

        if (!sub || !expanded || !sub.expanded) return parentRow;

        return (
          <Box key={item.id} sx={{ display: 'flex', flexDirection: 'column' }}>
            {parentRow}
            {sub.tabs.map((tab) => {
              const subActive = active === item.id && sub.activeTab === tab.id;
              return (
                <ButtonBase
                  key={tab.id}
                  onClick={() => sub.onSelect(tab.id)}
                  sx={{
                    height: 32,
                    pl: 4,
                    pr: 1,
                    borderRadius: 1,
                    justifyContent: 'flex-start',
                    gap: 1,
                    color: subActive ? 'text.primary' : 'text.secondary',
                    // Active sub-item: same purple wash + ring as parent items.
                    backgroundColor: subActive ? activeItemBg : 'transparent',
                    boxShadow: subActive
                      ? activeItemRingShadow
                      : 'none',
                    transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
                    ':hover': {
                      backgroundColor: subActive ? activeItemBg : 'action.hover',
                      color: 'text.primary',
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      fontSize: 16,
                      // Active sub-item: icon tinted with theme accent color.
                      color: subActive ? accentColor : 'inherit',
                    }}
                  >
                    {tab.icon}
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: 12.5,
                      fontWeight: subActive ? 600 : 400,
                      color: 'inherit',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tab.label}
                  </Typography>
                </ButtonBase>
              );
            })}
          </Box>
        );
      })}

      <Box sx={{ flex: 1 }} />

      {!expanded && (
        <Tooltip
          title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          placement="right"
        >
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.5 }}>
            <IconButton
              size="small"
              onClick={onToggleMode}
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              sx={{
                width: 32,
                height: 32,
                color: 'text.secondary',
                ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
              }}
            >
              {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
            </IconButton>
          </Box>
        </Tooltip>
      )}

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
