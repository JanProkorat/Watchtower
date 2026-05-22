import { writeFileSync, readFileSync, chmodSync, existsSync, renameSync } from 'node:fs';

export interface ListenerSidecar {
  port: number;
  token: string;
  writtenAt: number;
}

export function writeListenerSidecar(file: string, data: ListenerSidecar): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function readListenerSidecar(file: string): ListenerSidecar | null {
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<ListenerSidecar>;
    if (typeof data.port !== 'number' || typeof data.token !== 'string') return null;
    return { port: data.port, token: data.token, writtenAt: Number(data.writtenAt) || 0 };
  } catch {
    return null;
  }
}
