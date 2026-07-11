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

const DELETED = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const x = 1;
-export { x };
`;

describe('parseUnifiedDiff', () => {
  it('includes a deleted file (+++ /dev/null) with its deletions', () => {
    const files = parseUnifiedDiff(DELETED);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/gone.ts');
    expect(files[0].deletions).toBe(2);
    expect(files[0].additions).toBe(0);
  });

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

  it('skips trailing newline; does not create phantom empty ctx line', () => {
    const diff = `diff --git a/test.ts b/test.ts
index 1111111..2222222 100644
--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,2 @@
 line 1
 line 2
`;
    const files = parseUnifiedDiff(diff);
    const lines = files[0]!.lines;
    // Should not have a phantom empty ctx line
    expect(lines.every((l) => !(l.kind === 'ctx' && l.text === ''))).toBe(true);
    // The actual last parsed line should be ctx 'line 2'
    expect(lines.at(-1)).toEqual({
      kind: 'ctx',
      oldNo: 2,
      newNo: 2,
      text: 'line 2'
    });
  });

  it('skips marker lines starting with backslash-space', () => {
    const diff = `diff --git a/test.ts b/test.ts
index 1111111..2222222 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,2 @@
 line 1
-line 2
 line 3
\\ No newline at end of file
`;
    const files = parseUnifiedDiff(diff);
    const lines = files[0]!.lines;
    // Parser should skip the marker line entirely
    // Expected: hunk + ctx(line1) + del(line2) + ctx(line3) = 4 lines
    expect(lines.length).toBe(4);
    expect(lines.some((l) => l.text.includes('No newline'))).toBe(false);
  });
});
