import { Box, Divider, LinearProgress, Tooltip, Typography } from '@mui/material';
import { useRateLimits } from '../state/useRateLimits';
import { useTokenUsage } from '../state/useTokenUsage';
import { severityColor } from './usage/severityColor';

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

interface UsageRow {
  key: string;
  label: string;
  tag: string;
  pct: number;
  status: string | null;
}

export interface SidebarUsageProps {
  /** Rendered from the rail's own `!expanded` state — self-manages padding either way. */
  collapsed: boolean;
}

/**
 * Session + Week usage bars pinned to the bottom of the ModuleRail.
 *
 * Session % prefers the statusline-captured rate-limit snapshot and falls
 * back to the ccusage 5h-block estimate when capture is off. Week only comes
 * from the snapshot — there's no ccusage equivalent — so it's hidden entirely
 * (not a disabled/hint state) when that data isn't present. Only when neither
 * source has anything do we show the muted placeholder.
 */
export function SidebarUsage({ collapsed }: SidebarUsageProps) {
  const { data: rl } = useRateLimits();
  const tokens = useTokenUsage();

  const ccPct = tokens.data?.available ? (tokens.data.block?.currentPercentUsed ?? null) : null;
  const ccStatus = tokens.data?.available ? (tokens.data.block?.status ?? null) : null;

  const sessionPct = rl?.session?.usedPercent ?? ccPct;
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
      ? { key: 'session', label: 'Session', tag: 'S', pct: sessionPct, status: rl?.session ? null : ccStatus }
      : null,
    weekPct != null ? { key: 'week', label: 'Week', tag: 'W', pct: weekPct, status: null } : null,
  ].filter((r): r is UsageRow => r !== null);

  return (
    <Box sx={{ px: collapsed ? 0.5 : 1, py: 1 }}>
      <Divider sx={{ mb: 1 }} />
      {rows.map((r) => {
        const color = severityColor(r.status, r.pct);
        return (
          <Tooltip key={r.key} title={`${r.label}: ${pctLabel(r.pct)}`} placement="right">
            <Box sx={{ mb: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" color="text.secondary">
                  {collapsed ? r.tag : r.label}
                </Typography>
                {!collapsed && (
                  <Typography variant="caption" color="text.secondary">
                    {pctLabel(r.pct)}
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
