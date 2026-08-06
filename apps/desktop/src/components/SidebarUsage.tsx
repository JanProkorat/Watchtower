import { Box, Divider, LinearProgress, Tooltip, Typography } from '@mui/material';
import { useRateLimits } from '../state/useRateLimits.js';
import { useTokenUsage } from '../state/useTokenUsage.js';
import { severityColor } from './usage/severityColor.js';

// Plain rounded-percent label — NOT the shared `formatPercent` (which renders a
// Czech decimal comma, e.g. "42,0 %"). This sidebar sliver wants a compact
// integer badge, matching the collapsed mini-bar tooltip too.
function pctLabel(pct: number): string {
  return `${Math.round(pct)}%`;
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <LinearProgress
      variant="determinate"
      value={Math.min(100, Math.max(0, value))}
      sx={{
        height: 6,
        borderRadius: 1,
        backgroundColor: 'background.default',
        '& .MuiLinearProgress-bar': { backgroundColor: color },
      }}
    />
  );
}

export interface UsageRow {
  key: string;
  label: string;
  tag: string;
  pct: number;
  status: string | null;
  /** True when the % is the ccusage token estimate, not Claude's own limit. */
  estimated: boolean;
  /** Epoch seconds this window rolls over, or 0 when not reported. */
  resetsAt: number;
}

const ESTIMATE_HINT =
  'estimate from ccusage tokens, not your real limit — switch on Settings → General → “Capture usage from statusline” to track the actual one';

/**
 * Local reset clock, cs-CZ per project locale. Time-only for the 5h window
 * ("18:00"); the 7-day window resets days out, so it carries the date too
 * ("10. 8. 8:00") — a bare time would read as later today.
 */
function resetLabel(resetsAt: number, nowMs: number): string {
  const at = new Date(resetsAt * 1000);
  const hhmm = at.toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date(nowMs).toDateString()) return hhmm;
  return `${at.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} ${hhmm}`;
}

/** Exported for unit tests — a Tooltip's title is not in the DOM until hover. */
export function tooltipFor(r: UsageRow, nowMs: number = Date.now()): string {
  const parts = [`${r.label}: ${pctLabel(r.pct)}`];
  if (r.resetsAt > 0) parts.push(`resets ${resetLabel(r.resetsAt, nowMs)}`);
  if (r.estimated) parts.push(ESTIMATE_HINT);
  return parts.join(' · ');
}

/**
 * ccusage's active block only stays active until its `endTime`. The payload is
 * cached (orchestrator polls every 5 min) and held in the renderer indefinitely,
 * so a block whose window has already closed must not keep reporting its final
 * percentage — that window is over and a new one starts at zero.
 */
function isLapsed(endTime: string | undefined, nowMs: number): boolean {
  if (!endTime) return false;
  const end = Date.parse(endTime);
  return Number.isFinite(end) && nowMs >= end;
}

export interface SidebarUsageProps {
  /** Rendered from the rail's own `!expanded` state — self-manages padding either way. */
  collapsed: boolean;
}

/**
 * Session + Week usage bars pinned to the bottom of the ModuleRail.
 *
 * Session % prefers the statusline-captured rate-limit snapshot and falls back
 * to the ccusage 5h-block estimate when capture is off — the two are different
 * measures (Claude's own `used_percentage` vs. tokens over a reconstructed
 * limit), so the fallback is marked `~` and says so on hover rather than passing
 * itself off as the real limit. Week only comes from the snapshot — there's no
 * ccusage equivalent — so it's hidden entirely (not a disabled/hint state) when
 * that data isn't present. Only when neither source has anything do we show the
 * muted placeholder.
 */
export function SidebarUsage({ collapsed }: SidebarUsageProps) {
  const { data: rl } = useRateLimits();
  const tokens = useTokenUsage();

  const ccBlock = tokens.data?.available ? tokens.data.block : null;
  const ccUsable = ccBlock != null && !isLapsed(ccBlock.endTime, Date.now());
  const ccPct = ccUsable ? (ccBlock.currentPercentUsed ?? null) : null;
  const ccStatus = ccUsable ? (ccBlock.status ?? null) : null;

  // Prefer Claude's own rate limit; the ccusage figure is a different metric
  // (tokens against a reconstructed limit, over ccusage's own block boundaries)
  // and is only a rough stand-in, so it is labelled as such below.
  const sessionPct = rl?.session?.usedPercent ?? ccPct;
  const sessionEstimated = rl?.session == null && ccPct != null;
  const weekPct = rl?.week?.usedPercent ?? null;

  const hasAny = sessionPct != null || weekPct != null;
  if (!hasAny) {
    return (
      <Box sx={{ px: collapsed ? 0.5 : 1, py: 1 }}>
        <Divider sx={{ mb: 1 }} />
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: 'block', textAlign: 'center' }}
        >
          no usage data yet
        </Typography>
      </Box>
    );
  }

  const rows: UsageRow[] = [
    sessionPct != null
      ? {
          key: 'session',
          label: 'Session',
          tag: 'S',
          pct: sessionPct,
          status: rl?.session ? null : ccStatus,
          estimated: sessionEstimated,
          resetsAt: rl?.session?.resetsAt ?? 0,
        }
      : null,
    weekPct != null
      ? {
          key: 'week',
          label: 'Week',
          tag: 'W',
          pct: weekPct,
          status: null,
          estimated: false,
          resetsAt: rl?.week?.resetsAt ?? 0,
        }
      : null,
  ].filter((r): r is UsageRow => r !== null);

  return (
    <Box sx={{ px: collapsed ? 0.5 : 1, py: 1 }}>
      <Divider sx={{ mb: 1 }} />
      {rows.map((r) => {
        const color = severityColor(r.status, r.pct);
        return (
          <Tooltip key={r.key} title={tooltipFor(r)} placement="right">
            <Box sx={{ mb: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" color="text.secondary">
                  {collapsed ? r.tag : r.label}
                </Typography>
                {!collapsed && (
                  <Typography variant="caption" color="text.secondary">
                    {/* `~` marks a ccusage estimate so the number is never read
                        as the real limit (the tooltip spells out why). */}
                    {r.estimated ? `~${pctLabel(r.pct)}` : pctLabel(r.pct)}
                  </Typography>
                )}
              </Box>
              <Bar value={r.pct} color={color} />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
