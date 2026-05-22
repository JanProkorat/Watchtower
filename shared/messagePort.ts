export type OrchRequest =
  | { id: string; kind: 'ping'; payload: { now: number } }
  | { id: string; kind: 'spawnInstance'; payload: { cwd: string; args?: string[] } }
  | { id: string; kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { id: string; kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { id: string; kind: 'killInstance'; payload: { instanceId: string } }
  | { id: string; kind: 'removeInstance'; payload: { instanceId: string } }
  | { id: string; kind: 'listInstances'; payload: Record<string, never> };

export type OrchResponse =
  | { kind: 'ping'; payload: { now: number; orch: number } }
  | { kind: 'spawnInstance'; payload: { instanceId: string | null; error?: string } }
  | { kind: 'ptyWrite'; payload: { ok: true } }
  | { kind: 'ptyResize'; payload: { ok: true } }
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'removeInstance'; payload: { ok: true } }
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{ id: string; cwd: string; status: string; lastActivityAt: number }>;
      };
    };

export type OrchPush =
  | { kind: 'ptyData'; payload: { instanceId: string; chunk: string } }
  | { kind: 'ptyExit'; payload: { instanceId: string; code: number } }
  | { kind: 'stateChanged'; payload: { instanceId: string; status: string } };

type AnyPort = {
  postMessage(data: unknown): void;
  on?: (event: 'message', handler: (msg: { data: unknown }) => void) => void;
  addEventListener?: (event: 'message', handler: (msg: MessageEvent) => void) => void;
  start?: () => void;
};

type ResponseEnvelope = { id: string; kind: OrchResponse['kind']; payload: unknown; _response: true };
type RequestEnvelope = OrchRequest;
type Envelope = ResponseEnvelope | RequestEnvelope | OrchPush;

export class PortApi {
  private pending = new Map<string, (value: unknown) => void>();
  private requestHandler: ((req: OrchRequest) => Promise<unknown>) | null = null;
  private pushHandler: ((msg: OrchPush) => void) | null = null;

  constructor(private port: AnyPort) {
    if (port.on) {
      port.on('message', (msg) => this.handle(msg.data));
    } else if (port.addEventListener) {
      port.addEventListener('message', (msg) => this.handle(msg.data));
    }
    port.start?.();
  }

  invoke<T extends OrchRequest['kind']>(
    kind: T,
    payload: Extract<OrchRequest, { kind: T }>['payload'],
  ): Promise<Extract<OrchResponse, { kind: T }>['payload']> {
    const id = randomId();
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (value: unknown) => void);
      this.port.postMessage({ id, kind, payload } as OrchRequest);
    });
  }

  push(message: OrchPush): void {
    this.port.postMessage(message);
  }

  onRequest(handler: (req: OrchRequest) => Promise<unknown>): void {
    this.requestHandler = handler;
  }

  onPush(handler: (msg: OrchPush) => void): void {
    this.pushHandler = handler;
  }

  private async handle(data: unknown): Promise<void> {
    const msg = data as Envelope;
    if (typeof msg !== 'object' || msg === null) return;

    if ('_response' in msg && msg._response) {
      const resolver = this.pending.get(msg.id);
      if (resolver) {
        this.pending.delete(msg.id);
        resolver(msg.payload);
      }
      return;
    }

    if ('id' in msg && 'kind' in msg && !('_response' in msg)) {
      if (!this.requestHandler) return;
      const req = msg as OrchRequest;
      const payload = await this.requestHandler(req);
      const response: ResponseEnvelope = {
        id: req.id,
        kind: req.kind as OrchResponse['kind'],
        payload,
        _response: true,
      };
      this.port.postMessage(response);
      return;
    }

    if ('kind' in msg) {
      this.pushHandler?.(msg as OrchPush);
    }
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
