import Fastify, { type FastifyInstance } from 'fastify';

const KNOWN_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SessionEnd',
]);
const MAX_BODY = 32 * 1024;

export interface HookListenerOptions {
  token: string;
  portRange: [number, number];
  onEvent: (event: string, body: unknown, instanceId: string) => Promise<void>;
}

export interface HookListenerHandle {
  port: number;
  stop(): Promise<void>;
}

export async function startHookListener(opts: HookListenerOptions): Promise<HookListenerHandle> {
  const app: FastifyInstance = Fastify({ bodyLimit: MAX_BODY });

  app.post<{ Params: { event: string } }>('/hooks/:event', async (req, reply) => {
    // Auth check inline (rather than in a hook) — rejecting from a hook
    // before/after body parsing reliably triggers ECONNRESET on Node-fetch
    // clients in this version. Inline reject works because the body has
    // already been parsed by the time the handler runs, matching the path
    // taken by the 400-status cases below.
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const event = req.params.event;
    if (!KNOWN_EVENTS.has(event)) {
      await reply.code(400).send({ error: 'unknown event' });
      return;
    }
    const instanceId = String(req.headers['x-watchtower-instance'] ?? '');
    if (!instanceId) {
      await reply.code(400).send({ error: 'missing X-Watchtower-Instance header' });
      return;
    }
    await opts.onEvent(event, req.body, instanceId);
    await reply.code(204).send();
  });

  app.setErrorHandler(async (err, _req, reply) => {
    const code = (err as { statusCode?: number; code?: string }).code;
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413 || code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      await reply.code(413).send({ error: 'body too large' });
      return;
    }
    await reply.code(500).send({ error: 'internal' });
  });

  let port: number | null = null;
  for (let p = opts.portRange[0]; p <= opts.portRange[1]; p++) {
    try {
      await app.listen({ host: '127.0.0.1', port: p });
      port = p;
      break;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code !== 'EADDRINUSE') throw err;
    }
  }
  if (port == null) {
    throw new Error(`no free port in range ${opts.portRange[0]}-${opts.portRange[1]}`);
  }

  return {
    port,
    stop: () => app.close(),
  };
}
