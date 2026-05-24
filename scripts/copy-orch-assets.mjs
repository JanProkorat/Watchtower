#!/usr/bin/env node
// Copies non-TS assets the orchestrator reads at runtime (schema files) into
// the compiled output. tsc only emits .js / .d.ts so anything loaded via
// readFileSync alongside __dirname needs to be mirrored by hand.

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const FILES = ['schema.sql', 'timetracker_schema.sql'];
const SRC = 'orchestrator/db';
const DST = 'dist-orchestrator/orchestrator/db';

mkdirSync(DST, { recursive: true });
for (const f of FILES) {
  const src = `${SRC}/${f}`;
  if (existsSync(src)) copyFileSync(src, `${DST}/${f}`);
}
