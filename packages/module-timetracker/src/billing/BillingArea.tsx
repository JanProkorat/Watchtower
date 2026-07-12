import { useEffect, useState } from 'react';
import { useSupabaseAuth } from '@watchtower/data-supabase';
import type { BillingSection } from './types.js';
import { NotConnectedBar } from './NotConnectedBar.js';
import { LoginDialog } from './LoginDialog.js';
import { BoardView, type BoardActions } from './BoardView.js';
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
  /** iPad-only Mac-RPC actions for the Jira board (re-sync, upload). Omitted
   *  on iPhone (no bridge) — the board then renders read-only. */
  boardActions?: BoardActions;
}

export function BillingArea({ module, section, boardActions }: Props): JSX.Element {
  const { status, signIn, session } = useSupabaseAuth();
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  // Month the caller was viewing when drilling in, so the detail opens on it
  // (not on today). Undefined → detail defaults to the current month.
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);
  const [loginOpen, setLoginOpen] = useState(false);

  // Drill-down resets whenever the rail navigates to a different module/section.
  useEffect(() => { setSelectedProject(null); }, [module, section]);

  const openProject = (id: number, month?: string) => { setSelectedProject(id); setSelectedMonth(month); };

  // No auth gate: content always renders. useBilling drives its own loading and
  // returns cached/empty data with or without a session, and write-gating keys
  // off data freshness — so signed-out is automatically read-only.
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'transparent' }}>
      {status === 'out' && <NotConnectedBar onSignIn={() => setLoginOpen(true)} />}

      {/* Keyed by session identity: signing in/out remounts the active view so
          useBilling refetches (fresh when authed, cached/offline otherwise). */}
      <div
        key={session?.user?.id ?? 'anon'}
        style={{ flex: 1, overflow: module === 'dashboard' || section === 'records-grid' || section === 'board' ? 'hidden' : 'auto', minHeight: 0 }}
      >
        {selectedProject !== null ? (
          <ProjectDetailView projectId={selectedProject} initialMonth={selectedMonth} onBack={() => setSelectedProject(null)} />
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
        ) : section === 'board' ? (
          <BoardView actions={boardActions} />
        ) : (
          <TimeOffView />
        )}
      </div>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} signIn={signIn} />
    </div>
  );
}
