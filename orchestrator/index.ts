import { PortApi, type OrchRequest } from '../shared/messagePort.js';

interface InitMessage {
  data: { kind: string };
  ports?: MessagePort[];
}

const parentPort = (process as unknown as { parentPort?: NodeJS.EventEmitter }).parentPort;
if (!parentPort) {
  throw new Error('orchestrator must run as an Electron utilityProcess child');
}

let api: PortApi | null = null;

parentPort.on('message', (event: InitMessage) => {
  if (event.data?.kind !== 'init' || !event.ports?.[0]) return;
  const port = event.ports[0];
  api = new PortApi(port as unknown as ConstructorParameters<typeof PortApi>[0]);
  api.onRequest(async (req: OrchRequest) => {
    switch (req.kind) {
      case 'ping':
        return { now: req.payload.now, orch: Date.now() };
    }
  });
});

setInterval(() => {
  // heartbeat tick to keep the child alive between requests
}, 5000).unref();
