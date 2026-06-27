import { useState } from 'react';
import { useSupabaseAuth } from '../../state/useSupabaseAuth.js';
import { BillingLogin } from './BillingLogin.js';
import { DashboardView } from './DashboardView.js';
import { EarningsMonthView } from './EarningsMonthView.js';
import { ProjectDetailView } from './ProjectDetailView.js';

type BillingTab = 'dashboard' | 'earnings';

const TAB_STYLE_BASE: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  letterSpacing: 0.2,
};

export function BillingModule(): JSX.Element {
  const { status, signIn, signOut } = useSupabaseAuth();
  const [activeTab, setActiveTab] = useState<BillingTab>('dashboard');
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  if (status === 'loading') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9ca3af',
          fontSize: 15,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        Načítání…
      </div>
    );
  }

  if (status === 'out') {
    return <BillingLogin signIn={signIn} />;
  }

  // status === 'in'
  if (selectedProject !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <ProjectDetailView projectId={selectedProject} onBack={() => setSelectedProject(null)} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      {/* Tab bar */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid #2e3038',
          backgroundColor: '#13141a',
        }}
      >
        <button
          style={{
            ...TAB_STYLE_BASE,
            backgroundColor: activeTab === 'dashboard' ? '#2d2857' : 'transparent',
            color: activeTab === 'dashboard' ? '#a89cf0' : '#9ca3af',
          }}
          onClick={() => { setActiveTab('dashboard'); setSelectedProject(null); }}
        >
          Přehled
        </button>
        <button
          style={{
            ...TAB_STYLE_BASE,
            backgroundColor: activeTab === 'earnings' ? '#2d2857' : 'transparent',
            color: activeTab === 'earnings' ? '#a89cf0' : '#9ca3af',
          }}
          onClick={() => { setActiveTab('earnings'); setSelectedProject(null); }}
        >
          Výdělky
        </button>

        {/* Spacer + sign-out */}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void signOut()}
          style={{
            ...TAB_STYLE_BASE,
            backgroundColor: 'transparent',
            color: '#6b7280',
            fontSize: 12,
          }}
        >
          Odhlásit
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {activeTab === 'dashboard' ? (
          <DashboardView />
        ) : (
          <EarningsMonthView onOpenProject={(id) => setSelectedProject(id)} />
        )}
      </div>
    </div>
  );
}
