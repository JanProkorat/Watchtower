import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The Watchtower bridge: inside a Watchtower terminal the peer list is posted to the
// listener named in listener.json and nothing is drawn above the prompt.

const NOW = 1_800_000_000_000
const PEER_ID = 'peer0000-1111-2222-3333-444444444444'

interface Post { version: number; peers: { id: string; where: string | null; tasks: { text: string; status: string; at: number }[] }[] }

function world(on: On, inside: boolean) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(
    on,
    inside ? { HOME: '/home/t', WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support' } : { HOME: '/home/t' },
  )
  const files = new Map<string, string>()
  const peer = {
    id: PEER_ID,
    root: '/proj',
    seenAt: NOW - 1000,
    isEnded: false,
    tasks: [{ text: 'Refactor the inbox panel', status: 'in progress', at: NOW - 600_000 }],
    edits: {},
  }
  const posts: Post[] = []
  let fetches = 0
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'self0000-1111-2222-3333-444444444444' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false } as never }))
  on('fs.list', (_$, e) => ({
    value: [...files.keys(), `${e.path}/${PEER_ID}.json`]
      .filter(p => p.startsWith(`${e.path}/`))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false }) as never),
  }))
  on('fs.read', (_$, e) => {
    if (e.path === '/support/listener.json') return { value: JSON.stringify({ port: 7531, token: 'tok' }) }
    if (e.path.endsWith(`/${PEER_ID}.json`)) return { value: JSON.stringify(peer) }
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: [''] }))
  on('http.fetch', async (_$, e) => {
    fetches++
    expect(e.url).toBe('http://127.0.0.1:7531/mods/collision-guard')
    const headers = e.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['x-watchtower-instance']).toBe('inst-1')
    posts.push(JSON.parse(e.init?.body as string))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  return { posts, peer, clock, fetches: () => fetches }
}

const mountBand = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.ui.mount({
    plugin: 'collision-guard',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
  })

test('inside Watchtower: posts the peers on change and draws nothing above the prompt', async ($, on) => {
  const w = world(on, true)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
  await w.clock.advance(300)
  expect(w.posts.length).toBe(1)
  expect(w.posts[0]?.version).toBe(1)
  expect(w.posts[0]?.peers.map(p => p.id)).toEqual([PEER_ID])
  expect(w.posts[0]?.peers[0]?.where).toBe(null)
  expect(w.posts[0]?.peers[0]?.tasks[0]?.text).toBe('Refactor the inbox panel')

  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: /Another session here/ })).toBeUndefined()

  // Nothing changed: the heartbeat refreshes without a second post.
  w.peer.seenAt = NOW + 4000
  await w.clock.advance(5000)
  expect(w.posts.length).toBe(1)

  // The peer's task changed: one more post.
  w.peer.tasks = [{ text: 'Refactor the inbox panel', status: 'done', at: NOW - 600_000 }]
  w.peer.seenAt = NOW + 9000
  await w.clock.advance(5000)
  await w.clock.advance(300)
  expect(w.posts.length).toBe(2)
  expect(w.posts[1]?.peers[0]?.tasks[0]?.status).toBe('done')
})

test('outside Watchtower: posts nothing and the band is drawn as upstream', async ($, on) => {
  const w = world(on, false)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
  await w.clock.advance(1000)
  expect(w.fetches()).toBe(0)
  expect(w.posts).toEqual([])
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: /Another session here: peer0000/ })).toBeDefined()
})
