import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import VideocamIcon from '@mui/icons-material/Videocam';
import dayjs from 'dayjs';
import type { MeetingSummary } from '@watchtower/shared/meetings.js';
import { glassSurface, glassFill, accentWash } from '../../theme/glass';

export interface MeetingsPopoverProps {
  meetings: MeetingSummary[];
  syncedAt: number | null;
  inCall: boolean;
  onJoin(joinUrl: string): void;
  onReturnToCall(): void;
  onRefresh(): void;
}

/**
 * Presentational — the calendar/meetings card rendered inside the popover
 * anchored under the TeamsPill. Kept free of IPC so it's cheaply testable;
 * `TeamsPill` wires the callbacks to `useTeams()`.
 */
export function MeetingsPopover(props: MeetingsPopoverProps): JSX.Element {
  const theme = useTheme();
  const { meetings, syncedAt, inCall, onJoin, onReturnToCall, onRefresh } = props;
  return (
    <Box sx={{ width: 380, p: 1.5, ...glassSurface(theme, { elevation: 2 }) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Calendar</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onRefresh}>
          Refresh
        </Button>
      </Box>

      {inCall && (
        <Box
          role="button"
          onClick={onReturnToCall}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1,
            mb: 1,
            borderRadius: '10px',
            cursor: 'pointer',
            backgroundColor: accentWash(theme),
            color: 'secondary.main',
            fontWeight: 600,
          }}
        >
          ● On a call — Return to call
        </Box>
      )}

      {meetings.length === 0 ? (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', fontSize: 12.5 }}>
          No meetings cached{syncedAt == null ? '' : ` (as of ${dayjs(syncedAt).format('D. M. HH:mm')})`}.
          <br />
          Click Refresh, then paste the copied command into the Claude chat.
        </Box>
      ) : (
        meetings.map((m) => (
          <Box
            key={m.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1,
              borderRadius: '11px',
              ...glassFill(theme, { elevation: 1 }),
              mb: 0.75,
            }}
          >
            <Box sx={{ width: 78, flexShrink: 0, fontFamily: 'monospace', fontSize: 11, color: 'secondary.main' }}>
              {dayjs(m.startsAt).format('HH:mm')}–{dayjs(m.endsAt).format('HH:mm')}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
                {m.subject}
              </Typography>
              {m.subtitle && (
                <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>
                  {m.subtitle}
                </Typography>
              )}
            </Box>
            {m.joinUrl && (
              <Button
                size="small"
                variant="contained"
                startIcon={<VideocamIcon />}
                onClick={() => onJoin(m.joinUrl!)}
              >
                Join
              </Button>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
