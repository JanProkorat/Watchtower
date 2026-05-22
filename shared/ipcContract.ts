export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } };

export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number; orch: number } };

export type IpcPush =
  | { kind: 'hello'; payload: { version: string } };

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
