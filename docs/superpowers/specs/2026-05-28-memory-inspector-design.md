# Watchtower — Memory inspector module

Date: 2026-05-28
Status: Approved design, pending implementation plan

## 1. Context & motivation

Watchtower's PROTOTYPE.md roadmap (item 5) calls for a "Memory inspector —
navigate `~/.claude/projects/<slug>/memory/`, search across all projects."
Auto-memory now exists in ~10 projects on a typical dev machine (38 files in
the current sample). Reviewing what Claude has saved is currently a manual
`ls` + `cat` walk through the home directory. The inspector turns that walk
into a first-class read-only browser, the same way the Settings module turned
`~/.claude/settings.json` into a structured editor.

Memories are markdown files with YAML frontmatter (`name`, `description`,
`type` ∈ `user` / `feedback` / `project` / `reference`) and `[[name]]`
cross-references between them. Each project owns a `MEMORY.md` index plus
one file per memory.

## 2. Scope

### In scope

- New `Memory` module in the left rail (5th slot, after Settings).
- Three-column layout: project rail (left) → memory list (middle) → preview (right).
- Project rail lists all `~/.claude/projects/*/memory/` directories with a
  memory count, sorted alphabetically by the basename of the decoded path.
  An "All projects" virtual entry is pinned at the top, showing the total.
- Memory list (middle pane): sorted by mtime descending. Each row shows
  title (from `name:` frontmatter, falling back to filename), 1-line
  description, type chip (color-coded per kind), relative mtime.
  When "All projects" is selected, each row additionally shows the project
  basename as a subtitle.
- Search box at the top of the middle pane filters across name + description
  + body, case-insensitive substring. Search scope is whatever the rail
  currently selects (project-local or global).
- Preview pane (right): renders the markdown body via `react-markdown`,
  with a pre-pass that converts `[[name]]` into clickable wikilinks.
  Clicking a wikilink selects that memory in the middle pane within the
  same project. Unresolved targets render as muted italic with a tooltip.
  Frontmatter is shown as chips at the top (name, type, description).
- `MEMORY.md` index is shown as a regular row in each project, tagged with
  a synthetic `index` type chip.
- URL hash routing: `#module=memory&project=<slug|*>&memory=<fileName>`.
- Pull-to-refresh button in the rail header + auto-refetch when the
  module gains focus.
- **Refactor in passing:** extract frontmatter parser to
  `orchestrator/services/frontmatter.ts`. `claudeSkills.ts` and
  `claudeAgents.ts` migrate to it. PROTOTYPE.md decision #28 called this
  out: factor when a third caller appears — Memory is the third.

### Out of scope

- Editing memory body or frontmatter.
- Creating or deleting memories.
- File system watcher for live updates (manual refresh covers v1).
- Memory rot heuristics or staleness scoring (the assistant runtime
  already surfaces age inline).
- Bulk operations across projects.
- Dashboard widget for "recently saved memories".
- Markdown rendering for the Skills/Agents tabs (deferred separately).

## 3. Architecture

### 3.1 Modules and files

```
orchestrator/services/
  claudeMemory.ts            — walks ~/.claude/projects/*/memory/
  frontmatter.ts             — extracted parser, replaces inline copies in
                               claudeSkills.ts + claudeAgents.ts

client/src/components/memory/
  ModuleMemory.tsx           — root, owns selected project + memory state
  ProjectsRail.tsx           — left rail, "All projects" + project list
  MemoryList.tsx             — middle pane, search box + sorted list
  MemoryRow.tsx              — single row (title, description, type chip, mtime)
  MemoryPreview.tsx          — right pane, frontmatter chips + rendered markdown
  WikilinkRenderer.tsx       — custom react-markdown component for [[name]]

client/src/state/
  useMemory.ts               — IPC hook for the three new kinds

client/src/util/
  memoryUrl.ts               — hash encode/decode for the module

shared/
  ipcContract.ts             — three new kinds (read-only)
  messagePort.ts             — same three kinds mirrored to orchestrator
```

### 3.2 IPC kinds (all read-only)

```ts
// memory:listProjects → returns one entry per project with a memory/ dir
{
  kind: 'memory:listProjects';
  payload: {};
  response: { projects: MemoryProject[] };
}

// memory:list — payload.projectSlug = '*' means all projects
{
  kind: 'memory:list';
  payload: { projectSlug: string };
  response: { memories: MemoryMeta[] };
}

// memory:read — returns body + raw frontmatter
{
  kind: 'memory:read';
  payload: { projectSlug: string; fileName: string };
  response: { memory: MemoryDetail };
}
```

### 3.3 Data model

```ts
export type MemoryType =
  | 'user'
  | 'feedback'
  | 'project'
  | 'reference'
  | 'index'        // MEMORY.md (no frontmatter)
  | 'unknown';     // frontmatter present but type missing/invalid

export interface MemoryProject {
  slug: string;          // "-Users-jan-Projects-Watchtower"
  friendlyName: string;  // "Watchtower" (last segment of decoded path)
  decodedPath: string;   // "/Users/jan/Projects/Watchtower" (best-effort)
  memoryDir: string;     // absolute path to .../memory
  count: number;
}

export interface MemoryMeta {
  projectSlug: string;
  fileName: string;       // "timetracker-absorption.md"
  name: string;           // frontmatter name, falls back to fileName w/o .md
  description: string;    // frontmatter description, falls back to ""
  type: MemoryType;
  mtime: number;          // epoch ms
}

export interface MemoryDetail extends MemoryMeta {
  body: string;           // markdown body, frontmatter stripped
  frontmatterRaw: string; // raw YAML text for "show raw" toggle
}
```

### 3.4 Slug decoding

`~/.claude/projects/` uses a lossy encoding: slashes and spaces become
hyphens (`/Users/jan/Projects/Watchtower` → `-Users-jan-Projects-Watchtower`,
`/Users/jan/Práce/Green Code/technology` → `-Users-jan-Pr-ce-Green-Code-technology`).
Decoding back to a path is not perfectly reversible. The service returns
`decodedPath` as a best-effort `slug.replace(/^-/, '/').replace(/-/g, '/')`,
and `friendlyName` as the last `/`-separated segment of that decoded string.
The friendly name is what the rail displays; the slug is shown in a tooltip.

### 3.5 Sort & filter

- Project rail: `friendlyName` ascending, locale-aware. "All projects"
  pinned at top.
- Memory list: `mtime` descending. Stable secondary sort on `name`.
- Search box: case-insensitive substring match against the concatenation
  of `name + " " + description + " " + body`. Matches contribute to
  inclusion but do not currently highlight; that's a follow-up if needed.

### 3.6 Wikilink resolution

Pre-pass before `react-markdown` rewrites `[[some-name]]` to
`[some-name](watchtower-wikilink:some-name)`. A custom link component
intercepts `watchtower-wikilink:` hrefs and calls
`onSelectMemory(targetName)`. Resolution is **project-scoped**: look up
`some-name` against the current project's `MemoryMeta.name`. If absent,
render the link in a muted italic with a tooltip "no memory named X in
this project" — non-clickable.

When "All projects" is selected, wikilinks resolve against the memory's
own project (taken from the selected `MemoryMeta.projectSlug`), not the
global list.

## 4. Errors

- Missing `~/.claude/projects/` → orchestrator returns
  `{ projects: [] }`. Renderer shows a centered empty state:
  "No Claude memory found on this machine yet."
- Unreadable file (permission, ENOENT race) → row stays in list with a
  `[unreadable]` annotation, `MemoryPreview` shows an
  `<Alert severity="warning">` and renders the raw text below.
- Malformed frontmatter → file falls back to `type: 'unknown'`,
  `name = filename`, `description = ""`. Preview still renders the body.
- IPC errors → the read hook sets its `error` field, surfaced as an
  inline `<Alert severity="error">` in the affected pane (existing
  Settings pattern).

## 5. Tests

- `tests/orchestrator/frontmatter.test.ts` — extracted parser, covers
  the existing assertions from skills/agents plus malformed-input cases.
- `tests/orchestrator/claudeMemory.test.ts` — service unit tests against
  a fixture tmp directory with two synthetic projects (one populated,
  one empty, plus a malformed file).
- `tests/client/memoryUrl.test.ts` — hash encode/decode for
  `module=memory&project=…&memory=…`.
- `tests/client/MemoryPreview.test.tsx` — wikilink resolution
  (resolved target invokes callback; unresolved renders muted italic;
  external `http://` links bypass the interceptor).
- Existing `claudeSkills` / `claudeAgents` tests get re-pointed at the
  extracted parser — pure refactor, no behavior change.

Target: ~395 → ~410 tests.

## 6. Open follow-ups (not in this PR)

- Editing / deleting / creating memories.
- File system watcher (`chokidar`) for live updates.
- Cross-project wikilink resolution UI (today's scoping decision is by
  design, but a UX for explicit cross-project links could come later).
- Search highlight in the list.
- Skills/Agents tabs adopt the same markdown rendering path.
