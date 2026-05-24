import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import type {
  ContractInputPayload,
  ContractViewPayload,
} from '../../../../shared/ipcContract.js';
import { CZ_DATE_FORMAT } from '../../util/format.js';

interface OverlapInfo {
  conflictingId: number;
  conflictingFrom: string;
  conflictingTo: string | null;
}

interface Props {
  open: boolean;
  contract: ContractViewPayload | null;
  projectId: number;
  onClose(): void;
  /**
   * Returns the saved contract on success or OverlapInfo when the range
   * intersects an existing contract — the drawer renders an inline error
   * and stays open in that case.
   */
  onSubmit(input: ContractInputPayload): Promise<ContractViewPayload | OverlapInfo>;
  onDelete?(): Promise<void>;
}

interface Draft {
  effectiveFrom: string;
  endDate: string;
  rateType: 'hourly' | 'daily';
  rateAmount: string;
  currency: string;
  hoursPerDay: string;
  mdLimit: string;
}

function todayStr(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function emptyDraft(): Draft {
  return {
    effectiveFrom: todayStr(),
    endDate: '',
    rateType: 'hourly',
    rateAmount: '',
    currency: 'CZK',
    hoursPerDay: '8',
    mdLimit: '',
  };
}

function draftOf(c: ContractViewPayload): Draft {
  return {
    effectiveFrom: c.effectiveFrom,
    endDate: c.endDate ?? '',
    rateType: c.rateType,
    rateAmount: c.rateAmount.toString(),
    currency: c.currency,
    hoursPerDay: c.hoursPerDay.toString(),
    mdLimit: c.mdLimit != null ? c.mdLimit.toString() : '',
  };
}

function isOverlapResult(r: unknown): r is OverlapInfo {
  return typeof r === 'object' && r != null && 'conflictingId' in r;
}

export function ContractDrawer({ open, contract, projectId, onClose, onSubmit, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(contract ? draftOf(contract) : emptyDraft());
      setError(null);
      setSubmitting(false);
    }
  }, [open, contract]);

  const isEdit = contract !== null;
  const rateAmountNum = Number(draft.rateAmount);
  const hoursPerDayNum = Number(draft.hoursPerDay);
  const canSubmit =
    !submitting &&
    draft.effectiveFrom.length === 10 &&
    (draft.endDate === '' || draft.endDate.length === 10) &&
    (draft.endDate === '' || draft.endDate >= draft.effectiveFrom) &&
    Number.isFinite(rateAmountNum) &&
    rateAmountNum >= 0 &&
    Number.isFinite(hoursPerDayNum) &&
    hoursPerDayNum > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const mdLimitNum = Number(draft.mdLimit);
      const mdLimit =
        draft.mdLimit.trim() && Number.isFinite(mdLimitNum) && mdLimitNum > 0
          ? mdLimitNum
          : null;
      const input: ContractInputPayload = {
        projectId,
        effectiveFrom: draft.effectiveFrom,
        rateType: draft.rateType,
        rateAmount: rateAmountNum,
        currency: draft.currency.trim().toUpperCase(),
        hoursPerDay: hoursPerDayNum,
        endDate: draft.endDate || null,
        mdLimit,
      };
      const result = await onSubmit(input);
      if (isOverlapResult(result)) {
        setError(
          `Date range overlaps with contract #${result.conflictingId} (${result.conflictingFrom} → ${
            result.conflictingTo ?? 'ongoing'
          }). Contracts on the same project must not overlap.`,
        );
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 480 } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 500, flex: 1 }}>
            {isEdit ? 'Edit contract' : 'New contract'}
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 2.5,
            py: 2.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={2}>
            <DatePicker
              label="Effective from"
              value={dayjs(draft.effectiveFrom)}
              onChange={(v: Dayjs | null) =>
                v && setDraft({ ...draft, effectiveFrom: v.format('YYYY-MM-DD') })
              }
              format={CZ_DATE_FORMAT}
              slotProps={{
                textField: { size: 'small', required: true, sx: { flex: 1 } },
              }}
            />
            <DatePicker
              label="End date"
              value={draft.endDate ? dayjs(draft.endDate) : null}
              onChange={(v: Dayjs | null) =>
                setDraft({ ...draft, endDate: v ? v.format('YYYY-MM-DD') : '' })
              }
              format={CZ_DATE_FORMAT}
              slotProps={{
                textField: {
                  size: 'small',
                  sx: { flex: 1 },
                  helperText: 'Leave empty for open-ended',
                },
                field: { clearable: true },
              }}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Rate type"
              size="small"
              value={draft.rateType}
              onChange={(e) =>
                setDraft({ ...draft, rateType: e.target.value as 'hourly' | 'daily' })
              }
              sx={{ flex: 1 }}
            >
              <MenuItem value="hourly">Hourly</MenuItem>
              <MenuItem value="daily">Daily (MD)</MenuItem>
            </TextField>
            <TextField
              select
              label="Currency"
              size="small"
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              sx={{ flex: 1 }}
            >
              <MenuItem value="CZK">CZK</MenuItem>
              <MenuItem value="EUR">EUR</MenuItem>
              <MenuItem value="USD">USD</MenuItem>
            </TextField>
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              label="Rate amount"
              type="number"
              size="small"
              value={draft.rateAmount}
              onChange={(e) => setDraft({ ...draft, rateAmount: e.target.value })}
              inputProps={{ min: 0, step: 1 }}
              required
              sx={{ flex: 1 }}
              helperText={
                draft.rateType === 'hourly' ? `${draft.currency} per hour` : `${draft.currency} per MD`
              }
            />
            <TextField
              label="Hours per day"
              type="number"
              size="small"
              value={draft.hoursPerDay}
              onChange={(e) => setDraft({ ...draft, hoursPerDay: e.target.value })}
              inputProps={{ min: 0.5, step: 0.5 }}
              required
              sx={{ flex: 1 }}
              helperText="Used to convert hours into MDs"
            />
          </Stack>

          <TextField
            label="MD limit (optional)"
            type="number"
            size="small"
            value={draft.mdLimit}
            onChange={(e) => setDraft({ ...draft, mdLimit: e.target.value })}
            inputProps={{ min: 0, step: 1 }}
            helperText="Total man-days budgeted for this contract period"
            fullWidth
          />

          {isEdit && contract && (
            <Box
              sx={{
                mt: 1,
                pt: 2,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  fontSize: 10,
                  display: 'block',
                  mb: 1,
                }}
              >
                Current usage (read-only · computed from worklogs)
              </Typography>
              <Stack direction="row" spacing={3}>
                <UsageStat label="Hours logged" value={formatMinutes(contract.minutesLogged)} />
                <UsageStat label="MD used" value={contract.mdsUsed.toFixed(2)} />
                {contract.projectedTotalMds != null && (
                  <UsageStat
                    label="Projected total MD"
                    value={contract.projectedTotalMds.toFixed(2)}
                  />
                )}
              </Stack>
            </Box>
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 1.5,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          {isEdit && onDelete && (
            <Button
              variant="text"
              color="error"
              onClick={async () => {
                await onDelete();
                onClose();
              }}
              disabled={submitting}
            >
              Delete
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: 10,
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', mt: 0.25 }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
