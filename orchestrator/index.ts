import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PortApi, type OrchRequest, type OrchResponse, type OrchPush } from '@watchtower/shared/messagePort.js';
import { bootstrap, type BootstrapHandle } from './bootstrap.js';
import { PtyManager } from './ptyManager.js';
import { InstancesRepo } from './db/repositories/instances.js';
import { HookEventsRepo } from './db/repositories/hookEvents.js';
import { NotificationsRepo } from './db/repositories/notifications.js';
import { SettingsRepo } from './db/repositories/settings.js';
import {
  ProjectsRepo,
  type ProjectInput,
  type ProjectListFilter,
  type ProjectRow,
} from './db/repositories/projects.js';
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
} from './db/repositories/projectRates.js';
import { ContractStatusService } from './db/contractStatus.js';
import { TaskGridService } from './db/taskGrid.js';
import { DaysOffRepo, type DayOffInput } from './db/repositories/daysOff.js';
import { czechHolidays } from './db/workdays.js';
import { ReportsService } from './db/reports.js';
import { DashboardOverviewService } from './db/dashboardOverview.js';
import { transition } from './stateMachine.js';
import { hookCwdMatches, resolveResumeTarget } from './sessionResume.js';
import { Notifier } from './notifier.js';
import { QuietTimers } from './quietTimers.js';
import { SlackEscalator } from './slackEscalator.js';
import { SlackListener } from './slackListener.js';
import { TerminalSnapshots } from './terminalSnapshots.js';
import { buildTerminalAttachResponse } from './terminalAttach.js';
import { formatEscalationMessage } from './escalationMessage.js';
import { WebApiSlackClient, type SlackClient } from './services/slackClient.js';
import { readSlackConfig, writeSlackConfig } from './services/slackConfig.js';
import {
  previewHookInstall,
  ensureHooksInstalled,
  uninstallHooks,
} from './hookInstaller.js';
import { readSettings, writeSettings } from './services/claudeSettings.js';
import { listSkills } from './services/claudeSkills.js';
import { listAgents } from './services/claudeAgents.js';
import { JiraSyncService } from './services/jiraSync.js';
import { JiraBoardService } from './services/jiraBoard.js';
import { fetchTokenUsage } from './services/tokenUsage.js';
import type { TokenUsagePayload } from '@watchtower/shared/tokenUsageFormat.js';
import type { StateEvent } from '@watchtower/shared/events.js';
import type { InstanceStatus } from '@watchtower/shared/stateModel.js';
import { buildPtySpawnConfig, planBootAction } from './shellPolicy.js';
import type { InstanceKind } from './shellPolicy.js';

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
let notifier: Notifier | null = null;
let quietTimers: QuietTimers | null = null;
let slackEscalator: SlackEscalator | null = null;
let slackListener: SlackListener | null = null;
/** threadTs <-> instanceId, populated when we post; read by the reply listener. */
const slackThreadToInstance = new Map<string, string>();
const slackInstanceToThread = new Map<string, string>();
/** DM channel id resolved lazily from the configured user id. */
let slackDmChannel: string | null = null;

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

function notifySync(): void {
  handle?.sync.notifyLocalChange();
}

function repo(): InstancesRepo {
  return new InstancesRepo(handle!.db);
}

function projectsRepo(): ProjectsRepo {
  return new ProjectsRepo(handle!.db);
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
  currency: string;
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
} {
  const status = contractStatusService().forRate(rate);
  return {
    id: rate.id,
    projectId: rate.projectId,
    effectiveFrom: rate.effectiveFrom,
    endDate: rate.endDate,
    rateType: rate.rateType,
    rateAmount: rate.rateAmount,
    currency: rate.currency,
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
  };
}

function projectViewOf(row: ProjectRow): ProjectRow {
  // The repo row already matches the wire shape; this is a no-op identity that
  // exists so we can refactor the wire format separately from the repo without
  // touching every call site. (Phase 22 may rename `kind`/`is_billable`.)
  return row;
}

function statusOf(id: string): InstanceStatus {
  return repo().get(id)?.status ?? 'crashed';
}

function setSlackDmChannel(channel: string | null): void {
  slackDmChannel = channel;
  slackListener?.setDmChannel(channel);
}

function forgetSlackThread(instanceId: string): void {
  const ts = slackInstanceToThread.get(instanceId);
  if (ts) slackThreadToInstance.delete(ts);
  slackInstanceToThread.delete(instanceId);
}

async function postSlack(instanceId: string, cwd: string, kind: 'waiting-permission' | 'idle-notify' | 'crashed'): Promise<void> {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!cfg.enabled || !cfg.botToken || !cfg.dmUserId) return;
  try {
    const client: SlackClient = new WebApiSlackClient(cfg.botToken);
    if (!slackDmChannel) setSlackDmChannel(await client.openDm(cfg.dmUserId));
    const name = cwd.split('/').filter(Boolean).pop() || cwd;
    await terminalSnapshots.flush(instanceId);
    const { text, blocks } = formatEscalationMessage(name, kind, terminalSnapshots.snapshot(instanceId));
    const res = await client.postMessage(slackDmChannel!, text, { blocks });
    slackThreadToInstance.set(res.ts, instanceId);
    slackInstanceToThread.set(instanceId, res.ts);
  } catch (err) {
    console.error('[slack] post failed', err);
  }
}

function deliverSlackReply(instanceId: string, text: string): boolean {
  const session = pty.get(instanceId);
  if (!session) return false;
  session.write(text + '\r');
  // Treat a Slack reply as engagement so attention state clears + badge updates.
  applyTransition(instanceId, { kind: 'userPromptSubmit' });
  return true;
}

function ackSlackReply(channel: string, ts: string, delivered: boolean): void {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!cfg.botToken) return;
  const text = delivered
    ? '✅ Reply sent to the session.'
    : '⚠️ That session is no longer running — your reply was not delivered.';
  void new WebApiSlackClient(cfg.botToken)
    .updateMessage(channel, ts, text)
    .catch((err) => console.error('[slack] ack update failed', err));
}

async function startSlackListener(): Promise<void> {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!slackListener) return;
  // When the feature is disabled or its tokens are incomplete, tear the
  // socket down so a previously-connected listener doesn't linger (and so
  // `connected` reported by slack:getConfig reflects reality).
  if (!cfg.enabled || !cfg.appToken || !cfg.botToken || !cfg.dmUserId) {
    await slackListener.stop();
    return;
  }
  try {
    const channel = slackDmChannel ?? (await new WebApiSlackClient(cfg.botToken).openDm(cfg.dmUserId));
    setSlackDmChannel(channel);
    await slackListener.start(cfg.appToken);
  } catch (err) {
    console.error('[slack] listener start failed', err);
  }
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
    if (!isShell && slackEscalator) slackEscalator.apply(instanceId, inst.cwd, prevStatus, result.state);
    if (!isShell && (result.state === 'crashed' || result.state === 'finished')) forgetSlackThread(instanceId);
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
      slackEscalator?.clear(instanceId);
      forgetSlackThread(instanceId);
    }
  }
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

/** Kill the pty (if any), delete the row + child rows, and clear Slack/timer state. */
function disposeInstanceRow(id: string): void {
  try {
    pty.get(id)?.kill();
  } catch {
    /* pty already dead */
  }
  new HookEventsRepo(handle!.db).deleteForInstance(id);
  new NotificationsRepo(handle!.db).deleteForInstance(id);
  repo().delete(id);
  forgetSlackThread(id);
  slackEscalator?.clear(id);
  terminalSnapshots.dispose(id);
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
        // applyTransition so the notifier + Slack escalator fan-out fires for
        // finished/crashed exits. (A bare transition()+updateStatus() here would
        // update the row but never notify — leaving the crash trigger dead.)
        r.setTermination(opts.id, code === 0 ? 'session-end' : 'crash', code);
        applyTransition(opts.id, { kind: 'ptyExit', code });
      }
    },
  });
}

export async function handleRequest(req: OrchRequest): Promise<OrchResponse['payload']> {
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

    case 'ptyResize':
      pty.get(req.payload.instanceId)?.resize(req.payload.cols, req.payload.rows);
      terminalSnapshots.resize(req.payload.instanceId, req.payload.cols, req.payload.rows);
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
      return { ok: true };

    case 'removeInstance': {
      disposeInstanceRow(req.payload.instanceId);
      return { ok: true };
    }

    case 'restartInstance': {
      const row = repo().get(req.payload.instanceId);
      if (!row) return { ok: false };
      // Re-spawn a fresh process into the SAME row id. Shells re-run the login
      // shell; claude rows resume via the row's session id.
      terminalSnapshots.dispose(row.id);
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

    case 'slack:getConfig': {
      const config = readSlackConfig(new SettingsRepo(handle!.db));
      return { config, connected: slackListener?.isConnected() ?? false };
    }

    case 'slack:setConfig': {
      writeSlackConfig(new SettingsRepo(handle!.db), req.payload.config);
      setSlackDmChannel(null); // force DM re-resolution on next post; also clears listener's copy
      void startSlackListener();
      return { ok: true };
    }

    case 'slack:test': {
      const cfg = readSlackConfig(new SettingsRepo(handle!.db));
      if (!cfg.botToken || !cfg.dmUserId) return { ok: false, error: 'Bot token and DM user id are required.' };
      try {
        const client = new WebApiSlackClient(cfg.botToken);
        const auth = await client.testAuth();
        if (!auth.ok) return { ok: false, error: auth.error ?? 'auth.test failed' };
        const channel = await client.openDm(cfg.dmUserId);
        await client.postMessage(channel, '✅ Watchtower Slack test message.');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'windowFocusChanged': {
      const { focused } = req.payload;
      slackEscalator?.setWindowFocused(focused);
      notifier?.setWindowFocused(focused);
      if (focused) {
        // Returning to the window acknowledges the instance the user is now
        // looking at — same as landing on its tab. The tabFocused transition
        // emits clearAttention, dropping its dot + badge and cancelling any
        // Slack escalation. Background tabs stay flagged until actually visited.
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
      try {
        const row = projectRatesRepo().create(req.payload as ProjectRateInput);
        notifySync();
        return { contract: contractViewOf(row) };
      } catch (err) {
        if (err instanceof RateOverlapError) {
          return {
            error: 'overlap' as const,
            conflictingId: err.conflictingId,
            conflictingFrom: err.conflictingFrom,
            conflictingTo: err.conflictingTo,
          };
        }
        throw err;
      }
    }

    case 'contracts:update': {
      try {
        const row = projectRatesRepo().update(
          req.payload.id,
          req.payload.input as Partial<ProjectRateInput>,
        );
        notifySync();
        return { contract: contractViewOf(row) };
      } catch (err) {
        if (err instanceof RateOverlapError) {
          return {
            error: 'overlap' as const,
            conflictingId: err.conflictingId,
            conflictingFrom: err.conflictingFrom,
            conflictingTo: err.conflictingTo,
          };
        }
        throw err;
      }
    }

    case 'contracts:delete':
      projectRatesRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };

    case 'taskGrid:get': {
      const { year, month, projectId } = req.payload;
      const service = new TaskGridService(handle!.db);
      return service.get(year, month, projectId);
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
        const stateEvent = mapHookEventToStateEvent(eventName, body);
        if (stateEvent) applyTransition(instanceId, stateEvent);
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
    slackEscalator = new SlackEscalator(
      () => readSlackConfig(new SettingsRepo(handle!.db)),
      { post: (id, cwd, kind) => void postSlack(id, cwd, kind) },
    );
    slackListener = new SlackListener({
      dmChannelId: null,
      resolveInstance: (threadTs) => slackThreadToInstance.get(threadTs) ?? null,
      deliver: deliverSlackReply,
      ack: ackSlackReply,
    });
    void startSlackListener();

    // Respawn after api is ready so the resumed pty's first output/exit can
    // push through to the renderer immediately.
    respawnIncompleteRowsOnBoot();
    // Begin polling ccusage for the 5h-block token usage and pushing it to the
    // renderer dashboard + tray.
    startTokenUsagePolling();
    void statusOf; // referenced for future use; quiet TS unused warning
  },
);

// No existing SIGTERM/SIGINT handler existed — adding a minimal shutdown hook
// so pending escalation timers are cleared and the Socket Mode WebSocket is
// closed gracefully when the utility process exits.
process.on('exit', () => {
  slackEscalator?.clearAll();
  void slackListener?.stop();
});
process.on('SIGTERM', () => { void slackListener?.stop(); });
