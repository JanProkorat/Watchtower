import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Discover Claude Code agents across the standard locations.
 *
 *   - User agents:   ~/.claude/agents/<name>.md
 *   - Plugin agents: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents/<name>.md
 *
 * Same plugin-walking strategy as claudeSkills (read installed_plugins.json
 * to find installPaths, then look for agents/ inside each). Skill/agent
 * frontmatter format is the same shape — name + description + a few
 * scalar fields — so we share the parser logic via duplication for now;
 * polish phase can factor it.
 */

export interface AgentRow {
  /** File basename without .md extension. */
  name: string;
  /** Absolute path of the agent .md file. */
  path: string;
  /** "User" for ~/.claude/agents, otherwise the plugin id. */
  source: string;
  /** Parsed `description` field from the frontmatter. Empty when absent. */
  description: string;
  /** Parsed `model` field — typically "opus", "sonnet", "haiku" or unset. */
  model: string;
  /** Parsed `tools` field — comma-separated list when present, "*" for all. */
  tools: string;
  /** Raw markdown body (everything after the closing frontmatter ---). */
  body: string;
}

const USER_AGENTS_DIR = path.join(homedir(), '.claude', 'agents');
const INSTALLED_PLUGINS_FILE = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

interface InstalledPluginEntry {
  installPath: string;
  version?: string;
}
interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

export function listAgents(): AgentRow[] {
  const rows: AgentRow[] = [];

  // ── User agents ──────────────────────────────────────────────────────
  if (existsSync(USER_AGENTS_DIR)) {
    for (const entry of readdirSync(USER_AGENTS_DIR)) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(USER_AGENTS_DIR, entry);
      if (!statSync(filePath).isFile()) continue;
      rows.push(parseAgent(entry.slice(0, -3), 'User', filePath));
    }
  }

  // ── Plugin agents ────────────────────────────────────────────────────
  if (existsSync(INSTALLED_PLUGINS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, 'utf8')) as InstalledPluginsFile;
      for (const [pluginId, installs] of Object.entries(parsed.plugins ?? {})) {
        for (const install of installs) {
          if (!install.installPath || !existsSync(install.installPath)) continue;
          const pluginAgentsDir = path.join(install.installPath, 'agents');
          if (!existsSync(pluginAgentsDir)) continue;
          for (const entry of readdirSync(pluginAgentsDir)) {
            if (!entry.endsWith('.md')) continue;
            const filePath = path.join(pluginAgentsDir, entry);
            if (!statSync(filePath).isFile()) continue;
            rows.push(parseAgent(entry.slice(0, -3), pluginId, filePath));
          }
        }
      }
    } catch {
      // Malformed installed_plugins.json — surface no plugin agents rather
      // than crash the orchestrator.
    }
  }

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

function parseAgent(name: string, source: string, filePath: string): AgentRow {
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  return {
    name,
    source,
    path: filePath,
    description: readFrontmatterField(frontmatter, 'description'),
    model: readFrontmatterField(frontmatter, 'model'),
    tools: readFrontmatterField(frontmatter, 'tools'),
    body,
  };
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const lines = raw.split('\n');
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

function readFrontmatterField(frontmatter: string, key: string): string {
  const lines = frontmatter.split('\n');
  const prefix = `${key}:`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith(prefix)) continue;
    let value = line.slice(prefix.length).trim();
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
