import { useState } from 'react';
import { useSupabaseAuth } from '../../state/useSupabaseAuth.js';
import { BillingLogin } from './BillingLogin.js';
import { DashboardView } from './DashboardView.js';
import { EarningsMonthView } from './EarningsMonthView.js';
import { ProjectDetailView } from './ProjectDetailView.js';
import { ReportsView } from './ReportsView.js';
import { BillingNav, type BillingSection } from './BillingNav.js';
import { WorklogListView } from './records/WorklogListView.js';
import { TaskGridView } from './records/TaskGridView.js';
import { TimeOffView } from './records/TimeOffView.js';

export function BillingModule(): JSX.Element {
  const { status, signIn, signOut } = useSupabaseAuth();
  const [section, setSection] = useState<BillingSection>('dashboard');
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  if (status === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 15, fontFamily: 'system-ui, sans-serif' }}>
        Načítání…
      </div>
    );
  }
  if (status === 'out') return <BillingLogin signIn={signIn} />;

  if (selectedProject !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <ProjectDetailView projectId={selectedProject} onBack={() => setSelectedProject(null)} />
      </div>
    );
  }

  const openProject = (id: number) => setSelectedProject(id);
  const select = (s: BillingSection) => { setSection(s); setSelectedProject(null); };

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <BillingNav active={section} onSelect={select} onSignOut={() => void signOut()} />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {section === 'dashboard' && <DashboardView />}
        {section === 'earnings' && <EarningsMonthView onOpenProject={openProject} />}
        {section === 'reports' && <ReportsView onOpenProject={openProject} />}
        {section === 'records-list' && <WorklogListView />}
        {section === 'records-grid' && <TaskGridView />}
        {section === 'records-timeoff' && <TimeOffView />}
      </div>
    </div>
  );
}
