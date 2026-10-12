# savvy-progress

> **Watchtower fork** of [johnnyvizz/claude-kit `plugins/savvy-progress`](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress)
> (MIT, see `LICENSE`), vendored at upstream commit `272a877`. The only change is
> the *Watchtower bridge* in `hooks/register.tsx`; everything else is upstream.
>
> **Why:** the panel's pixel crabs are SVG, which Claude Code draws only on its
> desktop surface. In a terminal — including Watchtower's xterm.js panes — the
> mod falls back to a `▣` glyph. So inside a Watchtower terminal
> (`WATCHTOWER_INSTANCE_ID` is set) the mod POSTs its state to Watchtower's
> localhost listener (`/mods/savvy-progress`, port and token from
> `listener.json` in Watchtower's support dir) on every change, and Watchtower
> draws the agents panel and the progress band natively beside the terminal,
> crabs and animations included. The terminal's own band and auto-opened pane
> stay hidden there; `/agents-info` still toggles the terminal pane. Outside
> Watchtower the mod behaves exactly as upstream.
>
> **Install** (replaces an upstream install — remove that one first, the two
> share a name): in `~/.claude/settings.json`,
>
> ```json
> { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/Watchtower/plugins/savvy-progress" } }
> ```
>
> or `claude --plugin-dir /path/to/Watchtower/plugins/savvy-progress` for one session.
>
> **Tests:** `claude plugin test plugins/savvy-progress` (bridge), plus the
> Watchtower side under `tests/` (`npm test`). The drawing is ported to
> `apps/desktop/src/components/instances/savvy/savvyDraw.ts` — keep the two in step.

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it): running, finished and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`), not a bill.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

Install instructions are in the [repository README](../../README.md).
