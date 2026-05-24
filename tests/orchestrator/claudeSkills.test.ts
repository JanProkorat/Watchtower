import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// listSkills reads from absolute paths under ~/.claude — we can't sandbox
// the homedir without process-wide side effects, so this test exercises
// only the frontmatter parser via direct module access. The walk logic is
// straightforward fs.readdirSync + existsSync; an end-to-end test would
// add coverage but at the cost of writing into the developer's homedir.
//
// The parser itself is the only piece with non-trivial behaviour (multi-
// line descriptions, quote stripping, missing frontmatter), so that's the
// surface worth pinning here.

// Import via the internal-symbol surface: vitest doesn't enforce export
// scoping, but cleaner to test via the public listSkills against a
// constructed source tree pointed at by HOME.
// Pin HOME for the duration of the test so listSkills walks a sandbox.
const originalHome = process.env.HOME;

describe('claudeSkills.listSkills', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'wt-claude-skills-'));
    process.env.HOME = tmp;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns [] when no skills dir exists', async () => {
    // os.homedir() in Node honours $HOME on Unix, so the import will see
    // our sandbox. Import lazily so the mocked HOME applies.
    const { listSkills } = await import('../../orchestrator/services/claudeSkills.js?fresh-' + Date.now());
    expect(listSkills()).toEqual([]);
  });

  it('discovers user skills with name + description from frontmatter', async () => {
    mkdirSync(path.join(tmp, '.claude', 'skills', 'my-skill'), { recursive: true });
    writeFileSync(
      path.join(tmp, '.claude', 'skills', 'my-skill', 'SKILL.md'),
      `---\nname: my-skill\ndescription: A short test description.\n---\n\n# my-skill\n\nbody here\n`,
    );

    const { listSkills } = await import('../../orchestrator/services/claudeSkills.js?cache-' + Date.now());
    const rows = listSkills();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('my-skill');
    expect(rows[0]?.source).toBe('User');
    expect(rows[0]?.description).toBe('A short test description.');
    expect(rows[0]?.body).toContain('# my-skill');
  });

  it('strips surrounding quotes from description values', async () => {
    mkdirSync(path.join(tmp, '.claude', 'skills', 'quoted'), { recursive: true });
    writeFileSync(
      path.join(tmp, '.claude', 'skills', 'quoted', 'SKILL.md'),
      `---\nname: quoted\ndescription: "Hello, world."\n---\n`,
    );
    const { listSkills } = await import('../../orchestrator/services/claudeSkills.js?cache2-' + Date.now());
    const rows = listSkills();
    expect(rows[0]?.description).toBe('Hello, world.');
  });

  it('joins indented continuation lines into a single description', async () => {
    mkdirSync(path.join(tmp, '.claude', 'skills', 'long-desc'), { recursive: true });
    writeFileSync(
      path.join(tmp, '.claude', 'skills', 'long-desc', 'SKILL.md'),
      `---\nname: long-desc\ndescription: First sentence.\n  Second sentence.\n  Third sentence.\n---\n`,
    );
    const { listSkills } = await import('../../orchestrator/services/claudeSkills.js?cache3-' + Date.now());
    const rows = listSkills();
    expect(rows[0]?.description).toBe('First sentence. Second sentence. Third sentence.');
  });

  it('skips dirs that lack a SKILL.md', async () => {
    mkdirSync(path.join(tmp, '.claude', 'skills', 'has-it'), { recursive: true });
    mkdirSync(path.join(tmp, '.claude', 'skills', 'lacks-it'), { recursive: true });
    writeFileSync(
      path.join(tmp, '.claude', 'skills', 'has-it', 'SKILL.md'),
      `---\nname: has-it\ndescription: present\n---\n`,
    );
    const { listSkills } = await import('../../orchestrator/services/claudeSkills.js?cache4-' + Date.now());
    const rows = listSkills();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('has-it');
  });
});
