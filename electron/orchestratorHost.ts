import { utilityProcess, type UtilityProcess, MessageChannelMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortApi } from '../shared/messagePort.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let child: UtilityProcess | null = null;
let api: PortApi | null = null;
let restartsInLastMinute: number[] = [];

type CrashListener = (info: { code: number | null; restarting: boolean }) => void;
const crashListeners = new Set<CrashListener>();

function emitCrash(info: { code: number | null; restarting: boolean }): void {
  for (const l of crashListeners) {
    try {
      l(info);
    } catch (err) {
      console.error('[orchestratorHost] crash listener threw:', err);
    }
  }
}

/**
 * Subscribe to orchestrator crash events. Returns an unsubscribe function.
 * The renderer uses this (via electron/main wiring) to show a recovery banner.
 */
export function onOrchestratorCrash(l: CrashListener): () => void {
  crashListeners.add(l);
  return () => crashListeners.delete(l);
}

/**
 * Track restarts in a rolling 60 s window. If more than 3 fail in a minute
 * we stop respawning so we don't burn CPU in a crash-loop and the renderer
 * can show a permanent "manual recovery needed" banner.
 */
function shouldRestart(): boolean {
  const now = Date.now();
  restartsInLastMinute = restartsInLastMinute.filter((t) => now - t < 60_000);
  return restartsInLastMinute.length < 3;
}

export function startOrchestrator(): PortApi {
  if (api) return api;
  const entry = path.join(__dirname, '../../dist-orchestrator/orchestrator/index.js');
  child = utilityProcess.fork(entry, [], {
    serviceName: 'watchtower-orchestrator',
    stdio: 'inherit',
  });
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ kind: 'init' }, [port1]);
  api = new PortApi(port2 as unknown as ConstructorParameters<typeof PortApi>[0]);
  child.on('exit', (code) => {
    console.error(`[orchestrator] exited with code ${code}`);
    api = null;
    child = null;
    const willRestart = shouldRestart();
    emitCrash({ code: code ?? null, restarting: willRestart });
    if (willRestart) {
      restartsInLastMinute.push(Date.now());
      // Small delay so we don't tight-loop if init itself fails fast.
      setTimeout(() => {
        try {
          startOrchestrator();
        } catch (err) {
          console.error('[orchestratorHost] restart failed:', err);
        }
      }, 500);
    }
  });
  return api;
}

export function getOrchestrator(): PortApi {
  if (!api) throw new Error('orchestrator not started');
  return api;
}
