import { useEffect, useState } from 'react';
import { useSupabaseAuth } from '../../state/useSupabaseAuth.js';
import type { BillingSection } from '../Rail.js';
import { text } from '@watchtower/ui-core';
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
// `section` props. The section name shows in the rail; sign-out lives in the
// Settings module — so this area has no content header of its own.

interface Props {
  /** Which top-level module is active — selects dashboard vs. billing content. */
  module: 'dashboard' | 'billing';
  /** Active billing sub-route (ignored when module === 'dashboard'). */
  section: BillingSection;
}

export function BillingArea({ module, section }: Props): JSX.Element {
  const { status, signIn } = useSupabaseAuth();
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'transparent' }}>
      {/* Module content. The dashboard (pull-to-refresh) and the task grid
          (sticky header + pinned footer) own their own scroll and fill the
          height, so we don't double-scroll those here; other sections scroll
          in this wrapper. */}
      <div style={{ flex: 1, overflow: module === 'dashboard' || section === 'records-grid' ? 'hidden' : 'auto', minHeight: 0 }}>
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
