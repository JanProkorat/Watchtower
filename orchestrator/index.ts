import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PortApi, type OrchRequest, type OrchResponse } from '../shared/messagePort.js';
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
import { Notifier } from './notifier.js';
import { QuietTimers } from './quietTimers.js';
import {
  previewHookInstall,
  ensureHooksInstalled,
  uninstallHooks,
} from './hookInstaller.js';
import { readSettings, writeSettings } from './services/claudeSettings.js';
import { listSkills } from './services/claudeSkills.js';
import { listAgents } from './services/claudeAgents.js';
import type { StateEvent } from '../shared/events.js';
import type { InstanceStatus } from '../shared/stateModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let api: PortApi | null = null;
let handle: BootstrapHandle | null = null;
const pty = new PtyManager();
let notifier: Notifier | null = null;
let quietTimers: QuietTimers | null = null;

const DEFAULT_QUIET_MS = 90_000;

function supportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
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

function worklogsRepo(): WorklogsRepo {
  return new WorklogsRepo(handle!.db);
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

function applyTransition(instanceId: string, event: StateEvent): void {
  const inst = repo().get(instanceId);
  if (!inst) return;
  const prevStatus = inst.status;
  const result = transition(prevStatus, event);
  if (result.state !== prevStatus) {
    repo().updateStatus(instanceId, result.state, Date.now());
    api?.push({ kind: 'stateChanged', payload: { instanceId, status: result.state } });
    if (notifier) notifier.apply(instanceId, inst.cwd, prevStatus, result.state, Date.now());
  }
  for (const out of result.outputs) {
    if (out.kind === 'storeClaudeSessionId') {
      repo().setClaudeSessionId(instanceId, out.sessionId);
    } else if (out.kind === 'startQuietTimer') {
      quietTimers?.start(instanceId);
    } else if (out.kind === 'clearQuietTimer') {
      quietTimers?.clear(instanceId);
    } else if (out.kind === 'clearAttention') {
      notifier?.clearAttention(instanceId);
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

interface PtySpawnArgs {
  id: string;
  cwd: string;
  extraArgs: string[];
  /** If present, spawn via `claude --resume <id>` instead of `--session-id <id>`. */
  resumeSessionId?: string;
}

const RESUME_FAIL_FAST_MS = 2000;

function spawnPtyForInstance(opts: PtySpawnArgs): void {
  const cmdArgs = opts.resumeSessionId
    ? ['--resume', opts.resumeSessionId, ...opts.extraArgs]
    : ['--session-id', opts.id, ...opts.extraArgs];
  const spawnedAt = Date.now();
  pty.spawn({
    id: opts.id,
    command: 'claude',
    args: cmdArgs,
    cwd: opts.cwd,
    env: { ...(process.env as Record<string, string>), WATCHTOWER_INSTANCE_ID: opts.id },
    onData: (chunk) => {
      api?.push({ kind: 'ptyData', payload: { instanceId: opts.id, chunk } });
      applyTransition(opts.id, { kind: 'ptyData' });
    },
    onExit: (code) => {
      const lifespan = Date.now() - spawnedAt;
      // If --resume fails fast, the session probably never had any persisted
      // content (e.g. the user closed the app right after launching claude,
      // before sending any prompt). Claude has nothing to restore. Fall back
      // to a fresh spawn in the same cwd, reusing the same row id +
      // session id (via --session-id) so future resumes still work.
      if (opts.resumeSessionId && code !== 0 && lifespan < RESUME_FAIL_FAST_MS) {
        console.log(
          `[orchestrator] resume failed for ${opts.id} (exit ${code} in ${lifespan}ms) — spawning fresh`,
        );
        spawnPtyForInstance({
          id: opts.id,
          cwd: opts.cwd,
          extraArgs: opts.extraArgs,
          // no resumeSessionId — break the recursion guard, full fresh spawn
        });
        return;
      }
      api?.push({ kind: 'ptyExit', payload: { instanceId: opts.id, code } });
      const r = repo();
      const inst = r.get(opts.id);
      if (inst) {
        const result = transition(inst.status, { kind: 'ptyExit', code });
        r.updateStatus(opts.id, result.state, Date.now());
        r.setTermination(opts.id, code === 0 ? 'session-end' : 'crash', code);
        api?.push({ kind: 'stateChanged', payload: { instanceId: opts.id, status: result.state } });
      }
    },
  });
}

async function handleRequest(req: OrchRequest): Promise<OrchResponse['payload']> {
  switch (req.kind) {
    case 'ping':
      return { now: req.payload.now, orch: Date.now() };

    case 'spawnInstance': {
      const id = randomUUID();
      const now = Date.now();
      const expandedCwd = req.payload.cwd.startsWith('~/')
        ? path.join(homedir(), req.payload.cwd.slice(2))
        : req.payload.cwd === '~'
        ? homedir()
        : req.payload.cwd;
      try {
        repo().insert({
          id,
          cwd: expandedCwd,
          status: 'spawning',
          claudeSessionId: id, // --session-id <uuid> => Claude session id matches row id
          spawnedAt: now,
          lastActivityAt: now,
          exitCode: null,
          terminationReason: null,
          resumedFromInstanceId: null,
          jiraKeyHint: null,
          argsJson: req.payload.args ? JSON.stringify(req.payload.args) : null,
        });
        spawnPtyForInstance({ id, cwd: expandedCwd, extraArgs: req.payload.args ?? [] });
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
      return { ok: true };

    case 'killInstance':
      pty.get(req.payload.instanceId)?.kill();
      return { ok: true };

    case 'removeInstance': {
      // Kill the pty if it's still alive — best-effort, no grace period because
      // the row gets deleted right after either way.
      try {
        pty.get(req.payload.instanceId)?.kill();
      } catch {
        /* pty already dead */
      }
      // Cascade: hook_events + notifications reference instances.id but the
      // schema doesn't have ON DELETE CASCADE, so we clean child rows first.
      new HookEventsRepo(handle!.db).deleteForInstance(req.payload.instanceId);
      new NotificationsRepo(handle!.db).deleteForInstance(req.payload.instanceId);
      repo().delete(req.payload.instanceId);
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

    case 'focusChanged':
      notifier?.setFocused(req.payload.instanceId);
      return { ok: true };

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
      return { project: projectViewOf(row) };
    }

    case 'projects:update': {
      const row = projectsRepo().update(req.payload.id, req.payload.input as Partial<ProjectInput>);
      return { project: projectViewOf(row) };
    }

    case 'projects:archive': {
      projectsRepo().archive(req.payload.id, req.payload.archived);
      return { ok: true };
    }

    case 'projects:delete': {
      projectsRepo().delete(req.payload.id);
      return { ok: true };
    }

    case 'epics:list':
      return { epics: epicsRepo().listForProject(req.payload.projectId) };

    case 'epics:create':
      return { epic: epicsRepo().create(req.payload as EpicInput) };

    case 'epics:update':
      return { epic: epicsRepo().update(req.payload.id, req.payload.input as Partial<EpicInput>) };

    case 'epics:reorder':
      epicsRepo().reorder(req.payload.projectId, req.payload.orderedIds);
      return { ok: true };

    case 'epics:delete':
      epicsRepo().delete(req.payload.id);
      return { ok: true };

    case 'tasks:listForEpic':
      return { tasks: tasksRepo().listForEpic(req.payload.epicId) };

    case 'tasks:listForProject':
      return { tasks: tasksRepo().listForProject(req.payload.projectId) };

    case 'tasks:create':
      return { task: tasksRepo().create(req.payload as TaskInput) };

    case 'tasks:update':
      return { task: tasksRepo().update(req.payload.id, req.payload.input as Partial<TaskInput>) };

    case 'tasks:delete':
      tasksRepo().delete(req.payload.id);
      return { ok: true };

    case 'worklogs:list':
      return { worklogs: worklogsRepo().list(req.payload as WorklogListFilter) };

    case 'worklogs:create':
      return { worklog: worklogsRepo().create(req.payload as WorklogInput) };

    case 'worklogs:update':
      return {
        worklog: worklogsRepo().update(
          req.payload.id,
          req.payload.input as Partial<WorklogInput>,
        ),
      };

    case 'worklogs:delete':
      worklogsRepo().delete(req.payload.id);
      return { ok: true };

    case 'contracts:listForProject': {
      const rows = projectRatesRepo().listForProject(req.payload.projectId);
      return { contracts: rows.map(contractViewOf) };
    }

    case 'contracts:create': {
      try {
        const row = projectRatesRepo().create(req.payload as ProjectRateInput);
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

    case 'daysOff:upsert':
      return { dayOff: new DaysOffRepo(handle!.db).upsert(req.payload as DayOffInput) };

    case 'daysOff:delete':
      new DaysOffRepo(handle!.db).delete(req.payload.date);
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
        })),
      };
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
    if (row.status === 'finished') continue;
    if (row.terminationReason === 'user-kill') continue;
    if (!row.claudeSessionId) {
      if (row.status !== 'crashed') {
        r.updateStatus(row.id, 'crashed', Date.now());
        r.setTermination(row.id, 'crash', null);
      }
      crashed++;
      continue;
    }
    try {
      r.updateStatus(row.id, 'spawning', Date.now());
      r.setTermination(row.id, null, null);
      spawnPtyForInstance({
        id: row.id,
        cwd: row.cwd,
        extraArgs: [],
        resumeSessionId: row.claudeSessionId,
      });
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
      onHookEvent: async (eventName, body, instanceId) => {
        const stateEvent = mapHookEventToStateEvent(eventName, body);
        if (stateEvent) applyTransition(instanceId, stateEvent);
      },
    });
    api = new PortApi(
      event.ports[0] as unknown as ConstructorParameters<typeof PortApi>[0],
    );
    api.onRequest(async (req) => handleRequest(req as OrchRequest));

    // Wire the notifier + quiet timer now that api is available.
    notifier = new Notifier({
      notify: (p) => {
        api?.push({ kind: 'notify', payload: p });
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
      clearAttention: (instanceId) => api?.push({ kind: 'clearAttention', payload: { instanceId } }),
      setBadge: (count) => api?.push({ kind: 'badge', payload: { count } }),
    });
    const settings = new SettingsRepo(handle!.db);
    const quietMs = settings.getNumber('quiet_timer_ms', DEFAULT_QUIET_MS);
    quietTimers = new QuietTimers(quietMs, (instanceId) => {
      applyTransition(instanceId, { kind: 'quietTimerFired' });
    });

    // Respawn after api is ready so the resumed pty's first output/exit can
    // push through to the renderer immediately.
    respawnIncompleteRowsOnBoot();
    void statusOf; // referenced for future use; quiet TS unused warning
  },
);
