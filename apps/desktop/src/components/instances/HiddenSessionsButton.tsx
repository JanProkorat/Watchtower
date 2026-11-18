import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Box, ButtonBase, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';
import { ATTENTION_AMBER } from '../../theme/glass.js';

export interface HiddenSession {
  id: string;
  status: string;
  kind: 'claude' | 'shell' | 'chat';
  title: string | null;
}

const UNTITLED: Record<HiddenSession['kind'], string> = {
  claude: 'Untitled Claude session',
  shell: 'Terminal',
  chat: 'Untitled chat',
};

/** Menu label: the session's generated name, else a per-kind fallback. */
export function hiddenSessionLabel(s: HiddenSession): string {
  const title = s.title?.trim();
  return title ? title : UNTITLED[s.kind];
}

interface Props {
  sessions: HiddenSession[];
  onUnhide(id: string): void;
}

/** "N hidden" chip that opens a menu of the hidden sessions by name; picking one shows it again. */
export function HiddenSessionsButton({ sessions, onUnhide }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (sessions.length === 0) return null;
  const n = sessions.length;
  const plural = n === 1 ? '' : 's';
  const anyAttention = sessions.some((s) => ACTION_NEEDED_STATUSES.has(s.status));

  return (
    <>
      <Tooltip title={`${n} hidden session${plural} — click to show`} placement="bottom-start">
        <ButtonBase
          aria-label={`show ${n} hidden session${plural}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e: ReactMouseEvent<HTMLElement>) => {
            e.stopPropagation();
            setAnchor(e.currentTarget);
          }}
          sx={{
            flexShrink: 0,
            height: 22,
            px: 0.75,
            gap: 0.5,
            borderRadius: '7px',
            fontSize: 11,
            fontWeight: 600,
            color: anyAttention ? ATTENTION_AMBER : '#e6e9ef',
            backgroundColor: 'rgba(129,140,248,0.22)',
            border: `1px solid ${anyAttention ? ATTENTION_AMBER : 'rgba(129,140,248,0.55)'}`,
            ':hover': { backgroundColor: 'rgba(129,140,248,0.38)', color: '#fff' },
          }}
        >
          <VisibilityOffIcon sx={{ fontSize: 14 }} />
          {n} hidden
        </ButtonBase>
      </Tooltip>
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {sessions.map((s) => {
          const attention = ACTION_NEEDED_STATUSES.has(s.status);
          return (
            <MenuItem
              key={s.id}
              onClick={() => {
                onUnhide(s.id);
                setAnchor(null);
              }}
              sx={{ gap: 1, maxWidth: 360 }}
            >
              <Box
                aria-label={attention ? 'needs attention' : undefined}
                sx={{
                  width: 8,
                  height: 8,
                  flexShrink: 0,
                  borderRadius: '50%',
                  backgroundColor: attention ? ATTENTION_AMBER : 'rgba(255,255,255,0.25)',
                  boxShadow: attention ? `0 0 6px ${ATTENTION_AMBER}` : 'none',
                }}
              />
              <ListItemText
                primary={hiddenSessionLabel(s)}
                primaryTypographyProps={{ noWrap: true, title: hiddenSessionLabel(s) }}
              />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
