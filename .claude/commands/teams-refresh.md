---
description: Refresh today's Teams/Outlook meetings into the Watchtower meetings-popover cache
---

Refresh the "today's meetings" cache that the Watchtower desktop app's
meetings popover reads (`meetings:listToday` → `parseMeetingsToday` in
`packages/shared/src/meetings.ts`).

Arguments: `$ARGUMENTS`

`$ARGUMENTS` is exactly one positional value:
- `DB_PATH` — absolute path to the Watchtower SQLite database, e.g.
  `/Users/jan/Library/Application Support/Watchtower/data.db`.

This is how the desktop app's "Refresh" button invokes you: it copies
`/teams-refresh "<db path>"` to the clipboard for the user to paste. There is
no date-range argument — this command always covers **today only**, local
time (`Europe/Prague` unless `TT_TIMEZONE` says otherwise).

If `DB_PATH` is missing, ask for it; do not guess. If the file doesn't exist,
surface a clear error and stop — do not create it.

## Steps

1. **Search today's calendar events.** Call
   `outlook_calendar_search` with:
   - `query: "*"` (match everything)
   - `afterDateTime: "today"`
   - `beforeDateTime: "tomorrow"`
   - `order: "oldest"`

   This bounds the results to events starting today, earliest first. Note
   each event's `start`/`end` come back as `{ dateTime, timeZone }` — treat
   `dateTime` as wall-clock in that `timeZone`, not UTC, when converting to
   the ISO `startsAt`/`endsAt` strings needed below.

2. **Resolve the join URL for each event.** For every event returned in
   step 1, call `read_resource` with the event's own resource `uri` (the
   calendar-event URI included in the search result, `calendar:///events/{id}`)
   to get the full event detail, then read `onlineMeeting.joinUrl` from it:
   - If the event has an `onlineMeeting` with a `joinUrl`, use that string.
   - If the event has no `onlineMeeting` (an in-person or non-Teams meeting),
     use `null`. These meetings still get cached, just without a Join
     button — the renderer skips the button when `joinUrl` is `null`.

3. **Build the `MeetingSummary[]` array.** One entry per event, matching
   `packages/shared/src/meetings.ts` exactly:

   ```json
   {
     "id": "<the event's stable id>",
     "subject": "<event subject>",
     "subtitle": "<short human string>",
     "startsAt": "<ISO 8601 start>",
     "endsAt": "<ISO 8601 end>",
     "joinUrl": "<url or null>"
   }
   ```

   - `id`, `subject`, `startsAt`, `endsAt` are **required** — an entry
     missing any of them is silently dropped by the parser (and by the
     writer script below), so don't omit them.
   - `subtitle` should be short and human, e.g. `"3 attendees"` (attendee
     count from the event) or the meeting's location `displayName` when
     there's no useful attendee count (e.g. `"Room 204"`). Empty string is
     fine if nothing useful is available.
   - `startsAt`/`endsAt` must be real ISO datetime strings (convert the
     event's local `{dateTime, timeZone}` pair to an ISO instant — don't
     pass the bare wall-clock string through as if it were UTC).

4. **Write the cache.** Save the array (or `{ "meetings": [...] }`) to a
   temp file, e.g. `/tmp/teams-meetings-today.json`, then run:

   ```
   node .claude/commands/write-meetings-cache.mjs /tmp/teams-meetings-today.json "<DB_PATH>"
   ```

   using the literal `DB_PATH` argument passed to this command (`$1`).

5. **Report the result.** Print the writer script's summary line (meeting
   count, dropped count if any, db path, syncedAt). If the script exits
   non-zero, print its full output for debugging.

## Scope notes

- Only **today's** events are fetched and cached — running this command
  again later today fully replaces the previous cache (the writer
  overwrites the whole `teams.meetings_today` settings row, it does not
  merge/append).
- Declined or cancelled events: use judgement — if `outlook_calendar_search`
  returns them, prefer excluding events the user has declined so the
  popover doesn't show meetings they're skipping. Cancelled events should
  always be excluded.
- Non-Teams / in-person meetings are cached with `joinUrl: null` and simply
  render without a Join button in the popover — this is expected, not an
  error.
- If the Microsoft 365 MCP returns an authentication error, surface it
  verbatim so the user knows to re-authenticate — do not write a partial or
  empty cache in that case.
