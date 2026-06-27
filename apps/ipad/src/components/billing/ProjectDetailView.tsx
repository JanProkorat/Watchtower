import { useBilling } from '../../state/useBilling.js';
import { formatCzk, formatHours, formatDateCz } from '../../lib/czFormat.js';
import { czechMonthLabel } from '../../lib/monthHelpers.js';
import {
  rollupEarningsByContract,
  activeContract,
  rateLabel,
} from '../../lib/projectDetailHelpers.js';

// ---------------------------------------------------------------------------
// Design tokens (same palette as DashboardView / EarningsMonthView)
// ---------------------------------------------------------------------------
const C = {
  ground: '#0F0F17',
  surface: '#16161F',
  border: '#2a2a3c',
  muted: '#8B88A6',
  text: '#e2e1f0',
  violet: '#A78BFA',
  violetDim: '#6d5fbb',
  violetBg: '#2d2857',
  cyan: '#22D3EE',
  green: '#34d399',
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
        color: C.muted,
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
        color: C.muted,
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
          border: `3px solid ${C.border}`,
          borderTop: `3px solid ${C.violet}`,
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
// ProjectDetailView — main export
// ---------------------------------------------------------------------------

export function ProjectDetailView({
  projectId,
  onBack,
}: {
  projectId: number;
  onBack: () => void;
}): JSX.Element {
  const { data, state } = useBilling();

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // Loading with no data
  if (state === 'loading' && data == null) {
    return (
      <div
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: C.ground,
          minHeight: '100%',
          color: C.text,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Back button always visible */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: C.ground,
            borderBottom: `1px solid ${C.border}`,
            padding: '10px 16px',
          }}
        >
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

  // Current month worklogs
  const monthWorklogs = projectWorklogs.filter((w) => w.workDate.slice(0, 7) === month);

  // Month totals
  const totalMinutes = monthWorklogs.reduce((s, w) => s + w.minutes, 0);
  const totalEarned = monthWorklogs.reduce(
    (s, w) => s + (w.rateCurrency === 'CZK' && w.earnedAmount != null ? w.earnedAmount : 0),
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
        background: C.ground,
        minHeight: '100%',
        color: C.text,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Sticky nav bar                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: C.ground,
          borderBottom: `1px solid ${C.border}`,
          padding: '10px 16px',
        }}
      >
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
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
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
              color: C.text,
              lineHeight: 1.2,
            }}
          >
            {projectName}
          </div>

          {/* Month + hours */}
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Měsíc
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
                {czechMonthLabel(month)}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
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
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
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
        {contractPeriods.length > 0 && (
          <div>
            <SectionHeader title="Historie sazeb" />
            <div
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                overflow: 'hidden',
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
                    key={`${contract.effectiveFrom}-${contract.rateAmount}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 16px',
                      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
                      background: isActive ? C.violetBg + '66' : 'transparent',
                    }}
                  >
                    {/* Active indicator */}
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: isActive ? C.violet : C.border,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    />

                    {/* Period range */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: isActive ? C.text : C.muted,
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {formatDateCz(contract.effectiveFrom)} – {periodEnd}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: isActive ? C.violet : C.muted,
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
                        color: isActive ? C.violet : C.muted,
                        textAlign: 'right',
                        flexShrink: 0,
                        ...MONO,
                      }}
                    >
                      {formatCzk(earnedCzk)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- Worklog ledger (current month) ---- */}
        <div>
          <SectionHeader title={`Výkazy — ${czechMonthLabel(month)}`} />
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
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
                borderBottom: `1px solid ${C.border}`,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.8,
                color: C.muted,
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
                  color: C.muted,
                }}
              >
                žádné výkazy v tomto měsíci
              </div>
            ) : (
              ledgerRows.map((w, i) => {
                const isLast = i === ledgerRows.length - 1;
                const earned =
                  w.rateCurrency === 'CZK' && w.earnedAmount != null
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
                      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
                      fontSize: 13,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ color: C.muted, fontSize: 12 }}>
                      {formatDateCz(w.workDate)}
                    </div>
                    <div
                      style={{
                        color: w.taskNumber != null ? C.cyan : C.muted,
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
                        color: C.text,
                        ...MONO,
                      }}
                    >
                      {formatHours(w.minutes)}
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        color: earned > 0 ? C.violet : C.muted,
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

            {/* Footer total row */}
            {ledgerRows.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 60px 1fr 1fr',
                  gap: 8,
                  padding: '10px 16px',
                  borderTop: `1px solid ${C.border}`,
                  background: C.ground,
                  fontSize: 13,
                  fontWeight: 700,
                  alignItems: 'center',
                }}
              >
                <div style={{ color: C.muted, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>
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
    </div>
  );
}
