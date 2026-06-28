// apps/ipad/src/components/billing/BillingNav.tsx
import { useState } from 'react';
import { C } from './reports/tokens.js';

export type BillingSection =
  | 'dashboard' | 'earnings' | 'reports'
  | 'records-list' | 'records-grid' | 'records-timeoff';

const STORAGE_KEY = 'watchtower.ipad.billing.nav.expanded';

interface Props {
  active: BillingSection;
  onSelect(s: BillingSection): void;
  onSignOut(): void;
}

const TOP: { id: BillingSection; label: string }[] = [
  { id: 'dashboard', label: 'Přehled' },
  { id: 'earnings', label: 'Výdělky' },
  { id: 'reports', label: 'Reporty' },
];
const RECORDS: { id: BillingSection; label: string }[] = [
  { id: 'records-list', label: 'Seznam' },
  { id: 'records-grid', label: 'Mřížka' },
  { id: 'records-timeoff', label: 'Volno' },
];

function readExpanded(): boolean {
  try { const v = localStorage.getItem(STORAGE_KEY); return v === null ? true : v === '1'; } catch { return true; }
}

function itemStyle(active: boolean, indent = false): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left',
    padding: indent ? '7px 14px 7px 28px' : '8px 14px',
    border: 'none', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif', fontSize: indent ? 13 : 14, fontWeight: 600,
    background: active ? '#2d2857' : 'transparent',
    color: active ? '#a89cf0' : '#9ca3af',
  };
}

export function BillingNav({ active, onSelect, onSignOut }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(readExpanded);
  const toggle = () => setExpanded((e) => { const n = !e; try { localStorage.setItem(STORAGE_KEY, n ? '1' : '0'); } catch { /* ignore */ } return n; });

  if (!expanded) {
    return (
      <div style={{ flexShrink: 0, width: 44, borderRight: `1px solid ${C.border}`, background: '#13141a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
        <button onClick={toggle} title="Rozbalit" style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>›</button>
      </div>
    );
  }

  return (
    <div style={{ flexShrink: 0, width: 184, borderRight: `1px solid ${C.border}`, background: '#13141a', display: 'flex', flexDirection: 'column', padding: '10px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 8px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase' }}>Fakturace</span>
        <button onClick={toggle} title="Sbalit" style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>‹</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {TOP.map((s) => (
          <button key={s.id} style={itemStyle(active === s.id)} onClick={() => onSelect(s.id)}>{s.label}</button>
        ))}
        <div style={{ ...itemStyle(false), color: C.muted, cursor: 'default', fontSize: 12 }}>Záznamy</div>
        {RECORDS.map((s) => (
          <button key={s.id} style={itemStyle(active === s.id, true)} onClick={() => onSelect(s.id)}>{s.label}</button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onSignOut} style={{ ...itemStyle(false), color: '#6b7280', fontSize: 12 }}>Odhlásit</button>
    </div>
  );
}
