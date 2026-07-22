import { useEffect, useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import { useTheme } from '@mui/material/styles';
import VideocamIcon from '@mui/icons-material/Videocam';
import CallIcon from '@mui/icons-material/Call';
import { formatCallDuration } from '@watchtower/shared/teamsState.js';
import { glassFill, accentWash, accentActiveText } from '../../theme/glass';
import { useTeams } from '../../state/useTeams';
import { useToast, toastMessage } from '../../state/useToast';
import { MeetingsPopover } from './MeetingsPopover';

// Same DB path TaskGridView's sync-meetings action copies into its clipboard
// command — the repo-scoped `/teams-refresh` chat command writes its cache here.
const WATCHTOWER_DB_PATH = '/Users/jan/Library/Application Support/Watchtower/data.db';

/**
 * Standalone Teams control in the top-right corner of the app chrome. Two
 * visual states: idle (dim "Teams") and on a call ("On a call · MM:SS" with a
 * live timer). Click opens a popover with today's cached meetings — Join
 * navigates the scoped call window directly to a meeting's join URL, and
 * (while on a call) "Return to call" refocuses it.
 */
export function TeamsPill(): JSX.Element {
  const theme = useTheme();
  const { inCall, callStartedAt, meetings, syncedAt, refreshMeetings, joinMeeting, focusCall } = useTeams();
  const [now, setNow] = useState<number>(() => Date.now());
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    if (!inCall) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inCall]);

  // Prime the cache on mount so the badge/first click already has data.
  useEffect(() => {
    void refreshMeetings();
  }, [refreshMeetings]);

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    void refreshMeetings();
  };

  const handleClose = () => setAnchorEl(null);

  const handleRefresh = async () => {
    const command = `/teams-refresh "${WATCHTOWER_DB_PATH}"`;
    try {
      await navigator.clipboard.writeText(command);
      showSuccess('Command copied to clipboard. Paste it into the Claude Code chat to run it.');
    } catch (err) {
      showError(`Failed to copy command: ${toastMessage(err)}`);
    }
  };

  const Icon = inCall ? CallIcon : VideocamIcon;
  const label = inCall ? 'On a call' : 'Teams';
  const status = inCall && callStartedAt != null ? formatCallDuration(now - callStartedAt) : '';

  return (
    <>
      <Box
        role="button"
        aria-label={inCall ? 'On a Teams call — open meetings' : 'Open Teams meetings'}
        onClick={handleOpen}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          height: 32,
          px: 1.5,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          WebkitAppRegion: 'no-drag',
          ...glassFill(theme, { elevation: 1 }),
          borderRadius: '11px',
          ...(inCall
            ? { backgroundColor: accentWash(theme), color: accentActiveText(theme) }
            : { color: 'text.secondary' }),
          opacity: inCall ? 1 : 0.7,
          transition: 'opacity .15s, background-color .15s',
        }}
      >
        <Box
          sx={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            flexShrink: 0,
            backgroundColor: inCall ? 'secondary.main' : 'text.disabled',
          }}
        />
        <Icon sx={{ fontSize: 16 }} />
        <Box component="span" sx={{ fontSize: 12.5, fontWeight: 600 }}>
          {label}
        </Box>
        {status && (
          <Box
            component="span"
            sx={{ fontSize: 11.5, color: 'secondary.main', fontVariantNumeric: 'tabular-nums' }}
          >
            {status}
          </Box>
        )}
      </Box>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { backgroundColor: 'transparent', boxShadow: 'none', overflow: 'visible' } } }}
      >
        <MeetingsPopover
          meetings={meetings}
          syncedAt={syncedAt}
          inCall={inCall}
          onJoin={(joinUrl) => {
            joinMeeting(joinUrl);
            handleClose();
          }}
          onReturnToCall={() => {
            focusCall();
            handleClose();
          }}
          onRefresh={() => void handleRefresh()}
        />
      </Popover>
    </>
  );
}
