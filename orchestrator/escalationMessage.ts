// Parses a cleaned terminal snapshot into a question + numbered options.
// Ported (minus Slack Block Kit) from the removed formatEscalationMessage (fdf8370^).
const OPTION_RE = /^\s*[❯>*]?\s*(\d+)[.)]\s+(.*\S)\s*$/;

export function parseEscalation(snapshot: string): {
  question: string;
  options: { number: number; label: string }[];
} {
  const lines = snapshot.split('\n').map(l => l.replace(/\s+$/, ''));
  const options: { number: number; label: string }[] = [];
  let firstOptionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = OPTION_RE.exec(line);
    if (m) {
      if (firstOptionIdx === -1) firstOptionIdx = i;
      options.push({ number: Number(m[1]), label: (m[2] ?? '').trim() });
    }
  }
  let question = '';
  if (firstOptionIdx > 0) {
    for (let i = firstOptionIdx - 1; i >= 0; i--) {
      const line = lines[i] ?? '';
      if (line.trim()) { question = line.trim(); break; }
    }
  } else {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] ?? '';
      if (line.trim()) { question = line.trim(); break; }
    }
  }
  return { question, options };
}
