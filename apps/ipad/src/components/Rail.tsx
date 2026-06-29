// apps/ipad/src/components/Rail.tsx
import { useEffect, useState } from 'react';

// Mirrors the desktop ModuleRail: same glyphs, the same Watchtower logo, and
// collapse/expand. Top-level modules are Přehled (dashboard) / Instance /
// Vzdálený Mac / Fakturace / Nastavení. Fakturace owns an expandable, indented
// sub-section of billing routes — the same pattern the desktop rail uses, which
// replaces the old in-module billing nav bar. Labels are Czech (app locale).

export type RailModule = 'dashboard' | 'instances' | 'remote' | 'billing';

// Billing sub-routes promoted into the rail under the Fakturace parent. The
// former 'dashboard' billing tab is now the top-level Přehled module, so it is
// intentionally absent here.
export type BillingSection =
  | 'earnings' | 'reports'
  | 'records-list' | 'records-grid' | 'records-tasks' | 'records-timeoff';

interface Props {
  active: RailModule;
  /** Selected billing sub-route (highlights a rail child when billing is active). */
  billingSection: BillingSection;
  onSelect?(id: RailModule): void;
  /** Switch to billing and route to a specific sub-route. */
  onSelectBillingTab?(tab: BillingSection): void;
  notificationCount?: number;
  onOpenNotifications?: () => void;
}

const COLLAPSED_WIDTH = 52;
const EXPANDED_WIDTH = 232;
const STORAGE_KEY = 'watchtower.ipad.rail.expanded';
const BILLING_STORAGE_KEY = 'watchtower.ipad.rail.billingExpanded';

function readPersistedBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Icons — exact MUI Material paths (same glyphs as the desktop rail), inline so
// there's no MUI/icon-font dependency in the iPad app.
// ---------------------------------------------------------------------------

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const DASHBOARD_D = 'M11 21H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h6zm2 0h6c1.1 0 2-.9 2-2v-7h-8zm8-11V5c0-1.1-.9-2-2-2h-6v7z';
const SCREEN_D = 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 14H3V5h18z';
const TERMINAL_D = 'M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2m0 14H4V8h16zm-2-1h-6v-2h6zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4z';
const BILLING_D = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm1 10h-4v1h3c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-1v1h-2v-1H9v-2h4v-1h-3c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1h1V9h2v1h2zm-2-4V3.5L17.5 8z';
const SETTINGS_D = 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6';
const CHEVRON_LEFT_D = 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z';
const CHEVRON_RIGHT_D = 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z';
const EXPAND_MORE_D = 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z';
const EXPAND_LESS_D = 'M12 8l-6 6 1.41 1.42L12 10.83l4.59 4.59L18 14z';

// Billing sub-route glyphs — same Material icons as the desktop ModuleRail.
// Payments (Výdělky), BarChart (Reporty), AccessTime (Seznam/worklogs),
// TableChartOutlined (Mřížka/grid), Checklist (Úkoly), BeachAccessOutlined (Volno).
const EARNINGS_D = 'M19 14V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2m-9-1c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3m13-6v11c0 1.1-.9 2-2 2H4v-2h17V7z';
const REPORTS_D = 'M4 9h4v11H4zm12 4h4v7h-4zm-6-9h4v16h-4z';
const WORKLOGS_D = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z';
const GRID_D = 'M20 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 2v3H5V5zm-5 14h-5v-9h5zM5 10h3v9H5zm12 9v-9h3v9z';
const TASKS_D = 'M22 7h-9v2h9zm0 8h-9v2h9zM5.54 11 2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41z';
const TIMEOFF_D = 'm21 19.57-1.427 1.428-6.442-6.442 1.43-1.428zM13.12 3c-2.58 0-5.16.98-7.14 2.95l-.01.01c-3.95 3.95-3.95 10.36 0 14.31l14.3-14.31C18.3 3.99 15.71 3 13.12 3M6.14 17.27C5.4 16.03 5 14.61 5 13.12c0-.93.16-1.82.46-2.67.19 1.91.89 3.79 2.07 5.44zm2.84-2.84C7.63 12.38 7.12 9.93 7.6 7.6c.58-.12 1.16-.18 1.75-.18 1.8 0 3.55.55 5.08 1.56zm1.47-8.97c.85-.3 1.74-.46 2.67-.46 1.49 0 2.91.4 4.15 1.14l-1.39 1.39c-1.65-1.18-3.52-1.88-5.43-2.07';

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
  id: RailModule | 'settings';
  label: string;
  d: string;
  enabled: boolean;
}

const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Přehled', d: DASHBOARD_D, enabled: true },
  { id: 'instances', label: 'Instance', d: TERMINAL_D, enabled: true },
  { id: 'remote', label: 'Vzdálený Mac', d: SCREEN_D, enabled: true },
  { id: 'billing', label: 'Fakturace', d: BILLING_D, enabled: true },
  { id: 'settings', label: 'Nastavení', d: SETTINGS_D, enabled: false },
];

const BILLING_TABS: { id: BillingSection; label: string; d: string }[] = [
  { id: 'earnings', label: 'Výdělky', d: EARNINGS_D },
  { id: 'reports', label: 'Reporty', d: REPORTS_D },
  { id: 'records-list', label: 'Seznam', d: WORKLOGS_D },
  { id: 'records-grid', label: 'Mřížka', d: GRID_D },
  { id: 'records-tasks', label: 'Úkoly', d: TASKS_D },
  { id: 'records-timeoff', label: 'Volno', d: TIMEOFF_D },
];

export function Rail({
  active,
  billingSection,
  onSelect,
  onSelectBillingTab,
  notificationCount,
  onOpenNotifications,
}: Props) {
  const [expanded, setExpanded] = useState<boolean>(() => readPersistedBool(STORAGE_KEY, true));
  const [billingExpanded, setBillingExpanded] = useState<boolean>(() =>
    readPersistedBool(BILLING_STORAGE_KEY, true),
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

  // Parent click: plain modules switch directly. Fakturace toggles its sub-list
  // when already active, otherwise activates billing and forces the list open so
  // the active child is visible (same UX as the desktop ModuleRail).
  function handleParentClick(item: RailItem) {
    if (!item.enabled) return;
    if (item.id !== 'billing') {
      onSelect?.(item.id as RailModule);
      return;
    }
    if (active === 'billing') {
      setBillingExpanded((v) => !v);
    } else {
      onSelect?.('billing');
      setBillingExpanded(true);
    }
  }

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

      {/* Notification bell — visible in every module */}
      <button
        onClick={() => onOpenNotifications?.()}
        title="Upozornění"
        style={{
          position: 'relative', width: 40, height: 40, marginBottom: 4, borderRadius: 8,
          border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
          alignSelf: expanded ? 'flex-start' : 'center', marginLeft: expanded ? 4 : 0,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2m6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1z" />
        </svg>
        {notificationCount ? (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{notificationCount}</span>
        ) : null}
      </button>

      {/* Nav items */}
      {ITEMS.map((item) => {
        const isActive = item.id === active && item.enabled;
        const hasSub = item.id === 'billing';
        const showChildren = hasSub && expanded && billingExpanded;

        const row = (
          <button
            disabled={!item.enabled}
            onClick={() => handleParentClick(item)}
            title={item.enabled ? item.label : `${item.label} (připravujeme)`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: expanded ? 'flex-start' : 'center',
              gap: expanded ? 12 : 0,
              flex: 1,
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

        // Chevron toggles the billing sub-list without switching module. Lives
        // outside the row button so a tap on it doesn't also fire the row.
        const chevron = hasSub && expanded ? (
          <button
            onClick={(e) => { e.stopPropagation(); setBillingExpanded((v) => !v); }}
            aria-label={billingExpanded ? 'Sbalit fakturaci' : 'Rozbalit fakturaci'}
            title={billingExpanded ? 'Sbalit' : 'Rozbalit'}
            style={{
              width: 28, height: 28, marginLeft: 4, flexShrink: 0, borderRadius: 8,
              border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Icon d={billingExpanded ? EXPAND_LESS_D : EXPAND_MORE_D} size={18} />
          </button>
        ) : null;

        return (
          <div key={item.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {row}
              {chevron}
            </div>

            {/* Billing sub-routes — indented children, only when expanded */}
            {showChildren && BILLING_TABS.map((tab) => {
              const subActive = active === 'billing' && billingSection === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectBillingTab?.(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 32,
                    paddingLeft: 22,
                    paddingRight: 10,
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    backgroundColor: subActive ? '#2d2857' : 'transparent',
                    color: subActive ? '#a89cf0' : '#9ca3af',
                    transition: 'background-color 120ms ease, color 120ms ease',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, flexShrink: 0 }}>
                    <Icon d={tab.d} size={16} />
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: subActive ? 600 : 400,
                      fontFamily: 'system-ui, sans-serif',
                      letterSpacing: 0.2,
                      whiteSpace: 'nowrap',
                      color: 'inherit',
                    }}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
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
