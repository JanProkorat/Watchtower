import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';
import type { OrchRequest, OrchPush } from '@watchtower/shared/messagePort.js';
import { encodeFrame, decodeFrame, type WsRequestFrame, type WsPushFrame } from '@watchtower/shared/wsProtocol.js';

export interface WsBridgeOptions {
  host: string;
  port: number;
  token: string;
  handleRequest: (req: OrchRequest) => Promise<unknown>;
}

export interface WsBridgeHandle {
  port: number;
  broadcast: (push: OrchPush) => void;
  stop: () => Promise<void>;
  clientCount: () => number;
}

export async function startWsBridge(opts: WsBridgeOptions): Promise<WsBridgeHandle> {
  const app: FastifyInstance = Fastify();
  await app.register(fastifyWebsocket, { options: { maxPayload: 1 * 1024 * 1024 } });

  const clients = new Set<WebSocket>();

  app.register(async (scoped) => {
    scoped.get('/ws', {
      websocket: true,
      preHandler: (req, reply, done) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        if (url.searchParams.get('token') !== opts.token) {
          reply.code(401).send({ error: 'unauthorized' });
        } else {
          done();
        }
      },
    }, (conn, req) => {
      const socket = conn.socket as unknown as WebSocket;
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));

      socket.on('message', async (raw: Buffer) => {
        let frame: WsRequestFrame;
        try {
          frame = decodeFrame(raw.toString()) as WsRequestFrame;
        } catch {
          return;
        }
        const reply = (payload?: unknown, error?: string) =>
          socket.send(encodeFrame({ id: frame.id, kind: frame.kind, payload, error } as WsRequestFrame));

        if (ELECTRON_ONLY_KINDS.has(frame.kind as never)) {
          reply(undefined, `kind "${frame.kind}" is not available over the remote connection`);
          return;
        }
        try {
          const payload = await opts.handleRequest({ id: frame.id, kind: frame.kind, payload: frame.payload } as OrchRequest);
          reply(payload);
        } catch (err) {
          reply(undefined, err instanceof Error ? err.message : String(err));
        }
      });
    });
  });

  await app.listen({ host: opts.host, port: opts.port });
  const actualPort = (app.server.address() as { port: number }).port;

  return {
    port: actualPort,
    broadcast: (push: OrchPush) => {
      const frame = encodeFrame({ push: true, ...push } as WsPushFrame);
      for (const c of clients) {
        if (c.readyState === c.OPEN) c.send(frame);
      }
    },
    stop: () => app.close(),
    clientCount: () => clients.size,
  };
}
