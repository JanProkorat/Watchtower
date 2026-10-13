# Side panel tabs: Agents + native Files — design

Date: 2026-10-13. Status: approved in chat, awaiting spec review.

## Goal

Everything a Claude Code mod opens on the right side of a terminal should open in
Watchtower's own side panel instead, so it reads as part of the instance card and
never as a second column or a duplicate inside the terminal.

Claude Code draws a mod's pane into the pty as text, so Watchtower cannot capture
panes generically. Each pane needs a native version. This spec is **sub-project 1**:

- a tabbed side panel host per pane (Agents | Files);
- the savvy-progress agents panel moved into it as the Agents tab;
- a native file tree as the Files tab, replacing the filetree mod's terminal pane;
- a patched filetree mod that reports Claude's file activity and toggles the tab.

Later, separate specs: a Replay tab (replay-theater bridge) and blast-radius as a
popup (it blocks a Bash call for a yes/no answer, so it is not a panel).

### What the user asked for

- Tabs in one panel, not stacked or side-by-side columns.
- Files tab: tree with git colours, search, Claude activity flash.
- Approach A: Watchtower builds the tree from disk and git; the mod only reports
  activity and toggles the tab.

### Non-goals (this version)

- Opening a file from the tree, or inserting `@path` into the prompt. Clicking a
  file only selects it.
- File preview, size totals (`du`), hidden-file and size toggles, copy path.
- Replay and blast-radius panes.

## Section 1 — Side panel host (renderer)

- `SidePanel` replaces the direct agents panel in `PaneCard`. It keeps today's
  attached frame (shares the card's fill and border, square corner at the seam),
  the drag-to-resize left edge (260–720 px) and the remembered width
  (`localStorage` key `watchtower.savvyPanelWidth`, kept as is, shared by all tabs).
- A tab strip at the top: `Agents | Files`. A tab shows only when it has content:
  - Agents: once savvy-progress has posted any agents or a planned flow.
  - Files: any pane with a cwd, including `shell` and `chat` kinds.
- Open/closed state and the active tab are kept per pane, in memory.
- Rules:
  - Agents auto-opens when a flow starts, but only when the panel is closed. It
    never switches away from a tab the user picked.
  - `/agents-info` (savvy `panelToggles` rise): open on Agents; if the panel is
    already open on Agents, close it.
  - `/filetree` (filetree `panelToggles` rise): the same for Files.
  - The title-bar button becomes "Show side panel" and reopens the last tab. It
    shows whenever the panel is closed and at least one tab is available.
- Agents tab body: today's `SavvyAgentsPanel`, unchanged apart from losing its own
  close button (the panel has one).
- Files tab body: `FilesTab` (section 2).
- Files: `useSavvyChrome` keeps only the band and the agents data; a new
  `useSidePanel` owns open/closed, active tab and width. `PaneCard` lays out the
  panel from `useSidePanel`.

## Section 2 — Native file tree

### Orchestrator: `orchestrator/services/fileTree.ts`

IPC kinds (follow the CLAUDE.md "When adding a new kind" steps; shapes in
`packages/shared/src/fileTree.ts`):

| Kind | Payload | Returns |
|---|---|---|
| `fileTree:list` | `{ instanceId, dir }` (dir relative to the cwd, `''` = root) | entries `{ name, isDir, size, mtimeMs }`, folders first, then by name; at most 5,000 plus `truncated: number` |
| `fileTree:git` | `{ instanceId }` | `{ isRepo, branch, upstream, ahead, behind, files: { path, status, added, deleted }[] }` or `{ isRepo: false }` |
| `fileTree:search` | `{ instanceId, query }` | up to 200 relative paths, best match first |
| `fileTree:watch` / `fileTree:unwatch` | `{ instanceId }` | nothing |

- The root is the instance's `cwd`.
- `fileTree:git` runs `git --no-optional-locks status --porcelain=v2 --branch -z
  --ignored=matching` and `git diff --numstat -z HEAD` through `execFile` (as
  `services/reviews.ts` does), with a 5 s timeout. Status ∈ `modified`, `added`,
  `untracked`, `deleted`, `renamed`, `ignored`. Folder totals are summed in the
  renderer.
- `fileTree:search` lists names from `git ls-files --cached --others
  --exclude-standard -z`; outside a repo it walks the folder (skipping `.git`,
  `node_modules`), capped at 20,000 files. Matching: case-insensitive; a basename
  match ranks above a path-only match, then shorter paths first.
- `fileTree:watch`: one recursive `fs.watch` per cwd, shared and ref-counted
  across panes; events inside `.git/` are ignored except `index` and `HEAD`.
  After 300 ms of quiet it pushes `fileTreeChanged { instanceId }` to every pane
  watching that cwd. The last `unwatch` (or instance disposal) closes it.
- Safety: every `dir` is resolved against the cwd with `realpath`; a result outside
  the cwd is refused with an error. Symlinks pointing outside are listed but not
  expandable.

### Renderer: `components/instances/side/FilesTab.tsx`, hook `state/useFileTree.ts`

- Rows: caret, icon (MUI folder/file icons tinted by file type, no Nerd Font),
  name, and on the right the `+a −d` counts or the modified time (`formatDate*`
  helpers, cs-CZ).
- Git colours: modified amber, added/untracked green, deleted red, ignored dimmed.
  Folders show the summed counts of their children.
- Top: branch row (`main ↑2 ↓0 · +151 −42 M:3`), then a search box. Search shows a
  flat list of matches; clicking one expands its ancestors and selects it.
- Keys: ↑/↓ move, ←/→ collapse/expand (← on a file goes to its folder), Enter
  toggles a folder.
- Expanded folders are kept per pane in memory. On `fileTreeChanged` the hook
  re-lists the expanded folders and re-reads git.

## Section 3 — filetree bridge, errors, testing

### Patched mod: `plugins/filetree/`

- Vendored from the user's `filetree-community` 0.2.24 (MIT; upstream
  `data-goblin/claude-code-filetree`). LICENSE and ACKNOWLEDGEMENTS kept; README
  gets a "Watchtower fork" note like `plugins/savvy-progress/README.md`.
- Bridge discovery copied from savvy-progress (`WATCHTOWER_INSTANCE_ID`,
  `listener.json`). Inside Watchtower:
  - never opens its pane at session start, and closes one left open;
  - `/filetree` bumps `panelToggles` and posts, instead of opening the pane;
  - on `tool.call` for Read, Edit, Write, NotebookEdit it records
    `{ path, kind: 'read' | 'write', at }` and posts the last 50, coalesced over
    200 ms, to `/mods/filetree` as `{ version: 1, panelToggles, activity, sentAt }`.
- Outside Watchtower: unchanged behaviour.
- Watchtower side: `orchestrator/services/fileTreeActivityStore.ts`, twin of
  `savvyProgressStore`, fed from the existing `onModState` route
  (`orchestrator/index.ts`), validated by `parseFileTreeActivity` in
  `packages/shared/src/fileTree.ts`, pushed as `fileTreeActivity`, fetched by
  `fileTreeActivity:get`. Rows touched in the last 4 s flash purple (read) or
  orange (write), fading out.
- Install: replace `filetree@claude-code-filetree` with the fork through
  `CLAUDE_CODE_PLUGIN_DIRS`. To verify first: whether that variable takes several
  folders and with which separator. If not, use the plugin's local-directory
  marketplace entry pointed at `plugins/filetree`.
- CLAUDE.md gets a short "filetree mod bridge" section next to the savvy one.

### Error handling

- Not a git repo, or git missing: the tree works; the branch row reads "Not a git
  repository"; no colours.
- `fileTree:git`, `fileTree:search`, refresh `fileTree:list` calls and
  `fileTreeActivity:get` go on `SILENT_KINDS` in `state/ipc.ts`. A user-initiated
  first expand of a folder may toast (default `invoke()` behaviour).
- Folder with more than 5,000 entries: a "+N more" row.
- Refused path: inline note in the tab.

### Testing

- Orchestrator (vitest, temp git repo per test): list ordering and cap; statuses,
  numstat, ahead/behind; search ranking and the non-repo fallback; `../` and
  symlink escapes refused; watcher ref-counting and debounce (fake timers).
- Shared: `parseFileTreeActivity` lenient-per-field like `parseSavvySnapshot`.
- Renderer: `useSidePanel` tab rules (auto-open never steals a picked tab; each
  toggle command flips only its tab); `FilesTab` colours, folder totals, search
  reveal, flash.
- Mod (`claude plugin test plugins/filetree`): no pane inside Watchtower,
  `/filetree` toggles, activity posts, nothing posted outside Watchtower.
- Last step: review in the dev app.

## Delivery

Three phases, one commit each, each leaving the app working:

1. Tab host + Agents moved into it (`useSidePanel`, `SidePanel`, `PaneCard`).
2. Native Files tab (orchestrator service, IPC, `FilesTab`).
3. Filetree fork, activity store and flash; install switch.
