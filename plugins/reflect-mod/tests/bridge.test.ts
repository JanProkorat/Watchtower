import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The Watchtower bridge: inside a Watchtower terminal the pending rules are posted to the
// listener named in listener.json, nothing is drawn above the prompt, and the button the
// user pressed in Watchtower is polled and run.

const VOID = { value: undefined } as never
const ok = (value: unknown) => ({ value }) as never
const PNPM = { is_rule: true, rule: 'Use pnpm, not npm, in this repo', scope: 'project', confidence: 0.92 }
const SAY = 'нет, используй pnpm'

interface Post { version: number; items: { id: string; rule: string; scope: string; count: number }[] }
type Answer = { status: number; body?: unknown }

function world(on: On, opts: { inside: boolean; answers?: Answer[] }) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T12:00:00Z') })
  mock.store(on, {})
  mock.env(
    on,
    opts.inside ? { HOME: '/home/u', WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support' } : { HOME: '/home/u' },
  )
  const files: Record<string, string> = { '/repo/CLAUDE.md': '# Repo\n' }
  const posts: Post[] = []
  const gets: string[] = []
  const answers = [...(opts.answers ?? [])]
  let fetches = 0
  on('model.complete', async () => ok({ isAnswered: true, text: JSON.stringify(PNPM), usage: {} }))
  on('session.messages', async () => ok([{ role: 'assistant', text: 'I used npm.', toolUses: [] }]))
  on('session.root', async () => ok('/repo'))
  on('fs.exists', async (_$, e) => ok(e.path in files || e.path === '/support/listener.json'))
  on('fs.read', async (_$, e) =>
    ok(e.path === '/support/listener.json' ? JSON.stringify({ port: 7531, token: 'tok' }) : (files[e.path] ?? '')),
  )
  on('fs.write', async (_$, e) => {
    files[e.path] = e.text
    return VOID
  })
  on('prompt.read', async () => ok({ text: '', cursor: 0 }))
  on('prompt.fill', async () => ({ isFilled: true }) as never)
  on('command.register', async (_$, e) => ok({ command: e.name }))
  on('ui.toast', async () => VOID)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('prompt.compose', async () => ({ sections: [] }))
  on('http.fetch', async (_$, e) => {
    fetches++
    const headers = e.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['x-watchtower-instance']).toBe('inst-1')
    if ((e.init?.method ?? 'GET') === 'POST') {
      expect(e.url).toBe('http://127.0.0.1:7531/mods/reflect-mod')
      posts.push(JSON.parse(e.init?.body as string))
      return ok({ status: 204, ok: true, headers: {}, text: '' })
    }
    gets.push(e.url)
    expect(e.url).toBe('http://127.0.0.1:7531/mods/reflect-mod/decision?id=next')
    const a = answers.shift() ?? { status: 200, body: { decision: null } }
    return ok({ status: a.status, ok: a.status >= 200 && a.status < 300, headers: {}, text: JSON.stringify(a.body ?? {}) })
  })
  return { clock, files, posts, gets, answers, fetches: () => fetches }
}

const start = ($: Engine) => $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
async function say($: Engine, text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)
}
const mount = ($: Engine) =>
  $.ui.mount({
    plugin: 'reflect-mod',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
  })
const queueText = async ($: Engine) => (await $.command.run({ command: 'reflect-queue', args: '', origin: { kind: 'composer' } } as never)).text

test('inside Watchtower: posts the pending rules and draws nothing above the prompt', async ($, on) => {
  const w = world(on, { inside: true })
  await start($)
  await say($, SAY)
  await w.clock.advance(300)
  const last = w.posts.at(-1)
  expect(last?.version).toBe(1)
  expect(last?.items.map(i => ({ rule: i.rule, scope: i.scope, count: i.count }))).toEqual([
    { rule: 'Use pnpm, not npm, in this repo', scope: 'project', count: 1 },
  ])
  const ui = await mount($)
  expect(await ui.findAll({ type: 'Text', text: /^reflect · "/ })).toEqual([])
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
})

test('outside Watchtower: posts nothing and the band is drawn as upstream', async ($, on) => {
  const w = world(on, { inside: false })
  // Upstream's band: a stub render answer is replaced by the real handler's Box.
  await start($)
  await say($, SAY)
  await w.clock.advance(5000)
  expect(w.fetches()).toBe(0)
  expect(w.posts).toEqual([])
  const ui = await mount($)
  expect((await ui.findAll({ type: 'Text', text: /^reflect · "/ })).length).toBe(1)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(4)
})

test('a polled skip decision skips the item and re-posts the shorter list', async ($, on) => {
  const w = world(on, { inside: true })
  await start($)
  await say($, SAY)
  await w.clock.advance(300)
  const id = w.posts.at(-1)?.items[0]?.id ?? ''
  expect(id).not.toBe('')
  // Next poll answers with the click.
  w.answers.push({ status: 200, body: { decision: { itemId: id, action: 'skip' } } })
  await w.clock.advance(1600)
  await w.clock.advance(300)
  expect(w.posts.at(-1)?.items).toEqual([])
  expect(await queueText($)).toMatch(/skipped/)
})

test('an unknown action or an unknown id does nothing', async ($, on) => {
  const w = world(on, { inside: true })
  await start($)
  await say($, SAY)
  await w.clock.advance(300)
  const id = w.posts.at(-1)?.items[0]?.id ?? ''
  const before = w.posts.length
  w.answers.push(
    { status: 200, body: { decision: { itemId: id, action: 'delete' } } },
    { status: 200, body: { decision: { itemId: 'nope', action: 'skip' } } },
    { status: 200, body: { decision: { itemId: 5, action: 'skip' } } },
  )
  for (let i = 0; i < 4; i++) await w.clock.advance(1600)
  await w.clock.advance(300)
  expect(w.posts.length).toBe(before)
  expect(await queueText($)).toMatch(/pending/)
  expect(w.files['/repo/CLAUDE.md']).toBe('# Repo\n')
})
