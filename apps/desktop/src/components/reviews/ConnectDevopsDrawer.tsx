import { Drawer } from '@mui/material';

export function ConnectDevopsDrawer({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(): void }): JSX.Element {
  void onSaved;
  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 460 } }} />
  );
}
