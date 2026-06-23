import type { IpcRequest, IpcResponse, IpcPush } from './ipcContract.js';

export type WsRequestFrame = { id: string } & IpcRequest;
export type WsResponseFrame = {
  id: string;
  kind: IpcResponse['kind'];
  payload?: unknown;
  error?: string;
};
export type WsPushFrame = { push: true } & IpcPush;
export type WsFrame = WsRequestFrame | WsResponseFrame | WsPushFrame;

export function encodeFrame(frame: WsFrame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(raw: string): WsFrame {
  const parsed = JSON.parse(raw) as WsFrame;
  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    throw new Error('invalid ws frame');
  }
  return parsed;
}

export function isPushFrame(f: WsFrame): f is WsPushFrame {
  return (f as WsPushFrame).push === true;
}
