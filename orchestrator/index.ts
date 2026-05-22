import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PortApi, type OrchRequest, type OrchResponse } from '../shared/messagePort.js';
import { bootstrap, type BootstrapHandle } from './bootstrap.js';
import { PtyManager } from './ptyManager.js';
import { InstancesRepo } from './db/repositories/instances.js';
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

async function handleRequest(req: OrchRequest): Promise<OrchResponse['payload']> {
  switch (req.kind) {
    case 'ping':
      return { now: req.payload.now, orch: Date.now() };

    case 'spawnInstance': {
      const id = randomUUID();
      const now = Date.now();
      repo().insert({
        id,
        cwd: req.payload.cwd,
        status: 'spawning',
        claudeSessionId: id, // we set --session-id <uuid> so the Claude session ID matches the row ID
        spawnedAt: now,
        lastActivityAt: now,
        exitCode: null,
        terminationReason: null,
        resumedFromInstanceId: null,
        jiraKeyHint: null,
        argsJson: req.payload.args ? JSON.stringify(req.payload.args) : null,
      });
      pty.spawn({
        id,
        command: 'claude',
        args: ['--session-id', id, ...(req.payload.args ?? [])],
        cwd: req.payload.cwd,
        env: { ...(process.env as Record<string, string>), WATCHTOWER_INSTANCE_ID: id },
        onData: (chunk) => {
          api?.push({ kind: 'ptyData', payload: { instanceId: id, chunk } });
          applyTransition(id, { kind: 'ptyData' });
        },
        onExit: (code) => {
          api?.push({ kind: 'ptyExit', payload: { instanceId: id, code } });
          const r = repo();
          const inst = r.get(id);
          if (inst) {
            const result = transition(inst.status, { kind: 'ptyExit', code });
            r.updateStatus(id, result.state, Date.now());
            r.setTermination(id, code === 0 ? 'session-end' : 'crash', code);
            api?.push({ kind: 'stateChanged', payload: { instanceId: id, status: result.state } });
          }
        },
      });
      return { instanceId: id };
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
    void statusOf; // referenced for future use; quiet TS unused warning
  },
);
