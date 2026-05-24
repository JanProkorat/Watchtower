import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useContracts } from '../../state/useContracts.js';
import { ContractDrawer } from './ContractDrawer.js';
import type { ContractViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  projectId: number;
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatRate(c: ContractViewPayload): string {
  const amount = c.rateAmount.toLocaleString('cs-CZ');
  const unit = c.rateType === 'hourly' ? '/h' : '/MD';
  return `${amount} ${c.currency}${unit}`;
}

export function ContractsTab({ projectId }: Props) {
  const state = useContracts(projectId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ContractViewPayload | null>(null);

  const active = state.contracts.find((c) => c.isActive) ?? null;
  const others = state.contracts.filter((c) => !c.isActive);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (c: ContractViewPayload) => {
    setEditing(c);
    setDrawerOpen(true);
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
          {state.contracts.length}{' '}
          {state.contracts.length === 1 ? 'contract' : 'contracts'}
          {active ? ' · 1 active' : ''}
        </Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
          Add contract
        </Button>
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {state.error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {state.error}
          </Alert>
        )}

        {!state.loading && state.contracts.length === 0 && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              No contracts yet.
            </Typography>
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
              Add your first contract
            </Button>
          </Box>
        )}

        {active && <ActiveSummary contract={active} />}

        <Stack spacing={1}>
          {active && (
            <ContractCard
              contract={active}
              onEdit={() => openEdit(active)}
              onDelete={() => void state.remove(active.id)}
            />
          )}
          {others.map((c) => (
            <ContractCard
              key={c.id}
              contract={c}
              onEdit={() => openEdit(c)}
              onDelete={() => void state.remove(c.id)}
            />
          ))}
        </Stack>

        {state.contracts.length > 0 && (
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              backgroundColor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
              How contracts work
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
              A contract sets the hourly or daily rate, working hours per day, and an optional MD
              cap. The newest <strong>active</strong> contract (today between <em>effective from</em>{' '}
              and <em>end date</em>) is used for invoice projections and the dashboard.
              Contracts on the same project cannot overlap.
            </Typography>
          </Box>
        )}
      </Box>

      <ContractDrawer
        open={drawerOpen}
        contract={editing}
        projectId={projectId}
        onClose={() => setDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editing) {
            return state.update(editing.id, input);
          }
          return state.create(input);
        }}
        onDelete={
          editing
            ? async () => {
                await state.remove(editing.id);
              }
            : undefined
        }
      />
    </Box>
  );
}

function ActiveSummary({ contract }: { contract: ContractViewPayload }) {
  return (
    <Box
      sx={{
        mb: 2,
        p: 2,
        borderRadius: 1,
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: 10,
          display: 'block',
          mb: 1,
        }}
      >
        Active contract · summary
      </Typography>
      <Stack direction="row" spacing={4}>
        <SummaryStat label="Rate" value={formatRate(contract)} />
        <SummaryStat label="Hours / day" value={contract.hoursPerDay.toString()} />
        <SummaryStat
          label="MD used"
          value={
            contract.mdLimit != null
              ? `${contract.mdsUsed.toFixed(2)} / ${contract.mdLimit}`
              : `${contract.mdsUsed.toFixed(2)} / unlimited`
          }
        />
        <SummaryStat
          label="Projected"
          value={
            contract.projectedTotalMds != null
              ? `${contract.projectedTotalMds.toFixed(2)} MD`
              : '—'
          }
        />
      </Stack>
    </Box>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: 10,
        }}
      >
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  );
}

function ContractCard({
  contract,
  onEdit,
  onDelete,
}: {
  contract: ContractViewPayload;
  onEdit(): void;
  onDelete(): void;
}) {
  const usagePct =
    contract.mdLimit != null && contract.mdLimit > 0
      ? Math.min(1, contract.mdsUsed / contract.mdLimit)
      : 0;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        backgroundColor: 'background.paper',
        opacity: contract.isCompleted ? 0.75 : 1,
        borderLeft: contract.isActive ? 3 : 1,
        borderLeftColor: contract.isActive ? 'success.main' : 'divider',
        px: 2,
        py: 1.5,
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
          {contract.effectiveFrom} → {contract.endDate ?? 'ongoing'}
          {contract.isActive && (
            <Chip
              label="active"
              size="small"
              color="success"
              variant="outlined"
              sx={{ ml: 1, height: 18, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}
            />
          )}
          {contract.isCompleted && (
            <Chip
              label="ended"
              size="small"
              variant="outlined"
              sx={{
                ml: 1,
                height: 18,
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'text.secondary',
              }}
            />
          )}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatRate(contract)} · {contract.hoursPerDay} h/day
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={onDelete}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {contract.mdLimit != null && (
        <Box sx={{ mt: 1.5 }}>
          <Box
            sx={{
              height: 6,
              borderRadius: 999,
              backgroundColor: 'action.hover',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: `${usagePct * 100}%`,
                height: '100%',
                backgroundColor: usagePct >= 1 ? 'error.main' : 'primary.main',
              }}
            />
          </Box>
        </Box>
      )}

      <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
        <Caption label="MD used" value={contract.mdLimit != null ? `${contract.mdsUsed.toFixed(2)} / ${contract.mdLimit}` : contract.mdsUsed.toFixed(2)} />
        <Caption label="Hours logged" value={formatMinutes(contract.minutesLogged)} />
        {contract.workdaysRemaining != null && (
          <Caption label="Workdays remaining" value={contract.workdaysRemaining.toString()} />
        )}
        {contract.projectedTotalMds != null && (
          <Caption label="Projected total MD" value={contract.projectedTotalMds.toFixed(2)} />
        )}
      </Stack>
    </Box>
  );
}

function Caption({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: 10,
          display: 'block',
        }}
      >
        {label}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}
