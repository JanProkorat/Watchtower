import { expect, mock, test, tier } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionStartInput, TurnCompleteInput } from 'claude-code'

tier('user')

// The Watchtower bridge: inside a Watchtower terminal the band is posted to the
// listener named in listener.json and nothing is drawn above the prompt.

const START = 1_000_000
const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const bandProps: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 75,
  scroll: { offset: 0, bodyRows: 10 }, view: {},
}
const turn = (): TurnCompleteInput => ({
  answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer',
  usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 500, model: 'claude-fable-5-1' },
})

interface Post { version: number; band: { state: string; text: string } | null }

function world(on: On, inside: boolean) {
  mock.store(on, {})
  const vars: Record<string, string> = inside
    ? { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support', HOME: '/home/u' }
    : { HOME: '/home/u' }
  on('env.get', (_$, e) => ({ value: vars[e.name] }))
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 1000000, tokens: undefined }, rateLimits: [] } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.SessionStart', () => ({}))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', (_$, e) => _$.ui.resolve(e).Text({ children: [''] }))
  const posts: Post[] = []
  let fetches = 0
  on('fs.read', async (_$, e) => {
    expect(e.path).toBe('/support/listener.json')
    return { value: JSON.stringify({ port: 7531, token: 'tok' }) }
  })
  on('http.fetch', async (_$, e) => {
    fetches++
    expect(e.url).toBe('http://127.0.0.1:7531/mods/cache-tax')
    const headers = e.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['x-watchtower-instance']).toBe('inst-1')
    posts.push(JSON.parse(e.init?.body as string))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  return { posts, fetches: () => fetches }
}

const keepwarm = { command: 'keepwarm', args: '90m', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never

test('inside Watchtower: posts the band and draws nothing above the prompt', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on, true)
  await $.session.start(session)
  await $.command.run(keepwarm)
  await $.turn.complete(turn())
  await clock.advance(300)
  const last = w.posts.at(-1)
  expect(last?.version).toBe(1)
  expect(last?.band?.state).toBe('warm')
  expect(last?.band?.text).toMatch(/^keepwarm 1h30m left · ping in/)
  const ui = await $.ui.mount({ plugin: 'cache-tax', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  expect(await ui.find({ type: 'Image' })).toBe(undefined)
  expect(await ui.find({ text: 'cache-tax' })).toBe(undefined)
  // An identical state is not posted again.
  const n = w.posts.length
  await clock.advance(1000)
  expect(w.posts.length).toBe(n)
  // Turning keepwarm off posts a null band.
  await $.command.run({ ...(keepwarm as object), args: 'off' } as never)
  await clock.advance(300)
  expect(w.posts.at(-1)?.band).toBe(null)
})

test('outside Watchtower: posts nothing and the band is drawn as upstream', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on, false)
  await $.session.start(session)
  await $.command.run(keepwarm)
  await $.turn.complete(turn())
  await clock.advance(20_000)
  const ui = await $.ui.mount({ plugin: 'cache-tax', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  expect(w.fetches()).toBe(0)
  expect(w.posts).toEqual([])
  expect(await ui.find({ type: 'Image' })).not.toBe(undefined)
  expect((await ui.find({ type: 'Text', text: 'cache-tax' }))?.text).toMatch(/warm.*ping in/)
})
