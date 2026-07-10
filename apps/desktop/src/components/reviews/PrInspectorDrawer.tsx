import { Drawer } from '@mui/material';
import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';

export function PrInspectorDrawer({ pr, onClose, loadDiff }: { pr: PullRequestPayload | null; onClose(): void; loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]> }): JSX.Element {
  void loadDiff;
  return (
    <Drawer anchor="right" open={pr != null} onClose={onClose} PaperProps={{ sx: { width: 620 } }} />
  );
}
