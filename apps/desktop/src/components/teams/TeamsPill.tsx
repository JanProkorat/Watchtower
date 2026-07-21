import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import VideocamIcon from '@mui/icons-material/Videocam';
import CallIcon from '@mui/icons-material/Call';
import { formatCallDuration } from '@watchtower/shared/teamsState.js';
import { glassFill, accentWash, accentActiveText } from '../../theme/glass';
import { useTeams } from '../../state/useTeams';

/**
 * Standalone Teams control in the top-right corner of the app chrome. Three
 * states: closed (dim "Teams"), open ("Teams · open"), on a call
 * ("On a call · MM:SS" with a live timer). Click opens or focuses the window.
 */
export function TeamsPill(): JSX.Element {
  const theme = useTheme();
  const { open, inCall, callStartedAt, openTeams } = useTeams();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!inCall) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inCall]);

  const Icon = inCall ? CallIcon : VideocamIcon;
  const label = inCall ? 'On a call' : 'Teams';
  const status =
    inCall && callStartedAt != null
      ? formatCallDuration(now - callStartedAt)
      : open
        ? 'open'
        : '';

  return (
    <Box
      role="button"
      aria-label={inCall ? 'Return to Teams call' : 'Open Teams'}
      onClick={openTeams}
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
        opacity: open || inCall ? 1 : 0.7,
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
  );
}
