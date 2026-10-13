import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The Watchtower bridge: inside a Watchtower terminal each turn's edits are posted to
// the listener named in listener.json and /replay toggles Watchtower's Replay tab;
// elsewhere the mod draws its own band and pane.

const LISTENER = '/support/listener.json'

interface Step {
  file: string
  tool: string
  note: string
  added: number
  deleted: number
  lines: { kind: string; text: string }[]
}
interface Post {
  version: number
  panelToggles: number
  turn: { at: number; steps: Step[] } | null
  sentAt: number
}

function world(on: On, opts: { inside: boolean }) {
  const clock = mock.clock(on, { now: 1_000 })
  const vars: Record<string, string> = opts.inside
    ? { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support', HOME: '/home/u' }
    : { HOME: '/home/u' }
  on('env.get', async (_$, e) => ({ value: vars[e.name] }))
  on('fs.read', async (_$, e) => {
    expect(e.path).toBe(LISTENER)
    return { value: JSON.stringify({ port: 7531, token: 'tok' }) }
  })
  on('fs.exists', async () => ({ value: false }))
  const posts: Post[] = []
  let fetches = 0
  on('http.fetch', async (_$, e) => {
    fetches++
    expect(e.url).toBe('http://127.0.0.1:7531/mods/replay-theater')
    const headers = e.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['x-watchtower-instance']).toBe('inst-1')
    expect(headers['content-type']).toBe('application/json')
    posts.push(JSON.parse(e.init?.body as string))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  const opened: { id: string }[] = []
  on('ui.open', async (_$, e) => {
    opened.push({ id: e.id })
    return { value: { isPlaced: true } }
  })
  // The host's own AbovePrompt: nothing drawn.
  on('ui.render', ($, e) => $.ui.resolve(e as never).Box({ children: [] }) as never)
  on('ui.close',async () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  // The engine's own ends of the chains the mod hooks.
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', async () => ({ result: { stdout: '', stderr: '' } }) as never)
  return { clock, posts, opened, fetches: () => fetches }
}

const edit = (n = 0) => ({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: n ? `a${n}` : 'a', new_string: n ? `b${n}` : 'b' }) as never

async function turnWith($: any, edits: unknown[]) {
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (const e of edits) await $.tool.call(e)
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
}

test('inside Watchtower: session start posts a baseline', async ($, on) => {
  const w = world(on, { inside: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  await w.clock.settle()
  expect(w.posts.length).toBe(1)
  expect(w.posts[0]).toMatchObject({ version: 1, panelToggles: 0, turn: null })
})

test('inside Watchtower: a turn with one edit posts its step and draws no band', async ($, on) => {
  const w = world(on, { inside: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  await turnWith($, [edit()])
  await w.clock.settle()
  const last = w.posts.at(-1)
  expect(last?.turn?.steps.length).toBe(1)
  expect(last?.turn?.steps[0]).toMatchObject({ file: 'src/a.ts', tool: 'Edit', added: 1, deleted: 1 })
  expect(last?.turn?.steps[0]?.lines).toContainEqual({ kind: 'del', text: 'a' })
  expect(last?.turn?.steps[0]?.lines).toContainEqual({ kind: 'add', text: 'b' })
  expect(w.opened).toEqual([])
  const ui = await $.ui.mount({ plugin: 'replay-theater', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  await w.clock.settle()
  expect(JSON.stringify(await ui.drawn())).not.toContain('Replay')
  await ui.unmount()
})

test('inside Watchtower: /replay toggles the tab and opens no pane', async ($, on) => {
  const w = world(on, { inside: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  await turnWith($, [edit()])
  const r = (await $.command.run({ command: 'replay' } as any)) as { text?: string }
  await w.clock.settle()
  expect(r.text).toBe('Replay Theater: toggled in Watchtower.')
  const last = w.posts.at(-1)
  expect(last?.panelToggles).toBe(1)
  expect(last?.turn?.steps.length).toBe(1)
  expect(w.opened).toEqual([])
})

test('inside Watchtower: a turn is capped at 50 steps', async ($, on) => {
  const w = world(on, { inside: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  await turnWith($, Array.from({ length: 60 }, (_, i) => edit(i + 1)))
  await w.clock.settle()
  expect(w.posts.at(-1)?.turn?.steps.length).toBe(50)
})

test('inside Watchtower: lines are capped at 200 per step and 500 chars', async ($, on) => {
  const w = world(on, { inside: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  const big = Array.from({ length: 300 }, (_, i) => `${i}${'x'.repeat(600)}`).join('\n')
  await turnWith($, [{ tool: 'Write', file_path: '/repo/big.txt', content: big }])
  await w.clock.settle()
  const step = w.posts.at(-1)?.turn?.steps[0]
  expect(step?.lines.length).toBe(200)
  expect(step?.lines.every((l) => l.text.length <= 500)).toBe(true)
})

test('outside Watchtower: no network, /replay opens the pane', async ($, on) => {
  const w = world(on, { inside: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  await turnWith($, [edit()])
  // upstream waits 200 ms before opening the pane
  const pending = $.command.run({ command: 'replay' } as any)
  setTimeout(() => void w.clock.advance(250), 0)
  const r = (await pending) as { text?: string }
  await w.clock.settle()
  expect(w.fetches()).toBe(0)
  expect(w.opened).toEqual([{ id: 'replay-theater' }])
  expect(r.text).toBe('Replay Theater: 1 edits')
})
