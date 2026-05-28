import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

const ATTENTION_DOT: Record<string, string> = {
  'waiting-permission': '#ef5350',
  'waiting-input': '#ffb74d',
  'idle-notify': '#9e9e9e',
  crashed: '#ef5350',
};

const MUTED_DOT = 'rgba(255,255,255,0.18)';

export interface SessionInfo {
  id: string;
  status: string;
}

interface Props {
  sessions: SessionInfo[];
  hiddenSessions: SessionInfo[];
  focusedId: string | null;
  accent: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  onHide(id: string): void;
  onUnhide(id: string): void;
  onAddSession(): void;
}

export function SessionTabBar({
  sessions,
  hiddenSessions,
  focusedId,
  accent,
  onSelect,
  onClose,
  onHide,
  onUnhide,
  onAddSession,
}: Props) {
  const [hiddenAnchor, setHiddenAnchor] = useState<HTMLElement | null>(null);
  return (
    <Box
      role="tablist"
      sx={{
        display: 'flex',
        flexShrink: 0,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {sessions.map((s, idx) => {
        const active = s.id === focusedId;
        const attentionColor = ATTENTION_DOT[s.status];
        return (
          <Box
            key={s.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.id)}
            sx={{
              flex: 1,
              minWidth: 100,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              minHeight: 32,
              cursor: 'pointer',
              userSelect: 'none',
              color: active ? 'text.primary' : 'text.secondary',
              backgroundColor: active ? 'background.default' : 'transparent',
              borderRight: idx < sessions.length - 1 ? 1 : 0,
              borderColor: 'divider',
              borderBottom: 2,
              borderBottomColor: active ? accent : 'transparent',
              transition: 'background-color 120ms',
              ':hover': {
                backgroundColor: active ? 'background.default' : 'action.hover',
              },
              fontSize: 12,
            }}
          >
            <Box
              aria-label={attentionColor ? `${s.status} — needs attention` : s.status}
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: attentionColor ?? MUTED_DOT,
                flexShrink: 0,
              }}
            />
            <Box
              sx={{
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Session {idx + 1}
            </Box>
            <Tooltip title="Hide session (keep running)" placement="bottom-end">
              <IconButton
                aria-label={`hide session ${idx + 1}`}
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onHide(s.id);
                }}
                sx={{
                  width: 20,
                  height: 20,
                  color: 'text.disabled',
                  ':hover': { color: 'text.primary' },
                }}
              >
                <VisibilityOffIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close session (kill)" placement="bottom-end">
              <IconButton
                aria-label={`close session ${idx + 1}`}
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(s.id);
                }}
                sx={{
                  width: 20,
                  height: 20,
                  color: 'text.disabled',
                  ':hover': { color: 'text.primary' },
                }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
      {hiddenSessions.length > 0 && (
        <>
          <Tooltip title="Show hidden sessions" placement="bottom-end">
            <Box
              role="button"
              aria-label={`show ${hiddenSessions.length} hidden session${
                hiddenSessions.length === 1 ? '' : 's'
              }`}
              onClick={(e: ReactMouseEvent<HTMLElement>) => setHiddenAnchor(e.currentTarget)}
              sx={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.25,
                cursor: 'pointer',
                color: 'text.secondary',
                fontSize: 11,
                userSelect: 'none',
                borderLeft: 1,
                borderColor: 'divider',
                ':hover': { backgroundColor: 'action.hover', color: 'text.primary' },
              }}
            >
              <VisibilityOffIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">{hiddenSessions.length} hidden</Typography>
            </Box>
          </Tooltip>
          <Menu
            open={Boolean(hiddenAnchor)}
            anchorEl={hiddenAnchor}
            onClose={() => setHiddenAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {hiddenSessions.map((s, i) => (
              <MenuItem
                key={s.id}
                onClick={() => {
                  onUnhide(s.id);
                  setHiddenAnchor(null);
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: ATTENTION_DOT[s.status] ?? MUTED_DOT,
                    mr: 1,
                  }}
                />
                Show hidden session {i + 1}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      <Tooltip title="New session in this project" placement="bottom-end">
        <IconButton
          aria-label="new session"
          size="small"
          onClick={onAddSession}
          sx={{
            flexShrink: 0,
            mx: 0.5,
            color: 'text.secondary',
            ':hover': { color: 'primary.main' },
          }}
        >
          <AddIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
