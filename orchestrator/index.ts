import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PortApi, type OrchRequest, type OrchResponse } from '../shared/messagePort.js';
import { bootstrap, type BootstrapHandle } from './bootstrap.js';
import { PtyManager } from './ptyManager.js';
import { InstancesRepo } from './db/repositories/instances.js';
import { HookEventsRepo } from './db/repositories/hookEvents.js';
import { NotificationsRepo } from './db/repositories/notifications.js';
import { transition } from './stateMachine.js';
import type { StateEvent } from '../shared/events.js';
import type { InstanceStatus } from '../shared/stateModel.js';

let api: PortApi | null = null;
let handle: BootstrapHandle | null = null;
const pty = new PtyManager();

function supportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function repo(): InstancesRepo {
  return new InstancesRepo(handle!.db);
}

function statusOf(id: string): InstanceStatus {
  return repo().get(id)?.status ?? 'crashed';
}

function applyTransition(instanceId: string, event: StateEvent): void {
  const inst = repo().get(instanceId);
  if (!inst) return;
  const result = transition(inst.status, event);
  if (result.state !== inst.status) {
    repo().updateStatus(instanceId, result.state, Date.now());
    api?.push({ kind: 'stateChanged', payload: { instanceId, status: result.state } });
  }
  for (const out of result.outputs) {
    if (out.kind === 'storeClaudeSessionId') {
      repo().setClaudeSessionId(instanceId, out.sessionId);
    }
    // startQuietTimer / clearQuietTimer / clearAttention are wired in Phase 7.
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

function spawnPtyForInstance(opts: PtySpawnArgs): void {
  const cmdArgs = opts.resumeSessionId
    ? ['--resume', opts.resumeSessionId, ...opts.extraArgs]
    : ['--session-id', opts.id, ...opts.extraArgs];
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
  }
}

function resumeOrCrashFromPreviousRun(): void {
  // Any instance still marked live (spawning/working/waiting-*/idle-notify)
  // is an orphan from a previous run — its pty died with the previous
  // orchestrator process. If we captured a Claude session id, respawn via
  // `claude --resume <id>` so the conversation continues. Otherwise the
  // session is unrecoverable — mark crashed.
  //
  // Status is kept on the original row (we don't flip to 'resuming') so
  // the tab strip's color doesn't flicker; once the resumed pty's
  // SessionStart hook fires the state machine settles on 'working' anyway.
  const r = repo();
  const orphans = r.listLive();
  let resumed = 0;
  let crashed = 0;
  for (const o of orphans) {
    if (o.claudeSessionId) {
      try {
        spawnPtyForInstance({
          id: o.id,
          cwd: o.cwd,
          extraArgs: [],
          resumeSessionId: o.claudeSessionId,
        });
        resumed++;
      } catch (err) {
        console.error('[orchestrator] resume failed for', o.id, err);
        r.updateStatus(o.id, 'crashed', Date.now());
        r.setTermination(o.id, 'resume-failed', null);
        crashed++;
      }
    } else {
      r.updateStatus(o.id, 'crashed', Date.now());
      r.setTermination(o.id, 'crash', null);
      crashed++;
    }
  }
  if (orphans.length > 0) {
    console.log(
      `[orchestrator] previous run had ${orphans.length} live instance(s): ` +
        `${resumed} resumed, ${crashed} crashed`,
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
    // Resume after api is ready so the pty's first output/exit can push
    // through to the renderer immediately.
    resumeOrCrashFromPreviousRun();
    void statusOf; // referenced for future use; quiet TS unused warning
  },
);
