import type { DiffFilePayload, DiffLinePayload } from '@watchtower/shared/ipcContract.js';

const FILE_RE = /^\+\+\+ b\/(.+)$/;
const OLD_FILE_RE = /^--- a\/(.+)$/;
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(raw: string): DiffFilePayload[] {
  if (!raw.trim()) return [];
  const files: DiffFilePayload[] = [];
  let cur: DiffFilePayload | null = null;
  let oldNo = 0;
  let newNo = 0;

  const lines = raw.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;

    // Skip "\ No newline at end of file" marker lines
    if (line.startsWith('\\ ')) continue;

    // Skip the final empty element from split() if the input ended with \n
    if (line === '' && idx === lines.length - 1) continue;

    if (line.startsWith('diff --git')) {
      cur = null;
      continue;
    }
    const mOld = OLD_FILE_RE.exec(line);
    if (mOld) continue; // path taken from +++ line
    const mNew = FILE_RE.exec(line);
    if (mNew) {
      cur = { path: mNew[1]!, additions: 0, deletions: 0, lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    const mHunk = HUNK_RE.exec(line);
    if (mHunk) {
      oldNo = Number(mHunk[1]!);
      newNo = Number(mHunk[2]!);
      cur.lines.push({ kind: 'hunk', oldNo: null, newNo: null, text: line });
      continue;
    }
    const first = line[0];
    if (first === '+') {
      cur.lines.push({ kind: 'add', oldNo: null, newNo, text: line.slice(1) });
      cur.additions++;
      newNo++;
    } else if (first === '-') {
      cur.lines.push({ kind: 'del', oldNo, newNo: null, text: line.slice(1) });
      cur.deletions++;
      oldNo++;
    } else {
      // context (leading space) or trailing blank line
      cur.lines.push({ kind: 'ctx', oldNo, newNo, text: line.startsWith(' ') ? line.slice(1) : line });
      oldNo++;
      newNo++;
    }
  }
  return files;
}
