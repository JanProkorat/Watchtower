// apps/ipad/src/components/Rail.tsx
import type { ReactNode } from 'react';

// Only 'instances' is interactive in v1. TimeTracker and Settings are stubbed
// as disabled with a tooltip ("Připravujeme" = "coming soon" in Czech).

export type RailModule = 'instances';

interface Props {
  active: RailModule;
  onSelect?(id: RailModule): void;
}

// ---------------------------------------------------------------------------
// Icons — inline SVG so there's no MUI/icon-font dependency in the iPad app.
// ---------------------------------------------------------------------------

function InstancesIcon() {
  // MUI Terminal icon (same glyph the desktop ModuleRail uses for Instances).
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2m0 14H4V8h16zm-2-1h-6v-2h6zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4z" />
    </svg>
  );
}

function TimeTrackerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Watchtower logo (same polygon art as the desktop rail)
// ---------------------------------------------------------------------------

function WatchtowerLogo({ size = 24 }: { size?: number }) {
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

// ---------------------------------------------------------------------------
// Rail item descriptor
// ---------------------------------------------------------------------------

interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
  enabled: boolean;
  tooltip?: string;
}

const ITEMS: RailItem[] = [
  { id: 'instances', label: 'Instance', icon: <InstancesIcon />, enabled: true },
  { id: 'timetracker', label: 'Čas', icon: <TimeTrackerIcon />, enabled: false, tooltip: 'Připravujeme' },
  { id: 'settings', label: 'Nastavení', icon: <SettingsIcon />, enabled: false, tooltip: 'Připravujeme' },
];

// ---------------------------------------------------------------------------
// Rail component
// ---------------------------------------------------------------------------

export function Rail({ active, onSelect }: Props) {
  return (
    <div
      style={{
        width: 64,
        flexShrink: 0,
        backgroundColor: '#13141a',
        borderRight: '1px solid #2e3038',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 0,
        paddingBottom: 12,
        gap: 0,
      }}
    >
      {/* Logo / branding */}
      <div
        style={{
          width: '100%',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid #2e3038',
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <WatchtowerLogo size={28} />
      </div>

      {/* Nav items */}
      {ITEMS.map((item) => {
        const isActive = item.id === active && item.enabled;
        const button = (
          <button
            key={item.id}
            disabled={!item.enabled}
            onClick={() => item.enabled && item.id === 'instances' && onSelect?.('instances')}
            title={item.tooltip ?? item.label}
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              border: 'none',
              cursor: item.enabled ? 'pointer' : 'not-allowed',
              backgroundColor: isActive ? '#2d2857' : 'transparent',
              color: isActive ? '#a89cf0' : item.enabled ? '#9ca3af' : '#4b5563',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: 0,
              transition: 'background-color 120ms ease, color 120ms ease',
              WebkitTapHighlightColor: 'transparent',
            }}
            onPointerEnter={(e) => {
              if (item.enabled && !isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1e2028';
                (e.currentTarget as HTMLButtonElement).style.color = '#d1d5db';
              }
            }}
            onPointerLeave={(e) => {
              if (item.enabled && !isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
              }
            }}
          >
            {item.icon}
            <span
              style={{
                fontSize: 10,
                fontFamily: 'system-ui, sans-serif',
                letterSpacing: 0.2,
                lineHeight: 1,
                whiteSpace: 'nowrap',
                color: 'inherit',
              }}
            >
              {item.label}
            </span>
          </button>
        );

        return (
          <div
            key={item.id}
            style={{ display: 'flex', justifyContent: 'center', width: '100%', paddingTop: 4 }}
          >
            {button}
          </div>
        );
      })}
    </div>
  );
}
