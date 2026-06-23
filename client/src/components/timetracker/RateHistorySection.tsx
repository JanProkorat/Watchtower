import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useContracts } from '../../state/useContracts.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import { ContractDrawer } from './ContractDrawer.js';
import { formatDateAbbrCz, formatDateCz } from '../../util/format.js';
import type { ContractViewPayload, DayOffViewPayload } from '@watchtower/shared/ipcContract.js';

interface Props {
  projectId: number;
}

const CZK_FORMATTER = new Intl.NumberFormat('cs-CZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatRate(c: ContractViewPayload): string {
  const amount = CZK_FORMATTER.format(c.rateAmount);
  const unit = c.rateType === 'hourly' ? '/ hr' : '/ MD';
  return `${amount} ${c.currency} ${unit}`;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '0 h';
  return `${(minutes / 60).toFixed(2)} h`;
}

function formatMd(value: number): string {
  return `${value.toFixed(1)} MD`;
}

function computeEarnings(c: ContractViewPayload): number {
  const hours = c.minutesLogged / 60;
  return c.rateType === 'hourly' ? hours * c.rateAmount : (hours / c.hoursPerDay) * c.rateAmount;
}

function formatEarningsCzk(amount: number, currency: string): string {
  return `${CZK_FORMATTER.format(amount)} ${currency}`;
}

/**
 * Collapsible "Rate history" card on the project detail pane, mirroring
 * the TimeTracker reference design:
 *   - title row with "+ Add rate change" and expand chevron
 *   - subtitle with the earliest effective date
 *   - **active-contract progress card** (only for the in-flight period):
 *       MD used / MD limit, progress bar, MD left, projected at end,
 *       and three stats (expected workdays, days off booked, contract ends)
 *   - one row per rate period: date range, rate, optional MD limit, total
 *     hours + earnings, and an inline edit pencil
 */
export function RateHistorySection({ projectId }: Props) {
  const state = useContracts(projectId);
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ContractViewPayload | null>(null);

  const sorted = useMemo(
    () =>
      [...state.contracts].sort((a, b) =>
        a.effectiveFrom < b.effectiveFrom ? 1 : -1,
      ),
    [state.contracts],
  );
  const earliest = sorted[sorted.length - 1];
  const active = sorted.find((c) => c.isActive) ?? null;

  // Days off booked between today and the active contract's end. Skipped
  // entirely when there's no active contract or no end date.
  const [bookedDaysOff, setBookedDaysOff] = useState<DayOffViewPayload[]>([]);
  useEffect(() => {
    if (!active || !active.endDate) {
      setBookedDaysOff([]);
      return;
    }
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    void window.watchtower
      .invoke('daysOff:listInRange', { from: today, to: active.endDate })
      .then((res) => {
        if (!cancelled) setBookedDaysOff(res.daysOff);
      })
      .catch(() => {
        if (!cancelled) setBookedDaysOff([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.endDate]);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (c: ContractViewPayload) => {
    setEditing(c);
    setDrawerOpen(true);
  };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2.5, py: 1.75, cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          Rate history
        </Typography>
        <Button
          size="small"
          startIcon={<AddIcon fontSize="small" />}
          onClick={(e) => {
            e.stopPropagation();
            openCreate();
          }}
          sx={{ textTransform: 'none', color: 'primary.light' }}
        >
          Add rate change
        </Button>
        {open ? (
          <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        ) : (
          <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        )}
      </Stack>

      {active && (
        <Box sx={{ px: 2.5, pb: open ? 0 : 2.5 }}>
          <ActiveContractCard contract={active} bookedDaysOff={bookedDaysOff.length} />
        </Box>
      )}

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.5, pb: 2.5, pt: active ? 2 : 0 }}>
          {state.error && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {state.error}
            </Alert>
          )}
          {earliest && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
              Earliest rate effective {formatDateCz(earliest.effectiveFrom)}. Worklogs before this
              date contribute hours but no earnings.
            </Typography>
          )}

          {!state.loading && sorted.length === 0 && (
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', fontStyle: 'italic' }}
            >
              No rate periods yet — add one to start tracking earnings.
            </Typography>
          )}

          <Stack spacing={1}>
            {sorted.map((c) => (
              <RateRow key={c.id} contract={c} onEdit={() => openEdit(c)} />
            ))}
          </Stack>
        </Box>
      </Collapse>

      <ContractDrawer
        open={drawerOpen}
        contract={editing}
        projectId={projectId}
        onClose={() => setDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editing) return state.update(editing.id, input);
          return state.create(input);
        }}
        onDelete={
          editing
            ? async () => {
                try {
                  await state.remove(editing.id);
                } catch (err) {
                  showError(toastMessage(err));
                }
              }
            : undefined
        }
      />
    </Box>
  );
}

function ActiveContractCard({
  contract,
  bookedDaysOff,
}: {
  contract: ContractViewPayload;
  bookedDaysOff: number;
}) {
  const hasLimit = contract.mdLimit !== null && contract.mdLimit > 0;
  const used = contract.mdsUsed;
  const limit = contract.mdLimit ?? null;
  const remaining = contract.mdsRemaining ?? null;
  const projected = contract.projectedTotalMds;
  const expectedWorkdays = contract.workdaysRemaining ?? 0;
  const totalWeekdays = expectedWorkdays + bookedDaysOff;
  const percent =
    hasLimit && limit !== null && limit > 0
      ? Math.min(100, (used / limit) * 100)
      : 0;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      {hasLimit && (
        <>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMd(used)} / {formatMd(limit!)} used
            </Typography>
            {remaining !== null && (
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatMd(remaining)} left
              </Typography>
            )}
          </Stack>
          <LinearProgress
            variant="determinate"
            value={percent}
            sx={{
              height: 8,
              borderRadius: 999,
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                bgcolor: percent >= 100 ? 'error.main' : 'success.main',
                borderRadius: 999,
              },
            }}
          />
          {projected !== null && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
              Projected{' '}
              <Box
                component="span"
                sx={{ color: 'success.light', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              >
                {projected.toFixed(1)} MD
              </Box>{' '}
              at end
            </Typography>
          )}
        </>
      )}

      <Stack direction="row" spacing={4} sx={{ mt: hasLimit ? 1.5 : 0 }}>
        <StatBlock
          label="Expected workdays"
          value={String(expectedWorkdays)}
          hint={`${totalWeekdays} weekday${totalWeekdays === 1 ? '' : 's'} – ${bookedDaysOff} off`}
        />
        <StatBlock label="Days off booked" value={String(bookedDaysOff)} />
        <StatBlock label="Contract ends" value={formatDateCz(contract.endDate)} />
      </Stack>
    </Box>
  );
}

function StatBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value || '—'}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

function RateRow({
  contract,
  onEdit,
}: {
  contract: ContractViewPayload;
  onEdit(): void;
}) {
  const earnings = computeEarnings(contract);
  const unitHint =
    contract.rateType === 'daily'
      ? `${contract.hoursPerDay} hrs / man-day`
      : `${contract.hoursPerDay} hrs / day`;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(170px, 1.2fr) minmax(160px, 1fr) minmax(80px, auto) minmax(120px, 1fr) auto',
        gap: 2,
        alignItems: 'center',
        px: 2,
        py: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.default',
      }}
    >
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {formatDateAbbrCz(contract.effectiveFrom)} → {formatDateAbbrCz(contract.endDate)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Period
        </Typography>
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatRate(contract)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {unitHint}
        </Typography>
      </Box>
      {contract.mdLimit !== null && contract.mdLimit > 0 ? (
        <Box>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {contract.mdLimit} MD
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            limit
          </Typography>
        </Box>
      ) : (
        <Box />
      )}
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatHours(contract.minutesLogged)}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: contract.minutesLogged > 0 ? 'success.light' : 'text.disabled',
            fontVariantNumeric: 'tabular-nums',
            display: 'block',
          }}
        >
          {contract.minutesLogged > 0 ? formatEarningsCzk(earnings, contract.currency) : '—'}
        </Typography>
      </Box>
      <Tooltip title="Edit rate period">
        <IconButton size="small" onClick={onEdit}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
