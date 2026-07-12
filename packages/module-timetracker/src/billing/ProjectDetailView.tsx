import { useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { formatCzk, formatHours, formatDateCz } from '@watchtower/ui-core';
import { czechMonthLabel, addMonths } from '@watchtower/ui-core';
import {
  rollupEarningsByContract,
  activeContract,
  rateLabel,
} from '@watchtower/ui-core';
import { useContractMutations } from '@watchtower/data-supabase';
import { canEdit, type ContractWriteInput } from '@watchtower/data-supabase';
import type { ContractRow } from '@watchtower/shared/billing/types.js';
import {
  BottomSheet,
  glassCard,
  dataPanelFill,
  text as glassText,
  accentWash,
  accent,
  ctaGradient,
  ctaGlow,
  anchorFromEvent,
  type SheetAnchor,
} from '@watchtower/ui-core';

// ---------------------------------------------------------------------------
// Design tokens (same palette as DashboardView / EarningsMonthView)
// ---------------------------------------------------------------------------
const C = {
  ground: '#0F0F17',
  surface: '#16161F',
  border: '#2a2a3c',
  muted: '#8B88A6',
  text: '#e2e1f0',
  violet: '#38bdf8',
  violetDim: '#3d7fb0',
  violetBg: '#12314a',
  cyan: '#22D3EE',
  green: '#34d399',
  red: '#f87171',
} as const;

const MONO: React.CSSProperties = {
  fontFamily: "'SF Mono', 'Fira Mono', 'Menlo', monospace",
};

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.8,
        color: glassText.muted,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}
    >
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading spinner
// ---------------------------------------------------------------------------

function Spinner(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: glassText.muted,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 15,
        padding: 32,
        minHeight: 200,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid rgba(255,255,255,0.10)',
          borderTop: `3px solid ${accent}`,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      Načítání…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Glass field style — shared by ContractDrawer inputs
// ---------------------------------------------------------------------------

const glassField: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  color: glassText.primary,
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 14,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

// Compact prev/next stepper button for the detail's month navigation.
const monthStepBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#bae6fd',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// Distinct member-project count for a shared-contract group (used by the
// "Sdílená smlouva · N projektů" badge on grouped rows).
function sharedMemberCount(contracts: ContractRow[], groupId: string): number {
  const ids = new Set<number>();
  for (const c of contracts) {
    if (c.contractGroupId === groupId) ids.add(c.projectId);
  }
  return ids.size;
}

// ---------------------------------------------------------------------------
// ContractDrawer — bottom-sheet for add / edit / delete
// ---------------------------------------------------------------------------

function ContractDrawer({ title, projectId, initial, anchor, sharableProjects, initialSharedProjectIds, onClose, onSubmit, onDelete }: {
  title: string;
  projectId: number;
  initial?: ContractRow;
  anchor?: SheetAnchor | null;
  /** Other work-kind, non-archived projects eligible to share this contract with (excludes projectId). */
  sharableProjects: { id: number; name: string }[];
  /** Pre-populated membership when editing a grouped contract (excludes projectId). */
  initialSharedProjectIds?: number[];
  onClose(): void;
  onSubmit(input: ContractWriteInput, projectIds: number[]): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [rateType, setRateType] = useState<'hourly' | 'daily'>(initial?.rateType ?? 'hourly');
  const [rateAmount, setRateAmount] = useState(initial ? String(initial.rateAmount) : '');
  const [hoursPerDay, setHoursPerDay] = useState(initial ? String(initial.hoursPerDay) : '8');
  const [mdLimit, setMdLimit] = useState(initial?.mdLimit != null ? String(initial.mdLimit) : '');
  const [sharedProjectIds, setSharedProjectIds] = useState<number[]>(initialSharedProjectIds ?? []);
  const [saving, setSaving] = useState(false);
  // Phone width: stack the paired input rows (dates, rate+hours) vertically —
  // two side-by-side native iOS date pickers don't fit ~170px each.
  const pairRow = { display: 'flex', gap: 10, flexDirection: 'column' as const };

  const rate = Number(rateAmount.replace(',', '.'));
  const hpd = Number(hoursPerDay.replace(',', '.'));
  const md = mdLimit.trim() === '' ? null : Number(mdLimit.replace(',', '.'));
  const valid =
    effectiveFrom !== '' &&
    Number.isFinite(rate) && rate >= 0 &&
    Number.isFinite(hpd) && hpd > 0 &&
    (md === null || (Number.isFinite(md) && md >= 0));
  const canSubmit = valid && !saving;

  const labelStyle: React.CSSProperties = { fontSize: 12, color: glassText.muted, marginBottom: 4 };

  async function submit() {
    setSaving(true);
    try {
      // Distinct ids, current project always first — sharedProjectIds only
      // ever comes from sharableProjects (which already excludes projectId),
      // but de-dupe defensively.
      const projectIds = [projectId, ...new Set(sharedProjectIds.filter((id) => id !== projectId))];
      await onSubmit(
        {
          projectId,
          effectiveFrom,
          endDate: endDate.trim() === '' ? null : endDate,
          rateType,
          rateAmount: rate,
          hoursPerDay: hpd,
          mdLimit: md,
        },
        projectIds,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose} anchor={anchor}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: glassText.primary }}>{title}</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: glassText.muted, fontSize: 20, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Date range */}
        <div style={pairRow}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Platné od</div>
            <input type="date" style={glassField} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Platné do (volitelné)</div>
            <input type="date" style={glassField} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {/* Rate type — translucent segmented control */}
        <div>
          <div style={labelStyle}>Typ sazby</div>
          <div
            style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {(['hourly', 'daily'] as const).map((rt) => {
              const isActive = rateType === rt;
              return (
                <button
                  key={rt}
                  type="button"
                  onClick={() => setRateType(rt)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    background: isActive ? accentWash : 'transparent',
                    color: isActive ? C.violet : glassText.muted,
                    border: 'none',
                    borderRight: rt === 'hourly' ? '1px solid rgba(255,255,255,0.10)' : 'none',
                    cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                    transition: 'background 0.15s',
                  }}
                >
                  {rt === 'hourly' ? 'Hodinová' : 'Denní'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rate + hours per day */}
        <div style={pairRow}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Sazba</div>
            <input style={glassField} inputMode="decimal" value={rateAmount} onChange={(e) => setRateAmount(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Hodin/den</div>
            <input style={glassField} inputMode="decimal" value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
          </div>
        </div>

        {/* MD limit */}
        <div>
          <div style={labelStyle}>MD limit (volitelné)</div>
          <input style={glassField} inputMode="decimal" value={mdLimit} onChange={(e) => setMdLimit(e.target.value)} />
        </div>

        {/* Sdíleno s projekty — checkbox list of other work projects this
            contract's terms should also apply to (shared-contract group). */}
        {sharableProjects.length > 0 && (
          <div>
            <div style={labelStyle}>Sdíleno s projekty (volitelné)</div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 160,
                overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 8,
                padding: 8,
              }}
            >
              {sharableProjects.map((p) => {
                const checked = sharedProjectIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: glassText.primary, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSharedProjectIds((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {onDelete && (
            <button
              type="button"
              onClick={async () => { setSaving(true); try { await onDelete!(); } finally { setSaving(false); } }}
              disabled={saving}
              style={{
                ...glassField,
                width: 'auto',
                color: C.red,
                cursor: 'pointer',
                background: 'rgba(248,113,113,0.12)',
                border: '1px solid rgba(248,113,113,0.25)',
              }}
            >
              Smazat
            </button>
          )}
          <div style={{ flex: 1 }} />
          {/* Zrušit — glass field style */}
          <button
            type="button"
            onClick={onClose}
            style={{ ...glassField, width: 'auto', cursor: 'pointer' }}
          >
            Zrušit
          </button>
          {/* Uložit — CTA gradient */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              ...glassField,
              width: 'auto',
              background: canSubmit ? ctaGradient : 'rgba(255,255,255,0.07)',
              boxShadow: canSubmit ? ctaGlow : 'none',
              color: '#fff',
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'default',
              fontWeight: 600,
            }}
          >
            {saving ? 'Ukládám…' : 'Uložit'}
          </button>
        </div>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// ProjectDetailView — main export
// ---------------------------------------------------------------------------

export function ProjectDetailView({
  projectId,
  onBack,
  initialMonth,
}: {
  projectId: number;
  onBack: () => void;
  /** Month (YYYY-MM) the caller was viewing — the detail opens on it, not today. */
  initialMonth?: string;
}): JSX.Element {
  const { data, state, patchContracts, patchWorklogs } = useBilling();

  const today = new Date().toISOString().slice(0, 10);
  // Open on the caller's month; navigable within the detail via the stepper.
  const [month, setMonth] = useState(initialMonth ?? today.slice(0, 7));

  // Editing is only allowed when dataset is fresh (live).
  const editable = canEdit(state);

  // All worklogs and contracts (needed by the mutations hook even during loading).
  const allWorklogsAll = data?.worklogs ?? [];
  const allContractsAll = data?.contracts ?? [];

  const { createContract, updateContract, deleteContract, error: contractError } =
    useContractMutations({ contracts: allContractsAll, worklogs: allWorklogsAll, patchContracts, patchWorklogs });

  const [drawer, setDrawer] = useState<{ mode: 'closed' } | { mode: 'create'; anchor: SheetAnchor | null } | { mode: 'edit'; contract: ContractRow; anchor: SheetAnchor | null }>({ mode: 'closed' });

  // Nav bar glass style — floating glass card
  const navBarStyle: React.CSSProperties = {
    position: 'sticky',
    top: 12,
    zIndex: 10,
    margin: '12px 16px',
    padding: '10px 16px',
    ...glassCard(16),
  };

  // Loading with no data
  if (state === 'loading' && data == null) {
    return (
      <div
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: 'transparent',
          minHeight: '100%',
          color: glassText.primary,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Back button always visible */}
        <div style={navBarStyle}>
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: C.violet,
              fontSize: 16,
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ‹ Výdělky
          </button>
        </div>
        <Spinner />
      </div>
    );
  }

  // Derived data
  const allWorklogs = data?.worklogs ?? [];
  const allContracts = data?.contracts ?? [];
  const allProjects = data?.projects ?? [];

  // Filter to this project
  const projectWorklogs = allWorklogs.filter((w) => w.projectId === projectId);
  const projectContracts = allContracts.filter((c) => c.projectId === projectId);

  // Project name — prefer projects table, fall back to a worklog row
  const projectRow = allProjects.find((p) => p.id === projectId);
  const projectName =
    projectRow?.name ??
    projectWorklogs[0]?.projectName ??
    `Projekt ${projectId}`;

  // Other work-kind projects eligible to share a contract with — excludes
  // the current project (the drawer adds it back implicitly) and non-`work`
  // kinds (time-off projects can't bill). `allProjects` already excludes
  // soft-deleted rows (see useBilling's `deleted_at is null` filter).
  const sharableProjects = allProjects
    .filter((p) => p.kind === 'work' && p.id !== projectId)
    .map((p) => ({ id: p.id, name: p.name }));

  // Current month worklogs
  const monthWorklogs = projectWorklogs.filter((w) => w.workDate.slice(0, 7) === month);

  // Month totals
  const totalMinutes = monthWorklogs.reduce((s, w) => s + w.minutes, 0);
  const totalEarned = monthWorklogs.reduce(
    (s, w) => s + (w.earnedAmount != null ? w.earnedAmount : 0),
    0,
  );

  // Active contract
  const active = activeContract(projectContracts, today);

  // Rate history (sorted desc by effectiveFrom, with earnings rollup)
  const contractPeriods = rollupEarningsByContract(projectWorklogs, projectContracts);

  // Worklog ledger — current month, sorted by workDate desc
  const ledgerRows = [...monthWorklogs].sort((a, b) =>
    a.workDate < b.workDate ? 1 : -1,
  );

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: 'transparent',
        minHeight: '100%',
        color: glassText.primary,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Sticky nav bar — frosted glass                                        */}
      {/* ------------------------------------------------------------------ */}
      <div style={navBarStyle}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: C.violet,
            fontSize: 16,
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ‹ Výdělky
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Body                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          padding: '16px 16px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* ---- Project header card ---- */}
        <div
          style={{
            ...glassCard(),
            padding: '20px 20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Project name */}
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: glassText.primary,
              lineHeight: 1.2,
            }}
          >
            {projectName}
          </div>

          {/* Mini stat blocks — wrap on phone width so the mono rate label can't
              clip; no-op on iPad (they always fit there). */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: glassText.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Měsíc
              </div>
              {/* Navigable month stepper — the detail's totals/ledger follow it. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setMonth(addMonths(month, -1))}
                  aria-label="Předchozí měsíc"
                  style={monthStepBtn}
                >‹</button>
                <div style={{ fontSize: 16, fontWeight: 600, color: glassText.primary, minWidth: 120, textAlign: 'center' }}>
                  {czechMonthLabel(month)}
                </div>
                <button
                  onClick={() => setMonth(addMonths(month, 1))}
                  aria-label="Další měsíc"
                  style={monthStepBtn}
                >›</button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: glassText.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Hodiny
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.cyan,
                  ...MONO,
                }}
              >
                {formatHours(totalMinutes)}
              </div>
            </div>

            {active != null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: glassText.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Sazba
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: C.violet,
                    ...MONO,
                  }}
                >
                  {rateLabel(active)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- Rate history table ---- */}
        <div>
          {/* Section header row: title + optional "+ Přidat sazbu" button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                color: glassText.muted,
                textTransform: 'uppercase',
              }}
            >
              Historie sazeb
            </div>
            {editable && (
              <button
                type="button"
                onClick={(e) => setDrawer({ mode: 'create', anchor: anchorFromEvent(e) })}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.violet,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: '2px 0',
                }}
              >
                + Přidat sazbu
              </button>
            )}
          </div>

          {/* Overlap / mutation error */}
          {contractError && (
            <div style={{ color: C.red, fontSize: 12, padding: '4px 0', marginBottom: 4 }}>
              {contractError}
            </div>
          )}

          {contractPeriods.length === 0 ? (
            <div
              style={{
                ...glassCard(12),
                padding: '24px 16px',
                textAlign: 'center',
                fontSize: 13,
                color: glassText.muted,
              }}
            >
              žádné sazby
            </div>
          ) : (
            <div
              style={{
                ...glassCard(12),
                overflow: 'hidden',
                padding: 0,
              }}
            >
              {contractPeriods.map(({ contract, earnedCzk }, idx) => {
                const isActive = contract === active;
                const isLast = idx === contractPeriods.length - 1;
                const periodEnd = contract.endDate
                  ? formatDateCz(contract.endDate)
                  : 'nyní';

                return (
                  <div
                    key={contract.syncId}
                    onClick={(e) => editable && setDrawer({ mode: 'edit', contract, anchor: anchorFromEvent(e) })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 16px',
                      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.10)',
                      background: isActive ? accentWash : 'transparent',
                      cursor: editable ? 'pointer' : 'default',
                    }}
                  >
                    {/* Active indicator */}
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: isActive ? C.violet : 'rgba(255,255,255,0.20)',
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    />

                    {/* Period range */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {contract.contractGroupId != null && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: 0.3,
                            textTransform: 'uppercase',
                            color: C.violetDim,
                            marginBottom: 2,
                          }}
                        >
                          Sdílená smlouva · {sharedMemberCount(allContracts, contract.contractGroupId)} projektů
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 12,
                          color: isActive ? glassText.primary : glassText.muted,
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {formatDateCz(contract.effectiveFrom)} – {periodEnd}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: isActive ? C.violet : glassText.muted,
                          ...MONO,
                          marginTop: 2,
                        }}
                      >
                        {rateLabel(contract)}
                      </div>
                    </div>

                    {/* Summed CZK earned in this window */}
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: isActive ? C.violet : glassText.muted,
                        textAlign: 'right',
                        flexShrink: 0,
                        ...MONO,
                      }}
                    >
                      {formatCzk(earnedCzk)}
                    </div>

                    {/* Edit chevron hint when editable */}
                    {editable && (
                      <div style={{ color: glassText.muted, fontSize: 14, flexShrink: 0 }}>›</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- Worklog ledger (current month) ---- */}
        <div>
          <SectionHeader title={`Výkazy — ${czechMonthLabel(month)}`} />
          {/* Dense data panel — near-solid, no frost so numbers stay crisp */}
          <div
            style={{
              background: dataPanelFill,
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 60px 1fr 1fr',
                gap: 8,
                padding: '8px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.10)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.8,
                color: glassText.muted,
                textTransform: 'uppercase',
              }}
            >
              <div>Datum</div>
              <div>Úkol</div>
              <div style={{ textAlign: 'right' }}>Hodiny</div>
              <div style={{ textAlign: 'right' }}>Výdělek</div>
            </div>

            {/* Rows */}
            {ledgerRows.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: glassText.muted,
                }}
              >
                žádné výkazy v tomto měsíci
              </div>
            ) : (
              ledgerRows.map((w, i) => {
                const isLast = i === ledgerRows.length - 1;
                const earned =
                  w.earnedAmount != null
                    ? w.earnedAmount
                    : 0;
                return (
                  <div
                    key={w.syncId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px 60px 1fr 1fr',
                      gap: 8,
                      padding: '10px 16px',
                      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.10)',
                      fontSize: 13,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ color: glassText.muted, fontSize: 12 }}>
                      {formatDateCz(w.workDate)}
                    </div>
                    <div
                      style={{
                        color: w.taskNumber != null ? C.cyan : glassText.muted,
                        ...MONO,
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={w.taskTitle ?? undefined}
                    >
                      {w.taskNumber ?? '—'}
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        color: glassText.primary,
                        ...MONO,
                      }}
                    >
                      {formatHours(w.minutes)}
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        color: earned > 0 ? C.violet : glassText.muted,
                        fontWeight: earned > 0 ? 600 : 400,
                        ...MONO,
                      }}
                    >
                      {formatCzk(earned)}
                    </div>
                  </div>
                );
              })
            )}

            {/* Footer total row — emphasized */}
            {ledgerRows.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 60px 1fr 1fr',
                  gap: 8,
                  padding: '10px 16px',
                  borderTop: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(56,189,248,0.08)',
                  fontSize: 13,
                  fontWeight: 700,
                  alignItems: 'center',
                }}
              >
                <div style={{ color: glassText.muted, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Celkem
                </div>
                <div />
                <div
                  style={{
                    textAlign: 'right',
                    color: C.cyan,
                    ...MONO,
                  }}
                >
                  {formatHours(totalMinutes)}
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    color: C.violet,
                    ...MONO,
                  }}
                >
                  {formatCzk(totalEarned)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Contract drawers                                                      */}
      {/* ------------------------------------------------------------------ */}
      {drawer.mode === 'create' && (
        <ContractDrawer
          title="Nová sazba"
          projectId={projectId}
          sharableProjects={sharableProjects}
          anchor={drawer.anchor}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input, projectIds) => { await createContract(input, projectIds); setDrawer({ mode: 'closed' }); }}
        />
      )}
      {drawer.mode === 'edit' && (
        <ContractDrawer
          title="Upravit sazbu"
          projectId={projectId}
          initial={drawer.contract}
          sharableProjects={sharableProjects}
          initialSharedProjectIds={
            drawer.contract.contractGroupId != null
              ? [
                  ...new Set(
                    allContracts
                      .filter((c) => c.contractGroupId === drawer.contract.contractGroupId)
                      .map((c) => c.projectId),
                  ),
                ].filter((id) => id !== projectId)
              : []
          }
          anchor={drawer.anchor}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input, projectIds) => { await updateContract(drawer.contract.syncId, input, projectIds); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteContract(drawer.contract.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}
