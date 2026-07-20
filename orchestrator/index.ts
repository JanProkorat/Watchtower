import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PortApi, type OrchRequest, type OrchResponse, type OrchPush, type OrchOverlapError } from '@watchtower/shared/messagePort.js';
import { bootstrap, type BootstrapHandle } from './bootstrap.js';
import { PtyManager } from './ptyManager.js';
import { InstancesRepo } from './db/repositories/instances.js';
import { HookEventsRepo } from './db/repositories/hookEvents.js';
import { NotificationsRepo } from './db/repositories/notifications.js';
import { PushDevicesRepo } from './db/repositories/pushDevices.js';
import { SettingsRepo } from './db/repositories/settings.js';
import {
  ProjectsRepo,
  type ProjectInput,
  type ProjectListFilter,
  type ProjectRow,
} from './db/repositories/projects.js';
import { NotesRepo, type NoteInput, type NoteListFilter, type NoteRow } from './db/repositories/notes.js';
import { EpicsRepo, type EpicInput } from './db/repositories/epics.js';
import { TasksRepo, type TaskInput } from './db/repositories/tasks.js';
import {
  WorklogsRepo,
  WORKLOG_LOCK_SETTING_KEY,
  type WorklogInput,
  type WorklogListFilter,
} from './db/repositories/worklogs.js';
import {
  ProjectRatesRepo,
  RateOverlapError,
  type ProjectRateInput,
  type ProjectRateRow,
  type GroupTerms,
} from './db/repositories/projectRates.js';
import { ContractStatusService } from './db/contractStatus.js';
import { markWorklogsForRebill } from './db/rebill.js';
import { nowIso } from './db/syncColumns.js';
import { TaskGridService } from './db/taskGrid.js';
import { DaysOffRepo, type DayOffInput } from './db/repositories/daysOff.js';
import { czechHolidays } from './db/workdays.js';
import { ReportsService } from './db/reports.js';
import { DashboardOverviewService } from './db/dashboardOverview.js';
import { transition } from './stateMachine.js';
import { hookCwdMatches, resolveResumeTarget } from './sessionResume.js';
import { createAuthBlockDetector } from './authBlockDetector.js';
import { Notifier } from './notifier.js';
import { QuietTimers } from './quietTimers.js';
import { EscalationGate, type EscalationKind } from './escalationGate.js';
import { TerminalSnapshots } from './terminalSnapshots.js';
import { buildTerminalAttachResponse } from './terminalAttach.js';
import { readHubConfig, writeHubConfig } from './services/hubConfig.js';
import { createHubSender } from './hubSender.js';
import { createAttentionRelay, type AttentionRelay } from './attentionRelay.js';
import { readPgPushTokens } from './db/repositories/pgPushDevices.js';
import { sendApns } from './services/apns.js';
import {
  previewHookInstall,
  ensureHooksInstalled,
  uninstallHooks,
} from './hookInstaller.js';
import { captureStatus, enableCapture, disableCapture } from './services/statuslineCapture.js';
import { readSettings, writeSettings } from './services/claudeSettings.js';
import { listSkills } from './services/claudeSkills.js';
import { listAgents } from './services/claudeAgents.js';
import { JiraSyncService } from './services/jiraSync.js';
import { JiraBoardService } from './services/jiraBoard.js';
import { fetchTokenUsage } from './services/tokenUsage.js';
import { AutoTimeLogger } from './services/autoTimeLogger.js';
import { ReviewsService } from './services/reviews.js';
import { runReview } from './services/prReview.js';
import { postGithubComment, postAzdoComment } from './services/prProviders/postComment.js';
import { PrReviewsRepo, type PrReviewRow } from './db/repositories/prReviews.js';
import { mergeGithubPr, mergeAzdoPr } from './services/prWatch/merge.js';
import { PrWatcher } from './services/prWatch/PrWatcher.js';
import { githubWatched, azdoWatched } from './services/prWatch/queries.js';
import { resolveGithubLogin, resolveAzdoUser } from './services/prWatch/identity.js';
import { prepareImplementLaunch } from './services/prImplement.js';
import { defaultExec } from './services/prProviders/exec.js';
import { PrWatchStateRepo } from './db/repositories/prWatchState.js';
import { buildInbox, markPrSeen } from './services/prWatch/inbox.js';
import type { WatchedPr, WatchEvent } from './services/prWatch/types.js';
import type { TokenUsagePayload } from '@watchtower/shared/tokenUsageFormat.js';
import type { RateLimitsPayload, RateLimitsSnapshot } from '@watchtower/shared/rateLimitsFormat.js';
import { extractRateLimits } from '@watchtower/shared/rateLimitsFormat.js';
import type { SqliteLike } from './db/migrations.js';
import type { StateEvent } from '@watchtower/shared/events.js';
import type { InstanceStatus } from '@watchtower/shared/stateModel.js';
import type { PrHost, PrReviewPayload, PrFindingPayload, NoteViewPayload } from '@watchtower/shared/ipcContract.js';
import { buildPtySpawnConfig, planBootAction } from './shellPolicy.js';
import type { InstanceKind } from './shellPolicy.js';
import { PtySizeOwnership } from './ptySizeOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Safety net: log unhandled rejections / uncaught exceptions so a stray
// throw inside an async handler doesn't kill the utility process and force
// a full orchestrator restart. We log them through `console.error` (piped
// to the Electron main's stderr via utilityProcess.stdio: 'inherit') so
// they remain visible without bringing the orchestrator down.
process.on('unhandledRejection', (reason) => {
  console.error('[orchestrator] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[orchestrator] uncaughtException:', err);
});

let api: PortApi | null = null;
let handle: BootstrapHandle | null = null;

/**
 * Test-only: inject a bootstrap handle so `handleRequest`'s db-backed cases
 * can be exercised directly, without the real parentPort/utilityProcess/ws
 * wiring that normally populates `handle` (see the `parentPort.on('message', ...)`
 * listener near the bottom of this file). Production code never calls this.
 */
export function __setHandleForTests(h: BootstrapHandle | null): void {
  handle = h;
}

let pushSink: ((msg: OrchPush) => void) | null = null;

export function setPushSink(sink: ((msg: OrchPush) => void) | null): void {
  pushSink = sink;
}

export function emitPush(msg: OrchPush): void {
  api?.push(msg);
  try {
    pushSink?.(msg);
  } catch (err) {
    console.error('[orchestrator] push sink threw:', err);
  }
}

const pty = new PtyManager();
const terminalSnapshots = new TerminalSnapshots();
const ptySizeOwnership = new PtySizeOwnership();
const authBlockDetector = createAuthBlockDetector({
  emit: (e) => emitPush({ kind: 'authBlock', payload: e }),
});
const LOCAL_CLIENT = 'local';

export function handleClientGone(clientId: string): void {
  for (const { instanceId, cols, rows } of ptySizeOwnership.clientGone(clientId)) {
    pty.get(instanceId)?.resize(cols, rows);
    terminalSnapshots.resize(instanceId, cols, rows);
  }
}
let notifier: Notifier | null = null;
let quietTimers: QuietTimers | null = null;
let escalationGate: EscalationGate | null = null;
let attentionRelay: AttentionRelay | null = null;

const DEFAULT_QUIET_MS = 90_000;

// Latest ccusage snapshot, refreshed on a timer (see startTokenUsagePolling).
// `tokens:usage` returns this cached value so the renderer/tray never block on
// a ccusage invocation; the push keeps both surfaces live.
const TOKEN_USAGE_POLL_MS = 5 * 60_000;
let latestTokenUsage: TokenUsagePayload | null = null;

async function refreshTokenUsage(): Promise<TokenUsagePayload> {
  const payload = await fetchTokenUsage();
  if (!payload.available) {
    // Surface the real reason in the orchestrator log (piped to main's stderr)
    // so a misconfigured PATH / missing ccusage is diagnosable, not silent.
    console.error('[tokenUsage] unavailable:', payload.error);
  }
  latestTokenUsage = payload;
  emitPush({ kind: 'tokenUsage', payload });
  return payload;
}

function startTokenUsagePolling(): void {
  void refreshTokenUsage();
  const timer = setInterval(() => void refreshTokenUsage(), TOKEN_USAGE_POLL_MS);
  // utilityProcess is long-lived; unref so the timer never keeps it alive on
  // its own during shutdown.
  timer.unref?.();
}

// Latest rate-limits snapshot captured from the statusline helper's POST
// (see onStatusline below). Persisted to `settings` so a cold start shows
// last-known usage until the next statusline render arrives.
const RATE_LIMITS_SETTING_KEY = 'rate_limits_snapshot';
const RATE_LIMITS_PUSH_MIN_MS = 5_000;
let latestRateLimits: RateLimitsSnapshot | null = null;
let lastRateLimitsPushAt = 0;

/** Load the persisted snapshot at boot so cold start shows last-known usage. */
function loadPersistedRateLimits(db: SqliteLike): void {
  try {
    const raw = new SettingsRepo(db).getString(RATE_LIMITS_SETTING_KEY, '');
    if (raw) latestRateLimits = JSON.parse(raw) as RateLimitsSnapshot;
  } catch {
    /* ignore corrupt/absent snapshot */
  }
}

/** Handle a statusline POST: extract, persist, and throttle-push a snapshot. */
function onStatuslineBody(db: SqliteLike, body: unknown, now: number): void {
  const snap = extractRateLimits(body, now);
  if (!snap) return; // no rate_limits in this render — nothing to store
  latestRateLimits = snap;
  try {
    new SettingsRepo(db).set(RATE_LIMITS_SETTING_KEY, JSON.stringify(snap));
  } catch (err) {
    console.error('[rateLimits] persist failed:', err);
  }
  // Throttle the push: statuslines render every few seconds.
  if (now - lastRateLimitsPushAt >= RATE_LIMITS_PUSH_MIN_MS) {
    lastRateLimitsPushAt = now;
    emitPush({ kind: 'rateLimitsUsage', payload: snap });
  }
}

function supportDir(): string {
  // WATCHTOWER_SUPPORT_DIR lets a dev run point at an isolated copy of the
  // app-support dir (data.db, hook-token, listener.json) so it never touches
  // the production database. Set by the `dev:electron` npm script.
  const dir =
    process.env.WATCHTOWER_SUPPORT_DIR ??
    path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function userSettingsPath(): string {
  return path.join(homedir(), '.claude', 'settings.json');
}

function resolveHelperPath(): string {
  if (process.env.WATCHTOWER_HELPER_DIR) {
    return path.join(process.env.WATCHTOWER_HELPER_DIR, 'watchtower-hook.mjs');
  }
  // process.resourcesPath is set in packaged Electron builds but not typed in @types/node.
  const resPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resPath) {
    const packaged = path.join(resPath, 'app.asar.unpacked', 'dist-helper', 'watchtower-hook.mjs');
    if (existsSync(packaged)) return packaged;
  }
  return path.join(__dirname, '..', '..', 'dist-helper', 'watchtower-hook.mjs');
}

function resolveStatuslineHelperPath(): string {
  if (process.env.WATCHTOWER_HELPER_DIR) {
    return path.join(process.env.WATCHTOWER_HELPER_DIR, 'watchtower-statusline.mjs');
  }
  // process.resourcesPath is set in packaged Electron builds but not typed in @types/node.
  const resPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resPath) {
    const packaged = path.join(resPath, 'app.asar.unpacked', 'dist-helper', 'watchtower-statusline.mjs');
    if (existsSync(packaged)) return packaged;
  }
  return path.join(__dirname, '..', '..', 'dist-helper', 'watchtower-statusline.mjs');
}

function notifySync(): void {
  handle?.sync.notifyLocalChange();
}

function repo(): InstancesRepo {
  return new InstancesRepo(handle!.db);
}

function projectsRepo(): ProjectsRepo {
  return new ProjectsRepo(handle!.db);
}

function notesRepo(): NotesRepo {
  return new NotesRepo(handle!.db);
}

let _reviews: ReviewsService | null = null;
// Unlike the other repo/service accessors above (which are cheap to
// re-construct per request), ReviewsService caches the last `refresh()`
// result in-memory (`list()` just reads that cache) — it MUST be a true
// singleton or every `prs:list` call after a `prs:refresh` would see an
// empty cache from a freshly-constructed instance.
function reviewsSvc(): ReviewsService {
  if (!_reviews) {
    _reviews = new ReviewsService({
      db: handle!.db,
      projects: () => projectsRepo().list({}).map((p) => ({ id: p.id, name: p.name, folder_path: p.folderPath ?? null })),
    });
  }
  return _reviews;
}

function prReviewsRepo(): PrReviewsRepo {
  return new PrReviewsRepo(handle!.db);
}

// Tracks the AbortController for each in-flight review by reviewId so
// `prReview:cancel` can abort the underlying claude process. Entries are
// removed once the review's runReview() promise settles (success or failure).
const runningReviews = new Map<number, AbortController>();
// Reviews currently mid-postComments — guards against a double-click (or two
// interleaved IPC requests) posting the same findings twice even if the
// renderer's own re-entrancy guard is bypassed.
const postingReviews = new Set<number>();

function reviewPayloadOf(row: PrReviewRow): PrReviewPayload {
  let findings: PrFindingPayload[] = [];
  try {
    findings = row.findings_json ? (JSON.parse(row.findings_json) as PrFindingPayload[]) : [];
  } catch {
    findings = [];
  }
  return {
    id: row.id,
    host: row.host as PrHost,
    repoKey: row.repo_key,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    status: row.status,
    summary: row.summary,
    findings,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

// Azure DevOps PATs, decrypted in electron main (safeStorage) and pushed here
// once at startup + on every change via `prWatch:setPats` — the orchestrator
// itself cannot safeStorage.decryptString. Keyed by devopsHost. Empty until
// the first push arrives, so DevOps watching quietly stays off until then.
let watchPats: Record<string, string> = {};

/** Exported for unit testing (see tests/orchestrator/notificationBody.test.ts). */
export function notificationBody(pr: WatchedPr, ev: WatchEvent): string {
  switch (ev.type) {
    case 'review_requested': return `Review requested on "${pr.title}"`;
    case 'commented': return `${ev.author} commented on "${pr.title}"`;
    case 'reviewed': return `${ev.author} reviewed "${pr.title}"`;
    case 'approved': return `${ev.author} approved "${pr.title}"`;
    case 'changes_requested': return `${ev.author} requested changes on "${pr.title}"`;
  }
}

const PR_WATCH_FOCUSED_MS = 60_000;
const PR_WATCH_UNFOCUSED_MS = 300_000;
let prWatchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Boots the cross-repo PR watcher: an adaptive poll (60s while the app window
 * is focused, 300s otherwise) that diffs each watched PR's state against
 * `pr_watch_state` and fires a notification + push per new event (review
 * requested, comment, review, approve, changes-requested).
 */
function startPrWatch(): void {
  const stateRepo = new PrWatchStateRepo(handle!.db);

  const fetchWatched = async (): Promise<WatchedPr[]> => {
    const out: WatchedPr[] = [];
    // GitHub: truly account-wide (gh CLI's own auth), independent of configured projects.
    try {
      const login = await resolveGithubLogin();
      out.push(...(await githubWatched(login)));
    } catch (err) {
      console.error('[prWatch] github', err);
    }
    // Azure DevOps: one (host, org) per configured devops remote that has a PAT.
    try {
      const { azdo } = await reviewsSvc().resolveRepos();
      const orgs = new Map<string, { apiBase: string; devopsHost: string; org: string }>();
      for (const r of azdo) {
        if (orgs.has(r.apiBase)) continue;
        const org = new URL(r.apiBase).pathname.split('/').filter(Boolean)[0] ?? '';
        orgs.set(r.apiBase, { apiBase: r.apiBase, devopsHost: r.devopsHost, org });
      }
      for (const { apiBase, devopsHost, org } of orgs.values()) {
        const pat = watchPats[devopsHost];
        if (!pat) {
          console.error('[prWatch] azdo: skipping org (no PAT for host)', devopsHost);
          continue;
        }
        try {
          const user = await resolveAzdoUser(apiBase, pat);
          // Pass devopsHost (not org) so azdoWatched mints the canonical
          // `azdo:${devopsHost}/${repo}` repoKey — matching resolveRepos().
          out.push(...(await azdoWatched(apiBase, devopsHost, user, pat)));
        } catch (err) {
          console.error('[prWatch] azdo org', org, err);
        }
      }
    } catch (err) {
      console.error('[prWatch] azdo', err);
    }
    return out;
  };

  const watcher = new PrWatcher({
    repo: stateRepo,
    // Thread the resolved GitHub login through so computeEvents can filter
    // out the user's own comments/reviews on GitHub PRs (azdo authors are
    // already filtered by id inside parseAzdoPr).
    me: async () => ({ github: await resolveGithubLogin().catch(() => null), azdo: new Map() }),
    fetchWatched,
    now: () => new Date().toISOString(),
    onEvent: (pr, ev) => {
      const body = notificationBody(pr, ev);
      emitPush({
        kind: 'notify',
        payload: {
          target: 'pr',
          host: pr.host,
          repoKey: pr.repoKey,
          prNumber: pr.prNumber,
          title: pr.title,
          repoLabel: pr.repoLabel,
          event: ev.type,
          body,
        },
      });
      try {
        new NotificationsRepo(handle!.db).log(`pr:${pr.host}:${pr.repoKey}#${pr.prNumber}`, `pr-${ev.type}`, body, Date.now());
      } catch (err) {
        console.error('[prWatch] notification log failed', err);
      }
      emitPush({ kind: 'prWatchEvent', payload: { host: pr.host, repoKey: pr.repoKey, prNumber: pr.prNumber } });
    },
  });

  const tick = async (): Promise<void> => {
    try {
      await watcher.cycle();
    } catch (err) {
      console.error('[prWatch] cycle', err);
    }
    const focused = notifier?.isWindowFocused() ?? true;
    prWatchTimer = setTimeout(() => void tick(), focused ? PR_WATCH_FOCUSED_MS : PR_WATCH_UNFOCUSED_MS);
    prWatchTimer.unref?.();
  };
  void tick();
}

function epicsRepo(): EpicsRepo {
  return new EpicsRepo(handle!.db);
}

function tasksRepo(): TasksRepo {
  return new TasksRepo(handle!.db);
}

/**
 * Joins a task with its epic + project so the Settings UI can render the
 * "Project · Epic · Title" chip and pre-fill the task number on mount.
 * Returns null if any join step fails (deleted task / dangling epic).
 */
function resolveTaskByNumberPayload(
  row: { id: number; number: string; title: string; status: 'open' | 'in_progress' | 'to_accept' | 'done'; epicId: number } | null,
) {
  if (!row) return null;
  const epic = epicsRepo().get(row.epicId);
  if (!epic) return null;
  const project = projectsRepo().get(epic.projectId);
  if (!project) return null;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    epicId: epic.id,
    epicName: epic.name,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
  };
}

function worklogsRepo(): WorklogsRepo {
  return new WorklogsRepo(handle!.db);
}

function autoTimeLogger(): AutoTimeLogger {
  return new AutoTimeLogger(handle!.db, notifySync);
}

/**
 * Tasks with local status='done' are read-only — see board-screen requirement
 * that done work cannot be edited or have its worklogs touched. Throws a
 * plain Error so the renderer's existing catch-and-toast path surfaces it.
 * The board sync intentionally bypasses this (writes via repo directly) so
 * Jira can still flip a task back open or update its description.
 */
function assertTaskNotDone(taskId: number, op: string): void {
  const existing = tasksRepo().get(taskId);
  if (existing && existing.status === 'done') {
    throw new Error(
      `Cannot ${op}: task ${existing.number} is marked Done and is locked.`,
    );
  }
}

function projectRatesRepo(): ProjectRatesRepo {
  return new ProjectRatesRepo(handle!.db);
}

function contractStatusService(): ContractStatusService {
  return new ContractStatusService(handle!.db);
}

function contractViewOf(rate: ProjectRateRow): {
  id: number;
  projectId: number;
  effectiveFrom: string;
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
  createdAt: string;
  minutesLogged: number;
  mdsUsed: number;
  mdsRemaining: number | null;
  elapsedWorkdays: number;
  totalWorkdays: number | null;
  workdaysRemaining: number | null;
  projectedTotalMds: number | null;
  isActive: boolean;
  isCompleted: boolean;
  groupId: string | null;
  projectIds: number[];
} {
  const status = contractStatusService().forRate(rate);
  return {
    id: rate.id,
    projectId: rate.projectId,
    effectiveFrom: rate.effectiveFrom,
    endDate: rate.endDate,
    rateType: rate.rateType,
    rateAmount: rate.rateAmount,
    hoursPerDay: rate.hoursPerDay,
    mdLimit: rate.mdLimit,
    createdAt: rate.createdAt,
    minutesLogged: status.minutesLogged,
    mdsUsed: status.mdsUsed,
    mdsRemaining: status.mdsRemaining,
    elapsedWorkdays: status.elapsedWorkdays,
    totalWorkdays: status.totalWorkdays,
    workdaysRemaining: status.workdaysRemaining,
    projectedTotalMds: status.projectedTotalMds,
    isActive: status.isActive,
    isCompleted: status.isCompleted,
    groupId: rate.contractGroupId,
    projectIds: rate.contractGroupId
      ? projectRatesRepo().listGroupMembers(rate.contractGroupId)
      : [rate.projectId],
  };
}

/**
 * Builds the `GroupTerms` shared by every member of a contract (group or
 * solo). `fallback` supplies defaults for fields missing from a partial
 * update payload — mirrors the per-field fallback that `ProjectRatesRepo.update`
 * already does at the SQL level, but `updateGroup` needs a complete term set
 * up front since it applies identical terms to every member row.
 */
function termsOf(
  payload: {
    effectiveFrom?: string;
    rateType?: 'hourly' | 'daily';
    rateAmount?: number;
    hoursPerDay?: number;
    endDate?: string | null;
    mdLimit?: number | null;
  },
  fallback?: ProjectRateRow,
): GroupTerms {
  return {
    effectiveFrom: payload.effectiveFrom ?? fallback!.effectiveFrom,
    rateType: payload.rateType ?? fallback!.rateType,
    rateAmount: payload.rateAmount ?? fallback!.rateAmount,
    hoursPerDay: payload.hoursPerDay ?? fallback?.hoursPerDay,
    endDate: payload.endDate !== undefined ? payload.endDate : fallback?.endDate ?? null,
    mdLimit: payload.mdLimit !== undefined ? payload.mdLimit : fallback?.mdLimit ?? null,
  };
}

/** Shapes a caught `RateOverlapError` into the wire overlap-error payload, resolving the conflicting project's name. */
function overlapResponse(err: RateOverlapError): OrchOverlapError {
  return {
    error: 'overlap',
    conflictingId: err.conflictingId,
    conflictingFrom: err.conflictingFrom,
    conflictingTo: err.conflictingTo,
    conflictingProjectId: err.conflictingProjectId,
    conflictingProjectName: new ProjectsRepo(handle!.db).get(err.conflictingProjectId)?.name ?? '',
  };
}

function projectViewOf(row: ProjectRow): ProjectRow {
  // The repo row already matches the wire shape; this is a no-op identity that
  // exists so we can refactor the wire format separately from the repo without
  // touching every call site. (Phase 22 may rename `kind`/`is_billable`.)
  return row;
}

function noteViewOf(r: NoteRow): NoteViewPayload {
  return {
    id: r.id, title: r.title, body: r.body, done: r.done, doneAt: r.doneAt,
    dueDate: r.dueDate, priority: r.priority, pinned: r.pinned,
    projectId: r.projectId, projectName: r.projectName, projectColor: r.projectColor,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function statusOf(id: string): InstanceStatus {
  return repo().get(id)?.status ?? 'crashed';
}

function applyTransition(instanceId: string, event: StateEvent): void {
  const inst = repo().get(instanceId);
  if (!inst) return;
  const prevStatus = inst.status;
  const result = transition(prevStatus, event);
  const isShell = inst.kind === 'shell';
  if (result.state !== prevStatus) {
    repo().updateStatus(instanceId, result.state, Date.now());
    emitPush({ kind: 'stateChanged', payload: { instanceId, status: result.state } });
    if (notifier) notifier.apply(instanceId, inst.cwd, prevStatus, result.state, Date.now());
    if (!isShell) escalationGate?.apply(instanceId, inst.cwd, prevStatus, result.state);
  }
  for (const out of result.outputs) {
    if (out.kind === 'storeClaudeSessionId') {
      repo().setClaudeSessionId(instanceId, out.sessionId);
    } else if (out.kind === 'startQuietTimer') {
      if (!isShell) quietTimers?.start(instanceId);
    } else if (out.kind === 'clearQuietTimer') {
      quietTimers?.clear(instanceId);
    } else if (out.kind === 'clearAttention') {
      notifier?.clearAttention(instanceId);
      escalationGate?.clear(instanceId);
    }
  }
}

/**
 * Inject a remote reply into a live pty as if the user typed it, then advance
 * the state machine via `userPromptSubmit`. Returns false if the instance has
 * no live pty session (the caller still stamps the message as handled).
 */
function deliverReply(instanceId: string, text: string): boolean {
  const session = pty.get(instanceId);
  if (!session) return false;
  session.write(text + '\r');
  applyTransition(instanceId, { kind: 'userPromptSubmit' });
  return true;
}

function mapHookEventToStateEvent(name: string, body: unknown): StateEvent | null {
  const b = body as { session_id?: string } | undefined;
  switch (name) {
    case 'SessionStart':
      return { kind: 'sessionStart', sessionId: b?.session_id ?? '' };
    case 'UserPromptSubmit':
      return { kind: 'userPromptSubmit' };
    case 'Notification':
      return { kind: 'notificationHook' };
    case 'Stop':
      return { kind: 'stopHook' };
    case 'SessionEnd':
      return { kind: 'sessionEnd' };
    default:
      return null;
  }
}

/** Kill the pty (if any), delete the row + child rows, and clear timer state. */
function disposeInstanceRow(id: string): void {
  try {
    pty.get(id)?.kill();
  } catch {
    /* pty already dead */
  }
  new HookEventsRepo(handle!.db).deleteForInstance(id);
  new NotificationsRepo(handle!.db).deleteForInstance(id);
  repo().delete(id);
  escalationGate?.clear(id);
  void attentionRelay?.closeThread(id);
  terminalSnapshots.dispose(id);
  ptySizeOwnership.disposeInstance(id);
}

interface PtySpawnArgs {
  id: string;
  cwd: string;
  extraArgs: string[];
  kind: InstanceKind;
  /** Claude only: spawn via `claude --resume <id>` instead of `--session-id <id>`. */
  resumeSessionId?: string;
}

const RESUME_FAIL_FAST_MS = 2000;

function spawnPtyForInstance(opts: PtySpawnArgs): void {
  const cfg = buildPtySpawnConfig({
    kind: opts.kind,
    id: opts.id,
    extraArgs: opts.extraArgs,
    resumeSessionId: opts.resumeSessionId,
  });
  const spawnedAt = Date.now();
  pty.spawn({
    id: opts.id,
    command: cfg.command,
    args: cfg.args,
    cwd: opts.cwd,
    env: cfg.env,
    onData: (chunk) => {
      terminalSnapshots.feed(opts.id, chunk);
      emitPush({ kind: 'ptyData', payload: { instanceId: opts.id, chunk } });
      authBlockDetector.onPtyChunk(opts.id, chunk);
      applyTransition(opts.id, { kind: 'ptyData' });
    },
    onExit: (code) => {
      if (opts.kind === 'shell') {
        emitPush({ kind: 'ptyExit', payload: { instanceId: opts.id, code } });
        if (code === 0) {
          // Clean exit (user typed `exit`) → drop the row; the renderer's
          // deriveTabs prune removes the now-orphaned column automatically.
          disposeInstanceRow(opts.id);
        } else {
          const r = repo();
          if (r.get(opts.id)) {
            r.setTermination(opts.id, 'crash', code);
            r.updateStatus(opts.id, 'crashed', Date.now());
          }
        }
        emitPush({ kind: 'stateChanged', payload: { instanceId: opts.id, status: code === 0 ? 'finished' : 'crashed' } });
        return;
      }
      const lifespan = Date.now() - spawnedAt;
      // If --resume exits fast, the session probably never had any persisted
      // content (e.g. the user closed the app right after launching claude,
      // before sending any prompt). Claude has nothing to restore — and may
      // exit either with code 0 ("session not found, nothing to do") or
      // non-zero, depending on the build. Either way, no human could have
      // interacted with it in under RESUME_FAIL_FAST_MS, so fall back to a
      // fresh spawn in the same cwd, reusing the same row id + session id
      // (via --session-id) so future resumes still work.
      if (opts.resumeSessionId && lifespan < RESUME_FAIL_FAST_MS) {
        console.log(
          `[orchestrator] resume exited fast for ${opts.id} (code ${code} in ${lifespan}ms) — spawning fresh`,
        );
        // Start the fresh process with a clean snapshot buffer (the failed
        // resume's brief output shouldn't carry into the new session's screen).
        terminalSnapshots.dispose(opts.id);
        ptySizeOwnership.disposeInstance(opts.id);
        spawnPtyForInstance({
          id: opts.id,
          cwd: opts.cwd,
          extraArgs: opts.extraArgs,
          kind: 'claude',
          // no resumeSessionId — break the recursion guard, full fresh spawn
        });
        return;
      }
      emitPush({ kind: 'ptyExit', payload: { instanceId: opts.id, code } });
      const r = repo();
      const inst = r.get(opts.id);
      if (inst) {
        // Record termination metadata, then run the FULL transition via
        // applyTransition so the notifier + escalation gate fan-out fires for
        // finished/crashed exits. (A bare transition()+updateStatus() here would
        // update the row but never notify — leaving the crash trigger dead.)
        r.setTermination(opts.id, code === 0 ? 'session-end' : 'crash', code);
        applyTransition(opts.id, { kind: 'ptyExit', code });
      }
    },
  });
}

export async function handleRequest(req: OrchRequest, origin: string = LOCAL_CLIENT): Promise<OrchResponse['payload']> {
  switch (req.kind) {
    case 'ping':
      return { now: req.payload.now, orch: Date.now() };

    case 'spawnInstance': {
      const id = randomUUID();
      const now = Date.now();
      const instanceKind: InstanceKind = req.payload.instanceKind ?? 'claude';
      const expandedCwd = req.payload.cwd.startsWith('~/')
        ? path.join(homedir(), req.payload.cwd.slice(2))
        : req.payload.cwd === '~'
        ? homedir()
        : req.payload.cwd;
      try {
        repo().insert({
          id,
          cwd: expandedCwd,
          // Shells have no SessionStart handshake, so they start live ('working')
          // and never show the spinner. Claude starts 'spawning' until the hook.
          status: instanceKind === 'shell' ? 'working' : 'spawning',
          // Claude: --session-id <uuid> => session id matches row id. Shells: none.
          claudeSessionId: instanceKind === 'shell' ? null : id,
          spawnedAt: now,
          lastActivityAt: now,
          exitCode: null,
          terminationReason: null,
          resumedFromInstanceId: null,
          jiraKeyHint: null,
          argsJson: req.payload.args ? JSON.stringify(req.payload.args) : null,
          kind: instanceKind,
          taskId: null,
          worktreePath: null,
        });
        spawnPtyForInstance({ id, cwd: expandedCwd, extraArgs: req.payload.args ?? [], kind: instanceKind });
        return { instanceId: id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[orchestrator] spawnInstance failed:', message);
        try {
          repo().updateStatus(id, 'crashed', Date.now());
          repo().setTermination(id, 'crash', null);
        } catch {
          /* row may not have been inserted yet */
        }
        return { instanceId: null, error: message };
      }
    }

    case 'ptyWrite':
      pty.get(req.payload.instanceId)?.write(req.payload.data);
      return { ok: true };

    case 'ptyResize': {
      const { instanceId, cols, rows } = req.payload;
      const decision = ptySizeOwnership.recordResize(instanceId, origin, cols, rows);
      terminalSnapshots.resize(instanceId, cols, rows);
      if (decision.apply) pty.get(instanceId)?.resize(cols, rows);
      return { ok: true };
    }

    case 'terminalFocus':
      ptySizeOwnership.focus(req.payload.instanceId, origin);
      return { ok: true };

    case 'terminalAttach': {
      const getDims = (id: string) => {
        const h = pty.get(id);
        return h ? { cols: h.cols, rows: h.rows } : null;
      };
      await terminalSnapshots.flush(req.payload.instanceId);
      return buildTerminalAttachResponse(terminalSnapshots, req.payload.instanceId, getDims);
    }

    case 'killInstance':
      pty.get(req.payload.instanceId)?.kill();
      terminalSnapshots.dispose(req.payload.instanceId);
      ptySizeOwnership.disposeInstance(req.payload.instanceId);
      return { ok: true };

    case 'removeInstance': {
      const removedId = req.payload.instanceId;
      disposeInstanceRow(removedId);
      // Notify all clients so they refetch and drop the removed instance.
      // Clients refetch the instance list on any stateChanged; without this the
      // removed instance lingers in stale lists (e.g. the iPad's project
      // grouping and pane picker still offer it).
      emitPush({ kind: 'stateChanged', payload: { instanceId: removedId, status: 'finished' } });
      return { ok: true };
    }

    case 'restartInstance': {
      const row = repo().get(req.payload.instanceId);
      if (!row) return { ok: false };
      // Re-spawn a fresh process into the SAME row id. Shells re-run the login
      // shell; claude rows resume via the row's session id.
      terminalSnapshots.dispose(row.id);
      ptySizeOwnership.disposeInstance(row.id);
      repo().updateStatus(row.id, row.kind === 'shell' ? 'working' : 'spawning', Date.now());
      repo().setTermination(row.id, null, null);
      spawnPtyForInstance({
        id: row.id,
        cwd: row.cwd,
        extraArgs: [],
        kind: row.kind,
        resumeSessionId: row.kind === 'claude' ? (resolveResumeTarget(row) ?? undefined) : undefined,
      });
      emitPush({ kind: 'stateChanged', payload: { instanceId: row.id, status: row.kind === 'shell' ? 'working' : 'spawning' } });
      return { ok: true };
    }

    case 'reorderInstances':
      repo().reorder(req.payload.orderedIds);
      return { ok: true };

    case 'listInstances': {
      const rows = repo().listAll();
      return {
        instances: rows.map((r) => ({
          id: r.id,
          cwd: r.cwd,
          status: r.status,
          lastActivityAt: r.lastActivityAt,
          kind: r.kind,
          taskId: r.taskId,
        })),
      };
    }

    case 'getSetting': {
      const value = new SettingsRepo(handle!.db).getString(req.payload.key, '') || null;
      return { value };
    }

    case 'setSetting': {
      new SettingsRepo(handle!.db).set(req.payload.key, req.payload.value);
      if (req.payload.key === 'quiet_timer_ms' && quietTimers) {
        const n = Number(req.payload.value);
        if (Number.isFinite(n) && n >= 1000) quietTimers.setDuration(n);
      }
      if (req.payload.key === WORKLOG_LOCK_SETTING_KEY) {
        const v = req.payload.value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          tasksRepo().markToAcceptDoneOnOrBefore(v);
          // Flipping to_accept→done on tasks is a synced-table mutation.
          notifySync();
        }
      }
      return { ok: true };
    }

    case 'hub:getConfig':
      return { config: readHubConfig(new SettingsRepo(handle!.db)) };

    case 'hub:setConfig':
      writeHubConfig(new SettingsRepo(handle!.db), req.payload.config);
      return { ok: true };

    case 'windowFocusChanged': {
      const { focused } = req.payload;
      escalationGate?.setWindowFocused(focused);
      notifier?.setWindowFocused(focused);
      if (focused) {
        // Returning to the window acknowledges the instance the user is now
        // looking at — same as landing on its tab. The tabFocused transition
        // emits clearAttention, dropping its dot + badge and cancelling any
        // pending escalation. Background tabs stay flagged until actually visited.
        const activeId = notifier?.focusedId() ?? null;
        if (activeId) applyTransition(activeId, { kind: 'tabFocused' });
      }
      return { ok: true };
    }

    case 'previewHookInstall':
      return previewHookInstall(userSettingsPath(), resolveHelperPath());

    case 'installHooks': {
      const result = ensureHooksInstalled(userSettingsPath(), resolveHelperPath());
      return { changed: result.changed, backedUp: result.backedUp };
    }

    case 'uninstallHooks':
      return uninstallHooks(userSettingsPath(), resolveHelperPath());

    case 'snooze':
      notifier?.snooze(req.payload.instanceId, req.payload.untilMs);
      return { ok: true };

    case 'focusChanged': {
      const focusedId = req.payload.instanceId;
      notifier?.setFocused(focusedId);
      // Treat the user landing on an instance's tab as an explicit
      // acknowledgement — the state machine's tabFocused transition emits
      // clearAttention, which drops the row from the badge count and
      // updates the dock + tray.
      if (focusedId) applyTransition(focusedId, { kind: 'tabFocused' });
      return { ok: true };
    }

    case 'projects:list': {
      const filter = req.payload as ProjectListFilter;
      const rows = projectsRepo().list(filter);
      return { projects: rows.map(projectViewOf) };
    }

    case 'projects:get': {
      const row = projectsRepo().get(req.payload.id);
      return { project: row ? projectViewOf(row) : null };
    }

    case 'projects:create': {
      const input = req.payload as ProjectInput;
      const row = projectsRepo().create(input);
      notifySync();
      return { project: projectViewOf(row) };
    }

    case 'projects:update': {
      const row = projectsRepo().update(req.payload.id, req.payload.input as Partial<ProjectInput>);
      notifySync();
      return { project: projectViewOf(row) };
    }

    case 'projects:archive': {
      projectsRepo().archive(req.payload.id, req.payload.archived);
      notifySync();
      return { ok: true };
    }

    case 'projects:delete': {
      projectsRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };
    }

    case 'notes:list': {
      const rows = notesRepo().list(req.payload as NoteListFilter);
      return { notes: rows.map(noteViewOf) };
    }
    case 'notes:create': {
      const row = notesRepo().create(req.payload as NoteInput);
      notifySync();
      return { note: noteViewOf(row) };
    }
    case 'notes:update': {
      const row = notesRepo().update(req.payload.id, req.payload.input as Partial<NoteInput>);
      notifySync();
      return { note: noteViewOf(row) };
    }
    case 'notes:delete': {
      notesRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };
    }

    case 'epics:list':
      return { epics: epicsRepo().listForProject(req.payload.projectId) };

    case 'epics:listAll':
      return { epics: epicsRepo().listAll() };

    case 'epics:create': {
      const epic = epicsRepo().create(req.payload as EpicInput);
      notifySync();
      return { epic };
    }

    case 'epics:update': {
      const epic = epicsRepo().update(req.payload.id, req.payload.input as Partial<EpicInput>);
      notifySync();
      return { epic };
    }

    case 'epics:reorder':
      epicsRepo().reorder(req.payload.projectId, req.payload.orderedIds);
      notifySync();
      return { ok: true };

    case 'epics:delete':
      epicsRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };

    case 'tasks:listForEpic':
      return { tasks: tasksRepo().listForEpic(req.payload.epicId) };

    case 'tasks:listForProject':
      return { tasks: tasksRepo().listForProject(req.payload.projectId) };

    case 'tasks:findByNumber':
      return { task: resolveTaskByNumberPayload(tasksRepo().findByNumber(req.payload.number.trim())) };

    case 'tasks:findById':
      return { task: resolveTaskByNumberPayload(tasksRepo().get(req.payload.id)) };

    case 'tasks:create': {
      const task = tasksRepo().create(req.payload as TaskInput);
      notifySync();
      return { task };
    }

    case 'tasks:update': {
      // Block all user edits on a done task. Status field is the only one
      // a user could plausibly want to change (to re-open), and we still
      // disallow it — Jira is the source of truth for "is this done".
      assertTaskNotDone(req.payload.id, 'edit task');
      const task = tasksRepo().update(req.payload.id, req.payload.input as Partial<TaskInput>);
      notifySync();
      return { task };
    }

    case 'tasks:delete':
      assertTaskNotDone(req.payload.id, 'delete task');
      tasksRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };

    case 'worklogs:list':
      return { worklogs: worklogsRepo().list(req.payload as WorklogListFilter) };

    case 'worklogs:create': {
      const input = req.payload as WorklogInput;
      assertTaskNotDone(input.taskId, 'add worklog');
      const worklog = worklogsRepo().create(input);
      notifySync();
      return { worklog };
    }

    case 'worklogs:update': {
      const existing = worklogsRepo().get(req.payload.id);
      if (existing) assertTaskNotDone(existing.taskId, 'edit worklog');
      const worklog = worklogsRepo().update(
        req.payload.id,
        req.payload.input as Partial<WorklogInput>,
      );
      notifySync();
      return { worklog };
    }

    case 'worklogs:delete': {
      const existing = worklogsRepo().get(req.payload.id);
      if (existing) assertTaskNotDone(existing.taskId, 'delete worklog');
      worklogsRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };
    }

    case 'contracts:listForProject': {
      const rows = projectRatesRepo().listForProject(req.payload.projectId);
      return { contracts: rows.map(contractViewOf) };
    }

    case 'contracts:create': {
      const payload = req.payload;
      const ids = payload.projectIds && payload.projectIds.length > 0 ? payload.projectIds : [payload.projectId];
      try {
        if (ids.length > 1) {
          const { rows } = projectRatesRepo().createGroup(termsOf(payload), ids);
          const first = rows[0];
          if (!first) throw new Error('createGroup returned no rows');
          for (const r of rows) markWorklogsForRebill(handle!.db, r.projectId, r.effectiveFrom, nowIso());
          notifySync();
          return { contract: contractViewOf(first) };
        }
        const row = projectRatesRepo().create({ ...termsOf(payload), projectId: ids[0] ?? payload.projectId });
        markWorklogsForRebill(handle!.db, row.projectId, row.effectiveFrom, nowIso());
        notifySync();
        return { contract: contractViewOf(row) };
      } catch (err) {
        if (err instanceof RateOverlapError) return overlapResponse(err);
        throw err;
      }
    }

    case 'contracts:update': {
      try {
        const repo = projectRatesRepo();
        const oldRow = repo.get(req.payload.id);
        const input = req.payload.input;
        if (oldRow?.contractGroupId) {
          const groupId = oldRow.contractGroupId;
          // Capture the OLD membership before updateGroup soft-deletes any
          // dropped project's row — needed below to rebill projects that get
          // unchecked from the group (updateGroup only returns kept+added rows).
          const oldMembers = repo.listGroupMembers(groupId);
          const ids = input.projectIds && input.projectIds.length > 0 ? input.projectIds : oldMembers;
          const rows = repo.updateGroup(groupId, termsOf(input, oldRow), ids);
          const first = rows[0];
          if (!first) throw new Error('updateGroup returned no rows');
          // All group members shared `oldRow.effectiveFrom` prior to this edit
          // (createGroup/updateGroup keep terms uniform across members), so it's
          // the correct "old" anchor for every member's rebill window.
          for (const r of rows) {
            const fromDate = r.effectiveFrom < oldRow.effectiveFrom ? r.effectiveFrom : oldRow.effectiveFrom;
            markWorklogsForRebill(handle!.db, r.projectId, fromDate, nowIso());
          }
          // A project unchecked from the group is soft-deleted by updateGroup
          // but never appears in `rows` — without this it keeps stale
          // earned_amount/resolved_rate from the old pooled terms. Rebill it
          // too, anchored on the same old effectiveFrom every member shared.
          const keptIds = new Set(rows.map((r) => r.projectId));
          for (const projectId of oldMembers) {
            if (!keptIds.has(projectId)) {
              markWorklogsForRebill(handle!.db, projectId, oldRow.effectiveFrom, nowIso());
            }
          }
          notifySync();
          return { contract: contractViewOf(first) };
        }
        // Solo → shared-group promotion: the contract has no group yet, but the
        // edit lists more than one project (the user added shared members via
        // the drawer). Mint a group anchored on this row and attach the added
        // projects. Without this, the plain update below silently drops
        // `projectIds` and no link is created.
        if (oldRow && input.projectIds && input.projectIds.length > 1) {
          const rows = repo.promoteToGroup(req.payload.id, termsOf(input, oldRow), input.projectIds).rows;
          const first = rows.find((r) => r.id === req.payload.id) ?? rows[0];
          if (!first) throw new Error('promoteToGroup returned no rows');
          for (const r of rows) {
            const fromDate = r.effectiveFrom < oldRow.effectiveFrom ? r.effectiveFrom : oldRow.effectiveFrom;
            markWorklogsForRebill(handle!.db, r.projectId, fromDate, nowIso());
          }
          notifySync();
          return { contract: contractViewOf(first) };
        }
        const row = repo.update(req.payload.id, input as Partial<ProjectRateInput>);
        // Use the earliest effective_from so moving a contract earlier also
        // re-bills the newly-covered range.
        const newFrom = input.effectiveFrom;
        const fromDate =
          oldRow && newFrom && newFrom < oldRow.effectiveFrom
            ? newFrom
            : (oldRow?.effectiveFrom ?? row.effectiveFrom);
        markWorklogsForRebill(handle!.db, row.projectId, fromDate, nowIso());
        notifySync();
        return { contract: contractViewOf(row) };
      } catch (err) {
        if (err instanceof RateOverlapError) return overlapResponse(err);
        throw err;
      }
    }

    case 'contracts:delete': {
      const delRepo = projectRatesRepo();
      const delRow = delRepo.get(req.payload.id);
      if (delRow?.contractGroupId) {
        const groupId = delRow.contractGroupId;
        const members = delRepo.listGroupMembers(groupId);
        delRepo.deleteGroup(groupId);
        for (const projectId of members) {
          markWorklogsForRebill(handle!.db, projectId, delRow.effectiveFrom, nowIso());
        }
      } else {
        delRepo.delete(req.payload.id);
        if (delRow) {
          markWorklogsForRebill(handle!.db, delRow.projectId, delRow.effectiveFrom, nowIso());
        }
      }
      notifySync();
      return { ok: true };
    }

    case 'taskGrid:get': {
      const { year, month, projectIds } = req.payload;
      const service = new TaskGridService(handle!.db);
      return service.get(year, month, projectIds);
    }

    case 'daysOff:list':
      return { daysOff: new DaysOffRepo(handle!.db).listAll() };

    case 'daysOff:listInRange':
      return {
        daysOff: new DaysOffRepo(handle!.db).listInRange(req.payload.from, req.payload.to),
      };

    case 'daysOff:upsert': {
      const dayOff = new DaysOffRepo(handle!.db).upsert(req.payload as DayOffInput);
      notifySync();
      return { dayOff };
    }

    case 'daysOff:delete':
      new DaysOffRepo(handle!.db).delete(req.payload.date);
      notifySync();
      return { ok: true };

    case 'holidays:list': {
      const map = czechHolidays(req.payload.year);
      const holidays = Array.from(map, ([date, name]) => ({ date, name }));
      holidays.sort((a, b) => a.date.localeCompare(b.date));
      return { holidays };
    }

    case 'reports:trend':
      return {
        trend: new ReportsService(handle!.db).trend(
          req.payload.from,
          req.payload.to,
          req.payload.granularity,
          req.payload.projectId,
        ),
      };

    case 'reports:byProject':
      return {
        byProject: new ReportsService(handle!.db).byProject(
          req.payload.from,
          req.payload.to,
          req.payload.projectId,
        ),
      };

    case 'reports:earnings':
      return new ReportsService(handle!.db).earnings(
        req.payload.from,
        req.payload.to,
        req.payload.projectId,
      );

    case 'reports:heatmap':
      return {
        heatmap: new ReportsService(handle!.db).heatmap(
          req.payload.from,
          req.payload.to,
          req.payload.projectId,
        ),
      };

    case 'reports:contracts':
      return { contracts: new ReportsService(handle!.db).contracts(req.payload.projectId) };

    case 'reports:rateChanges':
      return {
        rateChanges: new ReportsService(handle!.db).rateChanges(
          req.payload.from,
          req.payload.to,
          req.payload.projectId,
        ),
      };

    case 'dashboard:overview':
      return new DashboardOverviewService(handle!.db).run(req.payload);

    case 'instances:findByCwd': {
      const expanded = req.payload.cwd.startsWith('~/')
        ? path.join(homedir(), req.payload.cwd.slice(2))
        : req.payload.cwd === '~'
          ? homedir()
          : req.payload.cwd;
      const rows = repo().liveByCwd(expanded);
      return {
        instances: rows.map((r) => ({
          id: r.id,
          cwd: r.cwd,
          status: r.status,
          lastActivityAt: r.lastActivityAt,
          jiraKeyHint: r.jiraKeyHint,
          taskId: r.taskId,
        })),
      };
    }

    case 'instances:setTask': {
      const { instanceId, taskId } = req.payload;
      repo().setTask(instanceId, taskId);
      const inst = repo().get(instanceId);
      if (inst) {
        emitPush({ kind: 'stateChanged', payload: { instanceId, status: inst.status } });
      }
      return { ok: true as const };
    }

    case 'claudeSettings:read': {
      return readSettings(req.payload.scope, req.payload.projectPath);
    }

    case 'claudeSettings:write': {
      return writeSettings(req.payload.scope, req.payload.projectPath, req.payload.content);
    }

    case 'skills:list': {
      return { skills: listSkills() };
    }

    case 'agents:list': {
      return { agents: listAgents() };
    }

    case 'jira:syncPreview':
      return new JiraSyncService(handle!.db).preview(req.payload);

    case 'jira:sync': {
      const jiraResult = await new JiraSyncService(handle!.db).sync(req.payload);
      notifySync();
      return jiraResult;
    }

    case 'board:authPing':
      return new JiraBoardService(handle!.db).authPing();

    case 'board:get':
      return new JiraBoardService(handle!.db).getSnapshot(req.payload.projectId);

    case 'board:sync': {
      const svc = new JiraBoardService(handle!.db);
      const result = await svc.sync(req.payload.projectId);
      const snapshot = { ...svc.getSnapshot(req.payload.projectId), lastSyncResult: result };
      notifySync();
      return { snapshot, result };
    }

    case 'board:remove': {
      new TasksRepo(handle!.db).clearJiraStatus(req.payload.taskId);
      notifySync();
      return { snapshot: new JiraBoardService(handle!.db).getSnapshot(req.payload.projectId) };
    }

    case 'tokens:usage':
      // Return the cached snapshot immediately; refresh in the background if we
      // don't have one yet (first call before the poll timer has fired).
      return latestTokenUsage ?? (await refreshTokenUsage());

    case 'rateLimits:usage':
      return latestRateLimits as RateLimitsPayload;

    case 'statuslineCapture:status':
      return captureStatus(userSettingsPath(), resolveStatuslineHelperPath());

    case 'statuslineCapture:set': {
      const helper = resolveStatuslineHelperPath();
      const p = userSettingsPath();
      const kv = new SettingsRepo(handle!.db);
      return req.payload.enabled ? enableCapture(p, helper, kv) : disableCapture(p, helper, kv);
    }

    case 'push:registerDevice':
      new PushDevicesRepo(handle!.db).register(
        req.payload.token, req.payload.platform, Date.now(), req.payload.bundleId,
      );
      return { ok: true };

    case 'prs:list':
      return reviewsSvc().list();
    case 'prs:refresh':
      return reviewsSvc().refresh((req.payload as { devopsPats?: Record<string, string> }).devopsPats);
    case 'prs:diff': {
      const p = req.payload as { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> };
      return { files: await reviewsSvc().diff(p.host, p.repoKey, p.prNumber, p.devopsPats) };
    }
    case 'prs:comments': {
      const p = req.payload as { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> };
      return { threads: await reviewsSvc().comments(p.host, p.repoKey, p.prNumber, p.devopsPats) };
    }
    case 'prs:merge': {
      const p = req.payload as { host: PrHost; repoKey: string; prNumber: number; deleteBranch: boolean; devopsPats?: Record<string, string> };
      if (p.host === 'github') {
        // github repoKey is `gh:<owner>/<name>`; `gh pr merge` needs the bare nwo.
        // Resolve the config so we use its authoritative `.nwo` rather than
        // re-parsing the key.
        const { github } = await reviewsSvc().resolveRepos();
        const repo = github.find((r) => r.repoKey === p.repoKey);
        if (!repo) throw new Error(`Cannot resolve GitHub repo for merge: ${p.repoKey}`);
        await mergeGithubPr(repo.nwo, p.prNumber, p.deleteBranch);
      } else {
        const target = await reviewsSvc().azdoMergeTarget(p.repoKey, p.prNumber, p.devopsPats);
        const pat = p.devopsPats?.[target.devopsHost];
        if (!pat) throw new Error(`Missing DevOps PAT for ${target.devopsHost}`);
        await mergeAzdoPr(target.apiBase, target.repo, p.prNumber, target.lastMergeSourceCommitId, p.deleteBranch, pat);
      }
      return { ok: true };
    }
    case 'prs:reviewState': {
      const p = req.payload as { host: PrHost; repoKey: string; number: number; devopsPats?: Record<string, string> };
      return reviewsSvc().reviewState(p.host, p.repoKey, p.number, p.devopsPats);
    }
    case 'prs:approve': {
      const p = req.payload as { host: PrHost; repoKey: string; number: number; devopsPats?: Record<string, string> };
      return reviewsSvc().approve(p.host, p.repoKey, p.number, p.devopsPats);
    }
    case 'prs:close': {
      const p = req.payload as { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> };
      return reviewsSvc().close(p.host, p.repoKey, p.prNumber, p.devopsPats);
    }
    case 'reviews:projectRepo':
      return reviewsSvc().projectRepo((req.payload as { projectId: number }).projectId);

    case 'prReview:start': {
      const p = req.payload;
      const target = await reviewsSvc().resolveRepoAndPr(p.host, p.repoKey, p.prNumber);
      if (!target) {
        throw new Error(`Cannot resolve repo/PR for review: ${p.host}:${p.repoKey}#${p.prNumber}`);
      }
      const reviews = prReviewsRepo();
      const id = reviews.start(p.host, p.repoKey, p.prNumber, target.headSha);
      emitPush({ kind: 'prReviewProgress', payload: { reviewId: id, status: 'running', message: 'Reviewing...' } });
      const ac = new AbortController();
      runningReviews.set(id, ac);
      // Fire-and-forget: the caller gets `reviewId` immediately and follows
      // progress via the prReviewProgress/prReviewDone pushes.
      // Azure DevOps PRs are Škoda work read by a Czech-speaking team, so their
      // review findings are written in Czech; GitHub PRs stay English.
      runReview(target.clonePath, target.baseRef, target.headSha, target.pr, {}, ac.signal, p.host === 'azdo' ? 'cs' : 'en')
        .then(({ summary, findings }) => {
          reviews.finish(id, summary, JSON.stringify(findings));
          emitPush({ kind: 'prReviewProgress', payload: { reviewId: id, status: 'done', message: summary } });
          emitPush({ kind: 'prReviewDone', payload: { reviewId: id } });
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          reviews.fail(id, msg);
          emitPush({ kind: 'prReviewProgress', payload: { reviewId: id, status: 'error', message: msg } });
        })
        .finally(() => { runningReviews.delete(id); });
      return { reviewId: id };
    }

    case 'prImplement:start': {
      const p = req.payload;
      // Reuse the review resolver to get the local clone path + the PR's source
      // branch (it also fetches, harmlessly). Then resolve the repoLabel for the
      // prompt from resolveRepos().
      const target = await reviewsSvc().resolveRepoAndPr(p.host, p.repoKey, p.prNumber);
      if (!target) throw new Error(`Cannot resolve repo/PR: ${p.host}:${p.repoKey}#${p.prNumber}`);
      const { github, azdo } = await reviewsSvc().resolveRepos();
      const repoCfg = (p.host === 'github' ? github : azdo).find((r) => r.repoKey === p.repoKey);
      const baseDir = path.join(homedir(), '.watchtower', 'worktrees');
      const launch = await prepareImplementLaunch(
        { host: p.host, repoKey: p.repoKey, number: p.prNumber, title: target.pr.title,
          repoLabel: repoCfg?.repoLabel ?? '', sourceBranch: target.pr.sourceBranch, clonePath: target.clonePath },
        {
          exec: (cmd, args) => defaultExec(cmd, args),
          fetchComments: () => reviewsSvc().comments(p.host, p.repoKey, p.prNumber, p.devopsPats),
          // github author = login (reliable). azdo authors are display names, not
          // reliably comparable — skip the authorship filter there.
          resolveMyAuthor: async () => (p.host === 'github' ? await resolveGithubLogin().catch(() => null) : null),
          ensureDir: (dir) => { mkdirSync(dir, { recursive: true }); },
          baseDir,
        },
      );
      // Spawn an interactive claude in the worktree, seeded with the prompt as a
      // positional arg (stays interactive; default permission mode asks before edits).
      const id = randomUUID();
      const now = Date.now();
      try {
        repo().insert({
          id, cwd: launch.worktreePath, status: 'spawning', claudeSessionId: id,
          spawnedAt: now, lastActivityAt: now, exitCode: null, terminationReason: null,
          resumedFromInstanceId: null, jiraKeyHint: null,
          argsJson: JSON.stringify([launch.prompt]), kind: 'claude', taskId: null,
          worktreePath: launch.worktreePath,
        });
        spawnPtyForInstance({ id, cwd: launch.worktreePath, extraArgs: [launch.prompt], kind: 'claude' });
        return { instanceId: id, worktreePath: launch.worktreePath };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[orchestrator] prImplement:start failed:', message);
        try {
          repo().updateStatus(id, 'crashed', Date.now());
          repo().setTermination(id, 'crash', null);
        } catch {
          /* row may not have been inserted yet */
        }
        // Best-effort: the worktree was already created by prepareImplementLaunch
        // above; if the spawn itself failed, remove it so a re-run isn't blocked
        // by "branch already checked out elsewhere".
        try {
          await defaultExec('git', ['-C', launch.worktreePath, 'worktree', 'remove', '--force', launch.worktreePath]);
        } catch {
          /* ignore */
        }
        throw err;
      }
    }

    case 'prReview:get': {
      const row = prReviewsRepo().get(req.payload.reviewId);
      return { review: row ? reviewPayloadOf(row) : null };
    }

    case 'prReview:list':
      return { reviews: prReviewsRepo().list(req.payload.repoKey).map(reviewPayloadOf) };

    case 'prReview:cancel': {
      const ac = runningReviews.get(req.payload.reviewId);
      if (ac) ac.abort();
      // Do NOT fail() the row here — aborting makes runReview() throw 'Cancelled',
      // which the .catch above already routes through the normal fail()+push path.
      return { ok: true };
    }

    case 'prReview:postComments': {
      const p = req.payload;
      const reviewId = p.reviewId;
      if (postingReviews.has(reviewId)) {
        return { posted: 0, skipped: p.findingIndexes.length, errors: ['already posting'] };
      }
      postingReviews.add(reviewId);
      try {
        const reviews = prReviewsRepo();
        const row = reviews.get(reviewId);
        if (!row) throw new Error(`Review not found: ${reviewId}`);
        let findings: PrFindingPayload[];
        try {
          findings = JSON.parse(row.findings_json ?? '[]') as PrFindingPayload[];
        } catch {
          throw new Error(`Review ${reviewId} has malformed findings JSON`);
        }
        const { github, azdo } = await reviewsSvc().resolveRepos();
        const githubRepo = row.host === 'github' ? github.find((r) => r.repoKey === row.repo_key) : undefined;
        const azdoRepo = row.host === 'azdo' ? azdo.find((r) => r.repoKey === row.repo_key) : undefined;
        if (!githubRepo && !azdoRepo) throw new Error(`Cannot resolve repo for review: ${row.host}:${row.repo_key}`);

        let posted = 0;
        let skipped = 0;
        const errors: string[] = [];
        for (const i of [...new Set(p.findingIndexes)]) {
          const f = findings[i];
          if (i < 0 || !f) { skipped++; continue; }
          if (f.posted === true) { skipped++; continue; }
          // Findings carry repo-relative paths; strip any accidental leading
          // slash before handing them to either host's poster.
          const file = f.file.replace(/^\/+/, '');
          try {
            if (githubRepo) {
              await postGithubComment(githubRepo.nwo, row.pr_number, row.head_sha, { ...f, file });
            } else if (azdoRepo) {
              const pat = p.devopsPats?.[azdoRepo.devopsHost];
              if (!pat) {
                errors.push(`${f.file}:${f.line}: Azure DevOps PAT not set or unreadable — re-enter it in Reviews settings`);
                continue;
              }
              await postAzdoComment(azdoRepo.apiBase, azdoRepo.repo, row.pr_number, { ...f, file }, pat);
            }
            f.posted = true;
            posted++;
          } catch (e) {
            errors.push(`${f.file}:${f.line}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        reviews.updateFindings(reviewId, JSON.stringify(findings));
        emitPush({ kind: 'prReviewDone', payload: { reviewId } });
        return { posted, skipped, errors };
      } finally {
        postingReviews.delete(reviewId);
      }
    }

    case 'prWatch:setPats':
      watchPats = req.payload.pats;
      return { ok: true };

    case 'prWatch:list':
      return buildInbox(handle!.db);

    case 'prWatch:markSeen': {
      const p = req.payload;
      markPrSeen(handle!.db, p.host, p.repoKey, p.prNumber);
      return { ok: true };
    }

  }
}

function respawnIncompleteRowsOnBoot(): void {
  // For every row that isn't definitely finished or definitely user-killed,
  // try to bring it back to life on app start. This covers both fresh orphans
  // (status was live when the previous orchestrator died) AND stale crashed
  // rows from older versions of this code. Strategy per row:
  //
  //   • status='finished'           → leave alone (claude exited cleanly)
  //   • termination_reason='user-kill' → leave alone (user clicked ×)
  //   • session_id present          → reset to 'spawning' then respawn via
  //                                   `claude --resume <id>`; the spawn
  //                                   helper's fast-fail fallback handles
  //                                   sessions that have nothing to restore
  //                                   by re-spawning fresh in the same cwd.
  //   • no session_id               → unrecoverable, mark crashed.
  //
  // Resetting status before respawn matters: the state machine treats
  // 'crashed' as terminal, so an incoming SessionStart hook would be
  // ignored if we left the row crashed. 'spawning' is non-terminal so the
  // state machine transitions normally as claude reconnects.
  const r = repo();
  const allRows = r.listAll();
  let respawned = 0;
  let crashed = 0;
  for (const row of allRows) {
    const action = planBootAction(row);
    if (action === 'leave') continue;
    if (action === 'crash') {
      if (row.status !== 'crashed') {
        r.updateStatus(row.id, 'crashed', Date.now());
        r.setTermination(row.id, 'crash', null);
      }
      crashed++;
      continue;
    }
    if (action === 'respawn-shell') {
      try {
        r.updateStatus(row.id, 'working', Date.now());
        r.setTermination(row.id, null, null);
        terminalSnapshots.dispose(row.id); // stale scrollback from the dead pty
        ptySizeOwnership.disposeInstance(row.id);
        spawnPtyForInstance({ id: row.id, cwd: row.cwd, extraArgs: [], kind: 'shell' });
        respawned++;
      } catch (err) {
        console.error('[orchestrator] shell respawn failed for', row.id, err);
        r.updateStatus(row.id, 'crashed', Date.now());
        r.setTermination(row.id, 'crash', null);
        crashed++;
      }
      continue;
    }
    // action === 'resume' (claude)
    try {
      r.updateStatus(row.id, 'spawning', Date.now());
      r.setTermination(row.id, null, null);
      // Prefer the stored session id, but if it's unresumable here (e.g. a row
      // contaminated by a nested-claude SessionStart before the cwd gate landed,
      // holding an id that lives under a different project dir) fall back to the
      // row's own --session-id session, or a fresh spawn. Avoids the hard
      // "No session found with ID …" error on reopen.
      const resumeSessionId = resolveResumeTarget(row) ?? undefined;
      spawnPtyForInstance({ id: row.id, cwd: row.cwd, extraArgs: [], kind: 'claude', resumeSessionId });
      respawned++;
    } catch (err) {
      console.error('[orchestrator] respawn failed for', row.id, err);
      r.updateStatus(row.id, 'crashed', Date.now());
      r.setTermination(row.id, 'resume-failed', null);
      crashed++;
    }
  }
  if (respawned + crashed > 0) {
    console.log(
      `[orchestrator] previous run: ${respawned} respawned, ${crashed} crashed (no session id)`,
    );
  }
}

(process as unknown as { parentPort?: NodeJS.EventEmitter }).parentPort?.on(
  'message',
  async (event: { data: { kind: string }; ports?: MessagePort[] }) => {
    if (event.data?.kind !== 'init' || !event.ports?.[0]) return;
    handle = await bootstrap({
      supportDir: supportDir(),
      portRange: [7421, 7430],
      handleRequest,
      onClientGone: handleClientGone,
      // attentionRelay is created below (after this bootstrap() call resolves,
      // once handle!.pg exists), so this closure reads the module-scoped
      // variable at call time — by the first daily purge tick it is set.
      onPurgeDue: () => { void attentionRelay?.pruneClosedThreads(14); },
      onHookEvent: async (eventName, body, instanceId) => {
        // Drop hook events fired by a NESTED `claude` (memory summarizer, skills,
        // sub-agents) that inherited this instance's WATCHTOWER_INSTANCE_ID but
        // runs from a different cwd. Routing them here would corrupt the managed
        // instance's state and clobber its claude_session_id with an id from a
        // foreign project dir, breaking `claude --resume` on next boot.
        const row = repo().get(instanceId);
        if (!row) return;
        if (row.kind === 'shell') return; // shells post no hooks; ignore any that arrive
        const hookCwd = (body as { cwd?: unknown } | undefined)?.cwd;
        if (!hookCwdMatches(row.cwd, hookCwd)) return;
        authBlockDetector.onHookEvent(eventName, body, instanceId);
        const stateEvent = mapHookEventToStateEvent(eventName, body);
        if (stateEvent) applyTransition(instanceId, stateEvent);
        // Auto-log this instance's active time to its project on session end
        // (no-op unless the matched project has auto_track enabled). Best-effort:
        // the service swallows its own errors so a logging failure can't break
        // the state machine.
        if (eventName === 'SessionEnd') autoTimeLogger().onSessionEnd(row);
      },
      onStatusline: (body) => {
        if (handle) onStatuslineBody(handle.db, body, Date.now());
      },
    });
    // Register the WS bridge's broadcast as the secondary push sink so every
    // emitPush reaches remote (browser) clients as well as the Electron renderer.
    setPushSink(handle.wsBridge.broadcast);

    api = new PortApi(
      event.ports[0] as unknown as ConstructorParameters<typeof PortApi>[0],
    );
    api.onRequest(async (req) => handleRequest(req as OrchRequest));

    // Wire the notifier + quiet timer now that api is available.
    notifier = new Notifier({
      notify: (p) => {
        emitPush({ kind: 'notify', payload: p });
        try {
          new NotificationsRepo(handle!.db).log(
            p.instanceId,
            p.kind,
            `Claude in ${path.basename(p.cwd) || p.cwd} ${p.kind === 'waiting-permission' ? 'needs permission' : 'is waiting'}`,
            Date.now(),
          );
        } catch {
          /* best-effort logging */
        }
      },
      clearAttention: (instanceId) => emitPush({ kind: 'clearAttention', payload: { instanceId } }),
      setBadge: (count) => emitPush({ kind: 'badge', payload: { count } }),
    });
    const settings = new SettingsRepo(handle!.db);
    const quietMs = settings.getNumber('quiet_timer_ms', DEFAULT_QUIET_MS);
    quietTimers = new QuietTimers(quietMs, (instanceId) => {
      applyTransition(instanceId, { kind: 'quietTimerFired' });
    });
    const hubSender = createHubSender({
      getConfig: () => readHubConfig(new SettingsRepo(handle!.db)),
      listTokens: async () => {
        const sqlite = new PushDevicesRepo(handle!.db).listTokens();
        const pg = await readPgPushTokens(handle!.pg);
        const seen = new Set<string>();
        const merged: { token: string; bundleId: string }[] = [];
        for (const d of [...sqlite, ...pg]) {
          if (seen.has(d.token)) continue;
          seen.add(d.token);
          merged.push(d);
        }
        return merged;
      },
      removeToken: (token) => new PushDevicesRepo(handle!.db).remove(token),
      sendApns: (cfg, token, msg, topic) => sendApns(cfg, token, msg, topic),
      buildContext: (instanceId, cwd, kind) => {
        const name = cwd.split('/').filter(Boolean).pop() || instanceId;
        const title =
          kind === 'waiting-permission' ? `${name} — permission needed` :
          kind === 'crashed' ? `${name} — instance stopped` :
          `${name} — waiting for you`;
        const body =
          kind === 'waiting-permission' ? 'Claude needs your permission to continue.' :
          kind === 'crashed' ? 'A Claude instance has stopped.' :
          'Claude is waiting for your input.';
        return { title, body };
      },
    });
    attentionRelay = createAttentionRelay({
      pg: handle!.pg,
      getSnapshot: async (id) => {
        await terminalSnapshots.flush(id);
        return terminalSnapshots.snapshot(id);
      },
      deliverReply: (id, text) => {
        const ok = deliverReply(id, text);
        if (ok) escalationGate?.markRemotelyEngaged(id);
        return ok;
      },
      resolveLabel: (cwd) => cwd.split('/').pop() ?? 'instance',
      newId: () => randomUUID(),
      now: () => new Date().toISOString(),
    });
    attentionRelay.start();
    const onEscalate = (instanceId: string, cwd: string, kind: EscalationKind) => {
      void attentionRelay?.writeClaudeMessage(instanceId, cwd, kind);
      void hubSender.fire(instanceId, cwd, kind);
    };
    escalationGate = new EscalationGate(() => {
      const hub = readHubConfig(new SettingsRepo(handle!.db));
      return { escalateMs: hub.escalateMs, triggers: hub.triggers, armEnabled: hub.enabled };
    }, onEscalate);
    // Any pr_reviews row still 'running' belonged to the previous orchestrator
    // process and its in-memory runReview() promise is gone — sweep it to
    // 'error' so it isn't a permanent dead-end (PR list stuck "reviewing…",
    // Report drawer spinning with no Re-run button). Mirrors the instance
    // recovery pass just below.
    prReviewsRepo().failStuckRunning('Interrupted by restart');
    // Respawn after api is ready so the resumed pty's first output/exit can
    // push through to the renderer immediately.
    respawnIncompleteRowsOnBoot();
    // Begin polling ccusage for the 5h-block token usage and pushing it to the
    // renderer dashboard + tray.
    startTokenUsagePolling();
    // Load the last statusline-captured rate-limits snapshot so the sidebar
    // shows last-known usage immediately, before the next statusline render.
    loadPersistedRateLimits(handle.db);
    // Begin the cross-repo PR watch (adaptive poll, notify + pr_watch_state).
    startPrWatch();
    void statusOf; // referenced for future use; quiet TS unused warning
  },
);

// No existing SIGTERM/SIGINT handler existed — adding a minimal shutdown hook
// so pending escalation timers are cleared when the utility process exits.
process.on('exit', () => {
  escalationGate?.clearAll();
});
