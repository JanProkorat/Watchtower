// apps/ipad/src/components/Rail.tsx
import { useEffect, useState, type ReactNode } from 'react';

// Mirrors the desktop ModuleRail: same four entries (icons + labels), the same
// Watchtower logo, and collapse/expand. Only 'instances' is interactive in v1;
// Dashboard / Billing / Settings are shown disabled for parity. The desktop's
// light/dark toggle is omitted — the iPad app is dark-only.

export type RailModule = 'instances';

interface Props {
  active: RailModule;
  onSelect?(id: RailModule): void;
}

const COLLAPSED_WIDTH = 52;
const EXPANDED_WIDTH = 232;
const STORAGE_KEY = 'watchtower.ipad.rail.expanded';

function readExpanded(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Icons — exact MUI Material paths (same glyphs as the desktop rail), inline so
// there's no MUI/icon-font dependency in the iPad app.
// ---------------------------------------------------------------------------

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const DASHBOARD_D = 'M11 21H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h6zm2 0h6c1.1 0 2-.9 2-2v-7h-8zm8-11V5c0-1.1-.9-2-2-2h-6v7z';
const TERMINAL_D = 'M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2m0 14H4V8h16zm-2-1h-6v-2h6zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4z';
const BILLING_D = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm1 10h-4v1h3c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-1v1h-2v-1H9v-2h4v-1h-3c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1h1V9h2v1h2zm-2-4V3.5L17.5 8z';
const SETTINGS_D = 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6';
const CHEVRON_LEFT_D = 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z';
const CHEVRON_RIGHT_D = 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z';

function WatchtowerLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polygon points="512,152 664,240 664,416 512,504 360,416 360,240" fill="#4dd0e1" />
      <polygon points="320,496 472,584 472,760 320,848 168,760 168,584" fill="#1abc9c" />
      <polygon points="704,496 856,584 856,760 704,848 552,760 552,584" fill="#2980b9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

interface RailItem {
  id: string;
  label: string;
  d: string;
  enabled: boolean;
}

const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', d: DASHBOARD_D, enabled: false },
  { id: 'instances', label: 'Instances', d: TERMINAL_D, enabled: true },
  { id: 'billing', label: 'Billing', d: BILLING_D, enabled: false },
  { id: 'settings', label: 'Settings', d: SETTINGS_D, enabled: false },
];

export function Rail({ active, onSelect }: Props) {
  const [expanded, setExpanded] = useState<boolean>(readExpanded);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
    } catch {
      /* best-effort */
    }
  }, [expanded]);

  return (
    <div
      style={{
        width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        flexShrink: 0,
        backgroundColor: '#13141a',
        borderRight: '1px solid #2e3038',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        paddingLeft: expanded ? 8 : 0,
        paddingRight: expanded ? 8 : 0,
        paddingBottom: 8,
        gap: 4,
        overflow: 'hidden',
        transition: 'width 160ms ease, padding 160ms ease',
      }}
    >
      {/* Logo + wordmark */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          gap: 10,
          height: 56,
          paddingLeft: expanded ? 8 : 0,
          marginBottom: 4,
          borderBottom: '1px solid #2e3038',
          flexShrink: 0,
        }}
      >
        <WatchtowerLogo size={28} />
        {expanded && (
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: 0.2,
              color: '#e5e7eb',
              whiteSpace: 'nowrap',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Watchtower
          </span>
        )}
      </div>

      {/* Nav items */}
      {ITEMS.map((item) => {
        const isActive = item.id === active && item.enabled;
        return (
          <button
            key={item.id}
            disabled={!item.enabled}
            onClick={() => item.enabled && onSelect?.('instances')}
            title={item.enabled ? item.label : `${item.label} (připravujeme)`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: expanded ? 'flex-start' : 'center',
              gap: expanded ? 12 : 0,
              width: '100%',
              height: 40,
              paddingLeft: expanded ? 10 : 0,
              paddingRight: expanded ? 10 : 0,
              borderRadius: 8,
              border: 'none',
              cursor: item.enabled ? 'pointer' : 'not-allowed',
              backgroundColor: isActive ? '#2d2857' : 'transparent',
              color: isActive ? '#a89cf0' : item.enabled ? '#9ca3af' : '#4b5563',
              transition: 'background-color 120ms ease, color 120ms ease',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, flexShrink: 0 }}>
              <Icon d={item.d} />
            </span>
            {expanded && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  fontFamily: 'system-ui, sans-serif',
                  letterSpacing: 0.2,
                  whiteSpace: 'nowrap',
                  color: 'inherit',
                }}
              >
                {item.label}
              </span>
            )}
          </button>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Collapse / expand toggle */}
      <div style={{ display: 'flex', justifyContent: expanded ? 'flex-end' : 'center' }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Sbalit panel' : 'Rozbalit panel'}
          aria-label={expanded ? 'Sbalit panel' : 'Rozbalit panel'}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: 'transparent',
            color: '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <Icon d={expanded ? CHEVRON_LEFT_D : CHEVRON_RIGHT_D} />
        </button>
      </div>
    </div>
  );
}
