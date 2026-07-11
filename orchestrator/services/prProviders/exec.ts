import { execFile } from 'node:child_process';
import type { Exec } from './types.js';

export const defaultExec: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: 90_000,
      maxBuffer: 64 * 1024 * 1024,
      cwd: opts?.cwd,
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` },
    }, (err, stdout, stderr) => {
      if (err) { (err as Error).message += stderr ? `: ${stderr.trim()}` : ''; reject(err); }
      else resolve(stdout);
    });
  });
