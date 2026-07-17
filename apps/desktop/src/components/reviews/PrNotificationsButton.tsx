import { useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, List, ListItemButton, Popover, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import type { PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';

/**
 * Right-side notification control for the Reviews route: a bell with the unread
 * count that opens a popover listing unread PR notifications. Purely
 * presentational — the parent owns the watch inbox and supplies the open /
 * mark-all callbacks. (Replaces the old red badge on the "Reviews" title.)
 */
export function PrNotificationsButton(props: {
  items: PrWatchInboxItem[];
  unread: number;
  onOpen: (item: PrWatchInboxItem) => void;
  onMarkAllSeen: () => void;
}): JSX.Element {
  const { items, unread, onOpen, onMarkAllSeen } = props;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const unreadItems = items.filter((i) => i.unread);

  const close = () => setAnchorEl(null);

  return (
    <>
      <IconButton
        size="small"
        aria-label="PR notifications"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <Badge badgeContent={unread} color="error">
          <NotificationsNoneIcon fontSize="small" />
        </Badge>
      </IconButton>
      <Popover
        open={anchorEl != null}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
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
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                      {it.repoLabel} · #{it.prNumber} · {it.latestEvent}
                    </Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 500 }} noWrap>{it.title}</Typography>
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
