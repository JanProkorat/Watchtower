export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } }
  | { kind: 'spawnInstance'; payload: { cwd: string; args?: string[] } }
  | { kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { kind: 'killInstance'; payload: { instanceId: string } }
  | { kind: 'removeInstance'; payload: { instanceId: string } }
  | { kind: 'reorderInstances'; payload: { orderedIds: string[] } }
  | { kind: 'listInstances'; payload: Record<string, never> }
  | { kind: 'chooseDirectory'; payload: { defaultPath?: string } };

export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number; orch: number } }
  | { kind: 'spawnInstance'; payload: { instanceId: string | null; error?: string } }
  | { kind: 'ptyWrite'; payload: { ok: true } }
  | { kind: 'ptyResize'; payload: { ok: true } }
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'removeInstance'; payload: { ok: true } }
  | { kind: 'reorderInstances'; payload: { ok: true } }
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{ id: string; cwd: string; status: string; lastActivityAt: number }>;
      };
    }
  | { kind: 'chooseDirectory'; payload: { path: string | null } };

export type IpcPush =
  | { kind: 'hello'; payload: { version: string } }
  | { kind: 'ptyData'; payload: { instanceId: string; chunk: string } }
  | { kind: 'ptyExit'; payload: { instanceId: string; code: number } }
  | { kind: 'stateChanged'; payload: { instanceId: string; status: string } };

export interface WatchtowerBridge {
  invoke<T extends IpcRequest['kind']>(
    kind: T,
    payload: Extract<IpcRequest, { kind: T }>['payload'],
  ): Promise<Extract<IpcResponse, { kind: T }>['payload']>;
  on<T extends IpcPush['kind']>(
    kind: T,
    handler: (payload: Extract<IpcPush, { kind: T }>['payload']) => void,
  ): () => void;
}
