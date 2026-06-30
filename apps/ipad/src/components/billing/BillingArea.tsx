import { useEffect, useState } from 'react';
import { useSupabaseAuth } from '../../state/useSupabaseAuth.js';
import type { BillingSection } from '../Rail.js';
import { glassPanel, text } from '../../theme/glass.js';
import { BillingLogin } from './BillingLogin.js';
import { DashboardView } from './DashboardView.js';
import { EarningsMonthView } from './EarningsMonthView.js';
import { ProjectDetailView } from './ProjectDetailView.js';
import { ReportsView } from './ReportsView.js';
import { WorklogListView } from './records/WorklogListView.js';
import { TaskGridView } from './records/TaskGridView.js';
import { TaskListView } from './records/TaskListView.js';
import { TimeOffView } from './records/TimeOffView.js';

// The Supabase-authed content area. Serves two top-level rail modules — Přehled
// (the global dashboard) and Fakturace (billing). Both sit behind one auth gate
// so the session is resolved once across them. The old in-module BillingNav is
// gone: navigation now lives in the main rail, which drives the `module` and
// `section` props. Sign-out moved here, into the slim content header.

interface Props {
  /** Which top-level module is active — selects dashboard vs. billing content. */
  module: 'dashboard' | 'billing';
  /** Active billing sub-route (ignored when module === 'dashboard'). */
  section: BillingSection;
}

const SECTION_TITLES: Record<'dashboard' | BillingSection, string> = {
  dashboard: 'Přehled',
  earnings: 'Výdělky',
  reports: 'Reporty',
  'records-list': 'Seznam',
  'records-grid': 'Mřížka',
  'records-tasks': 'Úkoly',
  'records-timeoff': 'Volno',
};

export function BillingArea({ module, section }: Props): JSX.Element {
  const { status, signIn, signOut } = useSupabaseAuth();
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  // Drill-down resets whenever the rail navigates to a different module/section.
  useEffect(() => { setSelectedProject(null); }, [module, section]);

  if (status === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text.muted, fontSize: 15, fontFamily: 'system-ui, sans-serif' }}>
        Načítání…
      </div>
    );
  }
  if (status === 'out') return <BillingLogin signIn={signIn} />;

  const openProject = (id: number) => setSelectedProject(id);
  const title = selectedProject !== null
    ? 'Projekt'
    : SECTION_TITLES[module === 'dashboard' ? 'dashboard' : section];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'transparent' }}>
      {/* Content header — frosted sticky bar (Liquid Glass hbar). */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          height: 46,
          padding: '0 16px',
          margin: '0 0 0 0',
          ...glassPanel({ radius: 13, blur: 28, saturate: 1.7, brightness: 1.18,
            border: '1px solid rgba(255,255,255,0.10)',
            shadow: 'inset 0 1px 0 rgba(255,255,255,0.30)' }),
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.2, color: '#f4f4f8', fontFamily: 'system-ui, sans-serif' }}>
          {title}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void signOut()}
          title="Odhlásit"
          style={{
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.06)',
            color: text.muted,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            padding: '6px 12px',
            borderRadius: 9,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Odhlásit
        </button>
      </div>

      {/* Module content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {selectedProject !== null ? (
          <ProjectDetailView projectId={selectedProject} onBack={() => setSelectedProject(null)} />
        ) : module === 'dashboard' ? (
          <DashboardView />
        ) : section === 'earnings' ? (
          <EarningsMonthView onOpenProject={openProject} />
        ) : section === 'reports' ? (
          <ReportsView onOpenProject={openProject} />
        ) : section === 'records-list' ? (
          <WorklogListView />
        ) : section === 'records-grid' ? (
          <TaskGridView />
        ) : section === 'records-tasks' ? (
          <TaskListView />
        ) : (
          <TimeOffView />
        )}
      </div>
    </div>
  );
}
