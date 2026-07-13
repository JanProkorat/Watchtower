import { useState } from 'react';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Tooltip } from '@mui/material';

export function MergeButton(props: {
  approved: boolean;
  mergeable: boolean;
  mergeBlockedReason: string | null;
  onMerge: (deleteBranch: boolean) => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const enabled = props.approved && props.mergeable;
  const reason = !props.approved ? 'Not yet approved' : props.mergeBlockedReason ?? '';

  const btn = (
    <span>
      <Button variant="contained" color="success" disabled={!enabled} onClick={() => setOpen(true)}>
        Merge
      </Button>
    </span>
  );

  return (
    <>
      {enabled ? btn : <Tooltip title={reason}>{btn}</Tooltip>}
      <Dialog open={open} onClose={() => !busy && setOpen(false)}>
        <DialogTitle>Squash & merge this PR?</DialogTitle>
        <DialogContent>
          <FormControlLabel
            control={<Checkbox checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />}
            label="Delete source branch after merge"
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" disabled={busy}
            onClick={async () => { setBusy(true); try { await props.onMerge(deleteBranch); setOpen(false); } finally { setBusy(false); } }}>
            Squash & merge
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
