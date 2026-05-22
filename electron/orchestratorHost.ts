import { utilityProcess, type UtilityProcess, MessageChannelMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortApi } from '../shared/messagePort.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let child: UtilityProcess | null = null;
let api: PortApi | null = null;

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
  });
  return api;
}

export function getOrchestrator(): PortApi {
  if (!api) throw new Error('orchestrator not started');
  return api;
}
