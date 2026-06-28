import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { buildTimeOffModel, type TimeOffKind } from '../../../state/timeOffModel.js';
import { addMonths } from '../../../lib/monthHelpers.js';
import { formatDateCz } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';
import { useDaysOffMutations } from '../../../state/useDaysOffMutations.js';
import { canEdit } from '../../../state/billingWrites.js';

const KIND_COLOR: Record<TimeOffKind, string> = { vacation: '#22D3EE', sick: '#f87171', other: '#fbbf24', holiday: '#6d5fbb' };
const KIND_LABEL: Record<TimeOffKind, string> = { vacation: 'Dovolená', sick: 'Nemoc', other: 'Jiné', holiday: 'Svátek' };
const DOW = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

export function TimeOffView(): JSX.Element {
  const { data, state, patchDaysOff } = useBilling();
  const editable = canEdit(state);
  const { setDayOff, clearDayOff, pending, error } = useDaysOffMutations({
    daysOff: data?.daysOff ?? [],
    patchDaysOff,
  });
  const [picker, setPicker] = useState<string | null>(null);
  const [focus, setFocus] = useState(() => new Date().toISOString().slice(0, 7));
  const today = new Date().toISOString().slice(0, 10);
  const model = buildTimeOffModel(focus, data?.daysOff ?? [], today);

  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={btn} onClick={() => setFocus(addMonths(focus, -1))}>‹</button>
        <button style={btn} onClick={() => setFocus(new Date().toISOString().slice(0, 7))}>Dnes</button>
        <button style={btn} onClick={() => setFocus(addMonths(focus, 1))}>›</button>
        <div style={{ flex: 1 }} />
        {(['vacation', 'sick', 'other', 'holiday'] as TimeOffKind[]).map((k) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[k] }} />{KIND_LABEL[k]}
          </span>
        ))}
        {!editable && <span style={{ fontSize: 11, color: C.muted }}>jen pro čtení offline</span>}
        {pending && <span style={{ fontSize: 11, color: C.muted }}>ukládám…</span>}
        {error && <span style={{ fontSize: 11, color: C.red }}>{error}</span>}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {model.months.map((mc) => (
          <div key={mc.month} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, minWidth: 230 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{mc.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {DOW.map((d) => <div key={d} style={{ fontSize: 10, color: C.muted, textAlign: 'center' }}>{d}</div>)}
              {mc.weeks.flat().map((c, i) => (
                <div key={i} title={c.date ? formatDateCz(c.date) : ''}
                  onClick={() => editable && c.date && setPicker(c.date)}
                  style={{
                    aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, borderRadius: 5,
                    cursor: editable && c.date ? 'pointer' : 'default',
                    // Holidays: dashed outline (transparent fill) so they read distinctly from solid
                    // user days-off and stay visible when a vacation/sick day shadows the same date.
                    color: c.date
                      ? c.kind === 'holiday'
                        ? KIND_COLOR.holiday
                        : c.kind
                          ? '#0F0F17'
                          : c.isWeekend
                            ? C.muted
                            : C.text
                      : 'transparent',
                    background: c.kind && c.kind !== 'holiday' ? KIND_COLOR[c.kind] : 'transparent',
                    border: c.kind === 'holiday' ? `1px dashed ${KIND_COLOR.holiday}` : 'none',
                    fontWeight: c.kind ? 700 : 400,
                  }}>
                  {c.date ? Number(c.date.slice(8, 10)) : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {picker && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: C.muted }}>{picker}:</span>
          {(['vacation', 'sick', 'other'] as const).map((k) => (
            <button key={k} onClick={() => { void setDayOff(picker, k); setPicker(null); }}
              style={{ background: KIND_COLOR[k], color: '#0F0F17', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <button onClick={() => { void clearDayOff(picker); setPicker(null); }}
            style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}>
            Smazat
          </button>
          <button onClick={() => setPicker(null)}
            style={{ background: 'transparent', color: C.muted, border: 'none', fontSize: 13, cursor: 'pointer' }}>
            Zrušit
          </button>
        </div>
      )}

      <div style={{ padding: '0 16px 32px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Nadcházející</div>
        {model.upcoming.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>nic nadcházejícího</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {model.upcoming.map((u) => (
              <div key={u.date} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[u.kind], flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: C.text, minWidth: 90 }}>{formatDateCz(u.date)}</span>
                <span style={{ fontSize: 12, color: C.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.note ?? KIND_LABEL[u.kind]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
