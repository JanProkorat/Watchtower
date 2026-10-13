import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The Watchtower bridge: inside a Watchtower terminal the mod posts its state to
// the listener named in listener.json; anywhere else it posts nothing.

const LISTENER = '/support/listener.json'

// What the engine answers beneath the mod at session start.
function engine(on: On): void {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('settings.read', async () => ({ value: {} }))
}
const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }

test('posts a snapshot to the Watchtower listener', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engine(on)
  mock.env(on, { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support', HOME: '/home/u' })
  const posts: { url: string; init: unknown }[] = []
  on('fs.read', async (_$, e) => {
    expect(e.path).toBe(LISTENER)
    return { value: JSON.stringify({ port: 7531, token: 'tok' }) }
  })
  on('http.fetch', async (_$, e) => {
    posts.push({ url: e.url, init: e.init })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start(start)
  await clock.advance(250)

  expect(posts.length).toBe(1)
  expect(posts[0]?.url).toBe('http://127.0.0.1:7531/mods/savvy-progress')
  const init = posts[0]?.init as { method: string; headers: Record<string, string>; body: string }
  expect(init.method).toBe('POST')
  expect(init.headers.authorization).toBe('Bearer tok')
  expect(init.headers['x-watchtower-instance']).toBe('inst-1')
  const body = JSON.parse(init.body) as { version: number; flow: unknown; agents: unknown[] }
  expect(body.version).toBe(1)
  expect(body.flow).toBe(null)
  expect(body.agents).toEqual([])
})

test('/agents-info inside Watchtower toggles its panel, not a terminal pane', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engine(on)
  mock.env(on, { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support', HOME: '/home/u' })
  on('fs.read', async () => ({ value: JSON.stringify({ port: 7531, token: 'tok' }) }))
  const bodies: { panelToggles: number }[] = []
  on('http.fetch', async (_$, e) => {
    bodies.push(JSON.parse((e.init as { body: string }).body))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  const opened: string[] = []
  const closed: string[] = []
  on('ui.panes', async () => ({ value: [{ id: 'savvy-agents' }] }))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: undefined }
  })
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start(start)
  await clock.advance(250)
  expect(bodies.at(-1)?.panelToggles).toBe(0)

  const r = await $.command.run({
    command: 'agents-info',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  await clock.advance(250)
  expect(r.text).toBe('Agents panel toggled in Watchtower.')
  expect(bodies.at(-1)?.panelToggles).toBe(1)
  expect(opened).toEqual([])
  // A terminal pane left open from before closes, so the two never double up.
  expect(closed).toEqual(['savvy-agents'])
})

test('posts nothing outside Watchtower', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engine(on)
  mock.env(on, { HOME: '/home/u' })
  let fetches = 0
  on('http.fetch', async () => {
    fetches++
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start(start)
  await clock.advance(250)
  expect(fetches).toBe(0)
})
