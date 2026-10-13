import { expect, test } from 'claude-code/testing'
import { opens, world } from './world'

const LISTENER = { '/support/listener.json': JSON.stringify({ port: 7531, token: 'tok' }) }
const W = { os: 'darwin' as const, env: { HOME: '/home/u' }, cwd: '/repo', top: '/repo', dirs: { '/repo': [['a.ts', 'file']] as [string, 'file' | 'dir'][] }, status: '', numstat: '', files: LISTENER }
const INSIDE = { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support' }
const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }

function bridge(on: any) {
  const bodies: any[] = []
  on('ui.panes', async () => ({ value: [] }))
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
