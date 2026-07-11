// @watchtower/data-supabase — Supabase client, auth, the offline-cached
// TimeTracker billing read model, and the write-through mutation hooks.
// Data-plane only: no live-plane transport, usable by any client.
export * from './supabaseClient.js';
export * from './useSupabaseAuth.js';
export * from './useBilling.js';
export * from './billingCache.js';
export * from './billingWrites.js';
export * from './paginate.js';
export * from './useWorklogMutations.js';
export * from './useTaskMutations.js';
export * from './useContractMutations.js';
export * from './useDaysOffMutations.js';
export { useAttentionThreads } from './useAttentionThreads.js';
export { useAttentionReply } from './useAttentionReply.js';
export { mapAttentionRow, groupThreads } from './attentionCache.js';
export type { AttentionMessage, AttentionThread } from './attentionCache.js';
