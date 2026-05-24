import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Discover Claude Code skills across the standard locations.
 *
 *   - User skills:   ~/.claude/skills/<name>/SKILL.md
 *   - Plugin skills: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
 *
 * The structure inside the user-installed plugins is documented by
 * ~/.claude/plugins/installed_plugins.json — we read that to find the
 * absolute installPath for each plugin, then look for a sibling skills/
 * dir. We don't depend on any plugin-specific knowledge.
 */

export interface SkillRow {
  /** The folder name under skills/, used as the canonical id. */
  name: string;
  /** Absolute path of the SKILL.md file. */
  path: string;
  /** "User" for ~/.claude/skills, otherwise the plugin id (e.g. "superpowers@official"). */
  source: string;
  /** Parsed `description` field from the SKILL.md frontmatter. Empty when absent. */
  description: string;
  /** Raw markdown body (everything after the closing frontmatter ---). */
  body: string;
}

const USER_SKILLS_DIR = path.join(homedir(), '.claude', 'skills');
const INSTALLED_PLUGINS_FILE = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

interface InstalledPluginEntry {
  installPath: string;
  version?: string;
}
interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

export function listSkills(): SkillRow[] {
  const rows: SkillRow[] = [];

  // ── User skills ──────────────────────────────────────────────────────
  if (existsSync(USER_SKILLS_DIR)) {
    for (const entry of readdirSync(USER_SKILLS_DIR)) {
      const skillMd = path.join(USER_SKILLS_DIR, entry, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      if (!statSync(path.join(USER_SKILLS_DIR, entry)).isDirectory()) continue;
      rows.push(parseSkill(entry, 'User', skillMd));
    }
  }

  // ── Plugin skills ────────────────────────────────────────────────────
  if (existsSync(INSTALLED_PLUGINS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, 'utf8')) as InstalledPluginsFile;
      for (const [pluginId, installs] of Object.entries(parsed.plugins ?? {})) {
        for (const install of installs) {
          if (!install.installPath || !existsSync(install.installPath)) continue;
          const pluginSkillsDir = path.join(install.installPath, 'skills');
          if (!existsSync(pluginSkillsDir)) continue;
          for (const entry of readdirSync(pluginSkillsDir)) {
            const skillMd = path.join(pluginSkillsDir, entry, 'SKILL.md');
            if (!existsSync(skillMd)) continue;
            if (!statSync(path.join(pluginSkillsDir, entry)).isDirectory()) continue;
            rows.push(parseSkill(entry, pluginId, skillMd));
          }
        }
      }
    } catch {
      // Malformed installed_plugins.json — surface no plugin skills rather
      // than crash the orchestrator. User skills still appear.
    }
  }

  // Stable sort: source first (User wins), then by name.
  rows.sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === 'User') return -1;
      if (b.source === 'User') return 1;
      return a.source.localeCompare(b.source);
    }
    return a.name.localeCompare(b.name);
  });

  return rows;
}

function parseSkill(name: string, source: string, filePath: string): SkillRow {
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const description = readFrontmatterField(frontmatter, 'description');
  return { name, source, path: filePath, description, body };
}

/**
 * Minimal frontmatter splitter. Recognises a YAML-style block delimited by
 * `---` at the top of the file. Returns the body verbatim and the
 * frontmatter as a raw string (we don't need a full YAML parse — only
 * single-line `key: value` lookups, handled by readFrontmatterField).
 */
function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const lines = raw.split('\n');
  // Find the closing --- (must be on its own line).
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { frontmatter: '', body: raw };
  return {
    frontmatter: lines.slice(1, close).join('\n'),
    body: lines.slice(close + 1).join('\n').replace(/^\n+/, ''),
  };
}

/**
 * Read a top-level `key:` line from a frontmatter block. Handles single-
 * line values both quoted ("..." or '...') and unquoted. Multi-line values
 * fall back to the full text up to the next blank line so long descriptions
 * (like jira-fetch's) survive.
 */
function readFrontmatterField(frontmatter: string, key: string): string {
  const lines = frontmatter.split('\n');
  const prefix = `${key}:`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith(prefix)) continue;
    let value = line.slice(prefix.length).trim();
    // Accumulate continuation lines that are indented (YAML folded-block-ish).
    while (i + 1 < lines.length && lines[i + 1] && /^\s/.test(lines[i + 1] ?? '')) {
      value += ' ' + (lines[++i] ?? '').trim();
    }
    return stripQuotes(value);
  }
  return '';
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
