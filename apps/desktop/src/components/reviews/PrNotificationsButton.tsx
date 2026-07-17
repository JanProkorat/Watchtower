import { useState } from 'react';
import { Box, Button, Chip, Divider, List, ListItemButton, Popover, Typography } from '@mui/material';
import type { PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';
import { prEventLabel } from './prEventLabel.js';

/**
 * Unread-PR-notifications control for the Reviews rail item. Renders NOTHING
 * when there are no unread notifications; otherwise it's a count badge that
 * opens a popover listing the unread items (event message bold, PR title
 * secondary). Purely presentational — the parent owns the watch inbox and the
 * open / mark-all callbacks.
 */
export function PrNotificationsButton({ items, unread, onOpen, onMarkAllSeen }: {
  items: PrWatchInboxItem[];
  unread: number;
  onOpen: (item: PrWatchInboxItem) => void;
  onMarkAllSeen: () => void;
}): JSX.Element | null {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const unreadItems = items.filter((i) => i.unread);
  const close = () => setAnchorEl(null);

  // No unread notifications → show nothing at all.
  if (unread <= 0) return null;

  return (
    <>
      <Chip
        size="small"
        color="error"
        label={unread}
        aria-label="PR notifications"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ height: 20, minWidth: 24, fontWeight: 700, cursor: 'pointer', '& .MuiChip-label': { px: 0.75 } }}
      />
      <Popover
        open={anchorEl != null}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ width: 340, maxWidth: '90vw' }}>
          {unreadItems.length === 0 ? (
            <Typography sx={{ p: 2, fontSize: 13, color: 'text.secondary' }}>No unread notifications</Typography>
          ) : (
            <>
              <List dense disablePadding sx={{ maxHeight: 360, overflow: 'auto' }}>
                {unreadItems.map((it) => (
                  <ListItemButton
                    key={`${it.repoKey}-${it.prNumber}`}
                    onClick={() => { onOpen(it); close(); }}
                    sx={{ display: 'block', py: 1 }}
                  >
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }} noWrap>{prEventLabel(it.latestEvent)}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>
                      {it.repoLabel} · #{it.prNumber} · {it.title}
                    </Typography>
                  </ListItemButton>
                ))}
              </List>
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 0.75 }}>
                <Button size="small" onClick={() => { onMarkAllSeen(); close(); }}>Mark all as read</Button>
              </Box>
            </>
          )}
        </Box>
      </Popover>
    </>
  );
}
