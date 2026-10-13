import { expect, test } from 'claude-code/testing'
import { opens, world } from './world'

const LISTENER = { '/support/listener.json': JSON.stringify({ port: 7531, token: 'tok' }) }
const W = { os: 'darwin' as const, env: { HOME: '/home/u' }, cwd: '/repo', top: '/repo', dirs: { '/repo': [['a.ts', 'file']] as [string, 'file' | 'dir'][] }, status: '', numstat: '', files: LISTENER }
const INSIDE = { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support' }
const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }

function bridge(on: any, panes: { id: string }[] = []) {
  const bodies: any[] = []
  on('ui.panes', async () => ({ value: panes }))
  on('http.fetch', async (_$: unknown, e: { url: string; init: { body: string } }) => {
    bodies.push({ url: e.url, ...JSON.parse(e.init.body) })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  return bodies
}

test('inside Watchtower the pane never opens; /filetree toggles the tab', async ($, on) => {
  const seen = opens.length
  const clock = world(on, { ...W, env: { ...W.env, ...INSIDE } }, [])
  const bodies = bridge(on)
  await $.session.start(start)
  await clock.advance(1_000)
  // The baseline snapshot lets Watchtower treat the first toggle as a change.
  expect(bodies.some(b => b.panelToggles === 0 && b.activity.length === 0)).toBe(true)
  const r = await $.command.run({ command: 'filetree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  await clock.advance(250)
  expect(opens.slice(seen)).toEqual([])
  expect(r.text).toBe('File tree toggled in Watchtower.')
  expect(bodies.at(-1)).toMatchObject({ url: 'http://127.0.0.1:7531/mods/filetree', version: 1, panelToggles: 1 })
})

test('Claude reading and writing files posts activity', async ($, on) => {
  const clock = world(on, { ...W, env: { ...W.env, ...INSIDE } }, [])
  const bodies = bridge(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' } as never)
  await clock.advance(250)
  expect(bodies.at(-1)?.activity.map((a: { kind: string; path: string }) => `${a.kind} ${a.path}`)).toEqual(['read /repo/a.ts', 'write /repo/a.ts'])
})

test('outside Watchtower: the pane opens as upstream and nothing is posted', async ($, on) => {
  const seen = opens.length
  const clock = world(on, W, [])
  const bodies = bridge(on)
  await $.session.start(start)
  await clock.advance(1_000)
  expect(opens.length).toBeGreaterThan(seen)
  expect(bodies).toEqual([])
})

const MOVED = { ...W, dirs: { ...W.dirs, '/other': [['b.ts', 'file']] as [string, 'file' | 'dir'][] } }

test('a failing listener never makes the mod dock a pane, and a later post recovers', async ($, on) => {
  const seen = opens.length
  const w = { ...MOVED, env: { ...MOVED.env, ...INSIDE } }
  const clock = world(on, w, [])
  const state = { status: 404 }
  const bodies: any[] = []
  on('ui.panes', async () => ({ value: [] }))
  on('http.fetch', async (_$: unknown, e: { url: string; init: { body: string } }) => {
    bodies.push({ status: state.status, ...JSON.parse(e.init.body) })
    return { value: { status: state.status, ok: state.status < 300, headers: {}, text: '' } }
  })
  on('classic.CwdChanged', () => ({}))
  await $.session.start(start)
  await clock.advance(1_000)
  expect(bodies.length).toBe(1)
  w.cwd = '/other'
  await $.classic.CwdChanged({ old_cwd: '/repo', new_cwd: '/other' } as any)
  await clock.advance(1_000)
  expect(opens.slice(seen)).toEqual([])
  state.status = 204
  await $.tool.call({ tool: 'Read', file_path: '/other/b.ts' } as never)
  await clock.advance(250)
  expect(bodies.at(-1)).toMatchObject({ status: 204, activity: [{ kind: 'read', path: '/other/b.ts' }] })
})

test('inside Watchtower with no listener.json the pane never opens', async ($, on) => {
  const seen = opens.length
  const clock = world(on, { ...W, env: { ...W.env, ...INSIDE }, files: {} }, [])
  const bodies = bridge(on)
  await $.session.start(start)
  await clock.advance(1_000)
  expect(opens.slice(seen)).toEqual([])
  expect(bodies).toEqual([])
})

test('/filetree inside Watchtower closes a pane that was left open', async ($, on) => {
  const clock = world(on, { ...W, env: { ...W.env, ...INSIDE } }, [])
  const bodies = bridge(on, [{ id: 'filetree' }])
  const closed: unknown[] = []
  on('ui.close', async (_$: unknown, e: unknown) => { closed.push(e); return { value: undefined } })
  await $.session.start(start)
  await clock.advance(1_000)
  closed.length = 0
  await $.command.run({ command: 'filetree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(closed).toMatchObject([{ id: 'filetree' }])
  await clock.advance(250)
  expect(bodies.at(-1)).toMatchObject({ panelToggles: 1 })
})
