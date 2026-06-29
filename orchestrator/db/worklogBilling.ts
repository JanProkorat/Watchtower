// Moved to @watchtower/shared/billing/worklogBilling so the iPad write path and
// the Mac sync push share one formula. This shim keeps existing import sites
// (orchestrator/sync/derive.ts) unchanged.
export {
  computeWorklogBilling,
  type ContractLite,
  type WorklogBilling,
} from '@watchtower/shared/billing/worklogBilling.js';
