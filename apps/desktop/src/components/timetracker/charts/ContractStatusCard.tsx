import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ContractReportRowPayload } from '@watchtower/shared/ipcContract.js';
import { formatDateCz } from '../../../util/format';

/**
 * Ported from TimeTracker's `ContractStatusCard.tsx`. Field names are
 * remapped to Watchtower's camelCase wire shape; the `expected_workdays` /
 * `expected_days_off` metrics from TT were not wired through to this
 * codebase yet, so the bottom metric row collapses to just "workdays
 * remaining" plus "ends on" (when scoped to a project header is absent).
 */

type ContractStatus = ContractReportRowPayload['contract'];

interface Props {
  contract: ContractStatus;
  /** When present, render a header row with the name + color dot. */
  projectName?: string;
  projectColor?: string;
  variant?: 'inline' | 'card';
}

function formatMd(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return String(Math.round(value));
  }
  return value.toFixed(digits);
}

export default function ContractStatusCard({
  contract,
  projectName,
  projectColor,
  variant = 'card',
}: Props) {
  const limit = contract.mdLimit;
  const used = contract.mdsUsed;
  const remaining = contract.mdsRemaining;
  const pctUsed = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : null;
  const pctColor: 'primary' | 'success' | 'warning' | 'error' =
    pctUsed == null
      ? 'primary'
      : pctUsed >= 95
        ? 'error'
        : pctUsed >= 80
          ? 'warning'
          : 'success';

  const endDateLabel = contract.endDate ? formatDateCz(contract.endDate) : null;
  const projected = contract.projectedTotalMds;
  const projectedOver = projected != null && limit != null ? projected - limit : null;
  // Only flag overshoot — finishing under the limit is fine; mdLimit is a
  // ceiling rather than a target.
  const projectionIsProblem = projectedOver != null && projectedOver > 0.5;

  const wrap = variant === 'card';
  return (
    <Box
      sx={
        wrap
          ? {
              p: 2,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              bgcolor: projectColor ? alpha(projectColor, 0.04) : 'transparent',
            }
          : { py: 1 }
      }
    >
      {projectName && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          {projectColor && (
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: projectColor,
                flexShrink: 0,
              }}
            />
          )}
          <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }} noWrap>
            {projectName}
          </Typography>
          {endDateLabel && (
            <Tooltip title={`Contract ends ${endDateLabel}`}>
              <Typography variant="caption" color="text.secondary">
                ends {endDateLabel}
              </Typography>
            </Tooltip>
          )}
        </Stack>
      )}

      {limit != null ? (
        <Box sx={{ mb: 1 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {formatMd(used)} / {formatMd(limit)} MD used
            </Typography>
            <Typography
              variant="caption"
              className="tt-num"
              color={pctColor === 'error' ? 'error.main' : 'text.secondary'}
            >
              {remaining != null ? `${formatMd(remaining)} MD left` : '—'}
            </Typography>
          </Stack>
          <ProgressWithMarker
            value={pctUsed ?? 0}
            color={pctColor}
            markerPct={
              projected != null && limit > 0
                ? Math.min(100, (projected / limit) * 100)
                : null
            }
            markerColor={projectionIsProblem ? 'error.main' : 'text.secondary'}
          />
          {projected != null && (
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Projected{' '}
                <Box
                  component="span"
                  className="tt-num"
                  sx={{
                    fontWeight: 600,
                    color: projectionIsProblem ? 'error.main' : 'text.primary',
                  }}
                >
                  {formatMd(projected)} MD
                </Box>{' '}
                at end
              </Typography>
              {projectionIsProblem && (
                <Typography
                  variant="caption"
                  className="tt-num"
                  color="error.main"
                  sx={{ fontWeight: 600 }}
                >
                  +{formatMd(projectedOver)} MD over
                </Typography>
              )}
            </Stack>
          )}
        </Box>
      ) : (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            No MD limit set
          </Typography>
          {projected != null && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.25 }}
            >
              Projected{' '}
              <Box
                component="span"
                className="tt-num"
                sx={{ fontWeight: 600, color: 'text.primary' }}
              >
                {formatMd(projected)} MD
              </Box>{' '}
              at end
            </Typography>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={2} flexWrap="wrap" rowGap={0.5} sx={{ mt: 1 }}>
        <Metric
          label="Workdays remaining"
          value={
            contract.workdaysRemaining != null
              ? String(contract.workdaysRemaining)
              : '—'
          }
        />
        <Metric
          label="Total workdays"
          value={
            contract.totalWorkdays != null ? String(contract.totalWorkdays) : '—'
          }
        />
        {!projectName && endDateLabel && <Metric label="Contract ends" value={endDateLabel} />}
      </Stack>
    </Box>
  );
}

function ProgressWithMarker({
  value,
  color,
  markerPct,
  markerColor,
}: {
  value: number;
  color: 'primary' | 'success' | 'warning' | 'error';
  markerPct: number | null;
  markerColor: string;
}) {
  return (
    <Box sx={{ position: 'relative' }}>
      <LinearProgress
        variant="determinate"
        value={value}
        color={color}
        sx={{ height: 8, borderRadius: 4 }}
      />
      {markerPct != null && (
        <Tooltip title="Projected total at contract end">
          <Box
            sx={{
              position: 'absolute',
              top: -2,
              bottom: -2,
              left: `${markerPct}%`,
              width: 2,
              borderRadius: 1,
              bgcolor: markerColor,
              transform: 'translateX(-1px)',
              pointerEvents: 'auto',
            }}
          />
        </Tooltip>
      )}
    </Box>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', lineHeight: 1.1 }}
      >
        {label}
      </Typography>
      <Typography variant="body2" className="tt-num" sx={{ fontWeight: 500 }}>
        {value}
      </Typography>
    </Box>
  );
}
