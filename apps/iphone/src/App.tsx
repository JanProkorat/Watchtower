import { useState, type CSSProperties } from 'react';
import { useSupabaseAuth } from '@watchtower/data-supabase';
import {
  BillingLogin,
  DashboardView,
  EarningsMonthView,
  ProjectDetailView,
  ReportsView,
  WorklogListView,
  TaskGridView,
  TaskListView,
  TimeOffView,
} from '@watchtower/module-timetracker';
import { text, glassPanel, accentIcon } from '@watchtower/ui-core';

// ---------------------------------------------------------------------------
// iPhone shell — TimeTracker only, data plane (Supabase). One auth gate, then
// a bottom tab bar (Přehled / Výdělky / Reporty / Záznamy) composing the
// individual views exported by @watchtower/module-timetracker. The "Záznamy"
// tab fans out to the four record sub-views via a secondary segmented control.
// Portrait, iPhone-width; the offline cache lives inside useBilling already.
// ---------------------------------------------------------------------------

type Tab = 'dashboard' | 'earnings' | 'reports' | 'records';
type RecordsSection = 'records-list' | 'records-grid' | 'records-tasks' | 'records-timeoff';

// SVG path data — lifted from the iPad Rail so the iPhone shell has no icon-font
// dependency (matches the app's zero-MUI convention).
const DASHBOARD_D = 'M11 21H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h6zm2 0h6c1.1 0 2-.9 2-2v-7h-8zm8-11V5c0-1.1-.9-2-2-2h-6v7z';
const EARNINGS_D = 'M19 14V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2m-9-1c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3m13-6v11c0 1.1-.9 2-2 2H4v-2h17V7z';
const REPORTS_D = 'M4 9h4v11H4zm12 4h4v7h-4zm-6-9h4v16h-4z';
const WORKLOGS_D = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z';
const GRID_D = 'M20 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 2v3H5V5zm-5 14h-5v-9h5zM5 10h3v9H5zm12 9v-9h3v9z';
const TASKS_D = 'M22 7h-9v2h9zm0 8h-9v2h9zM5.54 11 2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41z';
const TIMEOFF_D = 'm21 19.57-1.427 1.428-6.442-6.442 1.43-1.428zM13.12 3c-2.58 0-5.16.98-7.14 2.95l-.01.01c-3.95 3.95-3.95 10.36 0 14.31l14.3-14.31C18.3 3.99 15.71 3 13.12 3M6.14 17.27C5.4 16.03 5 14.61 5 13.12c0-.93.16-1.82.46-2.67.19 1.91.89 3.79 2.07 5.44zm2.84-2.84C7.63 12.38 7.12 9.93 7.6 7.6c.58-.12 1.16-.18 1.75-.18 1.8 0 3.55.55 5.08 1.56zm1.47-8.97c.85-.3 1.74-.46 2.67-.46 1.49 0 2.91.4 4.15 1.14l-1.39 1.39c-1.65-1.18-3.52-1.88-5.43-2.07';
const SIGNOUT_D = 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4z';

function Icon({ d, size = 22 }: { d: string; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const PRIMARY_TABS: { id: Tab; label: string; d: string }[] = [
  { id: 'dashboard', label: 'Přehled', d: DASHBOARD_D },
  { id: 'earnings', label: 'Výdělky', d: EARNINGS_D },
  { id: 'reports', label: 'Reporty', d: REPORTS_D },
  { id: 'records', label: 'Záznamy', d: WORKLOGS_D },
];

const RECORDS_TABS: { id: RecordsSection; label: string; d: string }[] = [
  { id: 'records-list', label: 'Seznam', d: WORKLOGS_D },
  { id: 'records-grid', label: 'Mřížka', d: GRID_D },
  { id: 'records-tasks', label: 'Úkoly', d: TASKS_D },
  { id: 'records-timeoff', label: 'Volno', d: TIMEOFF_D },
];

const TITLES: Record<Tab | RecordsSection, string> = {
  dashboard: 'Přehled',
  earnings: 'Výdělky',
  reports: 'Reporty',
  records: 'Záznamy',
  'records-list': 'Seznam',
  'records-grid': 'Mřížka',
  'records-tasks': 'Úkoly',
  'records-timeoff': 'Volno',
};

// ---------------------------------------------------------------------------
// Shell — rendered once the user is signed in.
// ---------------------------------------------------------------------------

function Shell({ signOut }: { signOut: () => Promise<void> }): JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [recordsSection, setRecordsSection] = useState<RecordsSection>('records-list');
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  // Month the caller was viewing when drilling in — detail opens on it, not today.
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);

  const openProject = (id: number, month?: string) => { setSelectedProject(id); setSelectedMonth(month); };
  const closeProject = () => setSelectedProject(null);

  // Switching tabs always drops any project drill-down.
  const selectTab = (t: Tab) => { setTab(t); setSelectedProject(null); };
  const selectRecords = (s: RecordsSection) => { setRecordsSection(s); setSelectedProject(null); };

  const onRecords = tab === 'records';
  // The dashboard (pull-to-refresh) and the task grid (sticky header + pinned
  // footer) own their own scroll and fill the height; other views scroll in the
  // content wrapper.
  const selfScrolls = !selectedProject && (tab === 'dashboard' || (onRecords && recordsSection === 'records-grid'));

  const title = selectedProject !== null
    ? 'Projekt'
    : onRecords ? TITLES[recordsSection] : TITLES[tab];

  return (
    <div style={shellRoot}>
      {/* Compact top header — active section title + sign-out. */}
      <header style={headerBar}>
        <span style={headerTitle}>{title}</span>
        <button onClick={() => void signOut()} style={signOutBtn} aria-label="Odhlásit se">
          <Icon d={SIGNOUT_D} size={20} />
        </button>
      </header>

      {/* Records sub-nav — a top segmented control under the header (only on the
          Záznamy tab), so it's not a second bar stacked on the bottom tab bar. */}
      {onRecords && selectedProject === null && (
        <div style={segmented}>
          {RECORDS_TABS.map((r) => {
            const active = recordsSection === r.id;
            return (
              <button
                key={r.id}
                onClick={() => selectRecords(r.id)}
                style={{ ...segItem, ...(active ? segItemActive : null) }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: selfScrolls ? 'hidden' : 'auto' }}>
        {selectedProject !== null ? (
          <ProjectDetailView projectId={selectedProject} initialMonth={selectedMonth} onBack={closeProject} />
        ) : tab === 'dashboard' ? (
          <DashboardView />
        ) : tab === 'earnings' ? (
          <EarningsMonthView onOpenProject={openProject} />
        ) : tab === 'reports' ? (
          <ReportsView onOpenProject={openProject} />
        ) : recordsSection === 'records-list' ? (
          <WorklogListView />
        ) : recordsSection === 'records-grid' ? (
          <TaskGridView />
        ) : recordsSection === 'records-tasks' ? (
          <TaskListView />
        ) : (
          <TimeOffView />
        )}
      </div>

      {/* Bottom primary tab bar — floating liquid-glass pill. */}
      <nav style={tabBar}>
        {PRIMARY_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              style={{ ...tabItem, ...(active ? tabItemActive : null) }}
            >
              <Icon d={t.d} size={20} />
              <span style={{ fontSize: 10, fontWeight: 600 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App — auth gate: loading spinner → login → shell.
// ---------------------------------------------------------------------------

export function App(): JSX.Element {
  const { status, signIn, signOut } = useSupabaseAuth();

  if (status === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: text.muted, fontFamily: 'system-ui, sans-serif', fontSize: 15 }}>
        Načítání…
      </div>
    );
  }
  if (status === 'out') {
    return (
      <div style={{ height: '100%', display: 'flex' }}>
        <BillingLogin signIn={signIn} />
      </div>
    );
  }
  return <Shell signOut={signOut} />;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const shellRoot: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  backgroundColor: 'transparent',
  fontFamily: 'system-ui, sans-serif',
  color: text.primary,
};

const headerBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 16px',
  flexShrink: 0,
};

const headerTitle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: 0.2,
  color: '#c9bdff',
};

const signOutBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 38,
  height: 38,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: text.muted,
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

// Records secondary nav — a top segmented control (glass track + active pill),
// visually distinct from the bottom primary tab bar so the two never read as a
// stacked double navbar.
const segmented: CSSProperties = {
  display: 'flex',
  gap: 4,
  margin: '2px 14px 10px',
  padding: 4,
  flexShrink: 0,
  borderRadius: 13,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
};

const segItem: CSSProperties = {
  flex: 1,
  padding: '7px 4px',
  borderRadius: 9,
  border: 'none',
  background: 'transparent',
  color: text.muted,
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

const segItemActive: CSSProperties = {
  background: 'rgba(255,255,255,0.12)',
  color: accentIcon,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 3px rgba(0,0,0,0.28)',
};

// Bottom primary tab bar — a floating liquid-glass pill: rounded, translucent,
// specular top edge + drop shadow, inset from the screen edges and clearing the
// home-indicator safe area.
const tabBar: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  gap: 4,
  margin: '0 14px',
  marginBottom: 'calc(8px + env(safe-area-inset-bottom))',
  padding: 4,
  ...glassPanel({
    radius: 20,
    blur: 44,
    saturate: 2.0,
    brightness: 1.16,
    fill: 'rgba(46,50,72,0.55)',
    border: '1px solid rgba(255,255,255,0.14)',
    shadow: '0 10px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.26)',
  }),
};

const tabItem: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '5px 0',
  borderRadius: 15,
  border: 'none',
  background: 'transparent',
  color: text.dim,
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  transition: 'color 0.15s',
};

// Active tab reads as a lit glass lozenge inside the pill.
const tabItemActive: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(140,124,242,0.30), rgba(124,109,240,0.16))',
  color: '#ffffff',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.30), 0 2px 8px rgba(124,109,240,0.28)',
};
