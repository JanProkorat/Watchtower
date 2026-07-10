import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../orchestrator/services/prProviders/diffParse.js';

const SAMPLE = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
`;

describe('parseUnifiedDiff', () => {
  it('parses one file with add/del/ctx lines and counts', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/foo.ts');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    const kinds = files[0].lines.map((l) => l.kind);
    expect(kinds).toContain('hunk');
    expect(kinds).toContain('add');
    expect(kinds).toContain('del');
    expect(kinds).toContain('ctx');
  });

  it('returns [] for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('assigns line numbers: ctx and add advance newNo, del advances oldNo', () => {
    const [f] = parseUnifiedDiff(SAMPLE);
    const add = f.lines.find((l) => l.kind === 'add' && l.text.includes('const c'))!;
    expect(add.newNo).toBe(3); // const c = 4; is the 3rd line of the new file
    expect(add.oldNo).toBeNull();
    const del = f.lines.find((l) => l.kind === 'del')!;
    expect(del.oldNo).toBe(2);
    expect(del.newNo).toBeNull();
  });
});
