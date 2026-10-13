import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The Watchtower bridge: inside a Watchtower terminal the hold is posted to the
// listener named in listener.json and the answer is polled; elsewhere it is a pane.

const LISTENER = '/support/listener.json'
const TEN_MINUTES_AND_A_BIT = 10 * 60 * 1000 + 1_000

interface Post {
  hold: { id: string; command: string; summary: string; lines: unknown[] } | null
  outcome?: { id: string; command: string; decision: string }
}

type Answer = { status: number; body?: unknown; text?: string } | 'throw' | 'hang'

function world(
  on: On,
  opts: { inside: boolean; answers?: Answer[]; allFetchesThrow?: boolean; envThrowsOnce?: boolean; releasePostThrows?: boolean; fastForward?: boolean },
) {
  const clock = mock.clock(on, { now: 1_000 })
  const vars: Record<string, string> = opts.inside
    ? { WATCHTOWER_INSTANCE_ID: 'inst-1', WATCHTOWER_SUPPORT_DIR: '/support', HOME: '/home/u' }
    : { HOME: '/home/u' }
  let envThrown = false
  on('env.get', async (_$, e) => {
    if (opts.envThrowsOnce && !envThrown) {
      envThrown = true
      throw new Error('env unavailable')
    }
    return { value: vars[e.name] }
  })
  const posts: Post[] = []
  const gets: string[] = []
  const answers = [...(opts.answers ?? [])]
  const opened: { id: string }[] = []
  const toasts: string[] = []
  const calls: unknown[] = []
  let fetches = 0
  let sleeps = 0

  on('fs.read', async (_$, e) => {
    expect(e.path).toBe(LISTENER)
    return { value: JSON.stringify({ port: 7531, token: 'tok' }) }
  })
  on('http.fetch', async (_$, e) => {
    fetches++
    if (opts.allFetchesThrow) throw new Error('connection refused')
    const method = e.init?.method ?? 'GET'
    if (method === 'POST') {
      if (opts.releasePostThrows && JSON.parse(e.init?.body as string).hold === null) throw new Error('refused')
      expect(e.url).toBe('http://127.0.0.1:7531/mods/blast-radius')
      const headers = e.init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer tok')
      expect(headers['x-watchtower-instance']).toBe('inst-1')
      posts.push(JSON.parse(e.init?.body as string))
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    gets.push(e.url)
    expect(e.url).toContain('http://127.0.0.1:7531/mods/blast-radius/decision?id=')
    const a = answers.shift() ?? { status: 200, body: { decision: null } }
    if (a === 'throw') throw new Error('connection refused')
    if (a === 'hang') {
      // Never answers; the 2 s race needs the mock clock moved on once its timer exists.
      setTimeout(() => void clock.advance(2_500), 0)
      return new Promise(() => {})
    }
    return {
      value: { status: a.status, ok: a.status >= 200 && a.status < 300, headers: {}, text: a.text ?? JSON.stringify(a.body ?? {}) },
    }
  })
  // measure() takes its "could not measure" path; sleep moves the mock clock.
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'sleep') {
      sleeps++
      await clock.advance(opts.allFetchesThrow || opts.fastForward || !opts.inside ? TEN_MINUTES_AND_A_BIT : 250)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', async (_$, e) => {
    opened.push({ id: e.id })
    return { value: { isPlaced: true } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', async (_$, e) => {
    calls.push(e)
    return { result: { stdout: '', stderr: '' } }
  })
  return { posts, gets, opened, toasts, calls, fetches: () => fetches, sleeps: () => sleeps }
}

const rm = { tool: 'Bash', command: 'rm -rf dist' } as never

test('inside Watchtower: proceed from the popup runs the command', async ($, on) => {
  const w = world(on, { inside: true, answers: [{ status: 200, body: { decision: null } }, { status: 200, body: { decision: 'proceed' } }] })
  const r = await $.tool.call(rm)
  expect(r).not.toHaveProperty('deny')
  expect(w.calls.length).toBe(1)
  expect(w.posts.length).toBe(2)
  expect(w.posts[0]?.hold?.command).toBe('rm -rf dist')
  expect(typeof w.posts[0]?.hold?.id).toBe('string')
  expect(w.posts[0]?.hold?.lines.every((l) => typeof l === 'string')).toBe(true)
  expect(w.posts[1]?.hold).toBe(null)
  expect(w.posts[1]?.outcome?.decision).toBe('proceed')
  expect(w.posts[1]?.outcome?.id).toBe(w.posts[0]?.hold?.id)
  expect(w.opened).toEqual([])
  expect(w.toasts).toEqual([])
})

test('inside Watchtower: cancel from the popup denies', async ($, on) => {
  const w = world(on, { inside: true, answers: [{ status: 200, body: { decision: 'cancel' } }] })
  const r = (await $.tool.call(rm)) as { deny?: string }
  expect(r.deny).toContain('the user pressed Cancel')
  expect(w.calls.length).toBe(0)
  expect(w.posts.at(-1)?.outcome?.decision).toBe('cancel')
})

test('inside Watchtower: a 404 re-posts the hold, then proceed runs', async ($, on) => {
  const w = world(on, { inside: true, answers: [{ status: 404 }, { status: 200, body: { decision: 'proceed' } }] })
  const r = await $.tool.call(rm)
  expect(r).not.toHaveProperty('deny')
  const holds = w.posts.filter((p) => p.hold !== null)
  expect(holds.length).toBe(2)
  expect(holds[1]?.hold?.id).toBe(holds[0]?.hold?.id)
  expect(w.calls.length).toBe(1)
})

test('inside Watchtower but unreachable: times out after 10 minutes and denies', async ($, on) => {
  const w = world(on, { inside: true, allFetchesThrow: true })
  const r = (await $.tool.call(rm)) as { deny?: string }
  expect(r.deny).toContain('no answer within 10 minutes')
  expect(w.calls.length).toBe(0)
})

test('outside Watchtower: opens the pane and never touches the network', async ($, on) => {
  const w = world(on, { inside: false })
  const r = (await $.tool.call(rm)) as { deny?: string }
  expect(w.opened).toEqual([{ id: 'blast-radius' }])
  expect(w.fetches()).toBe(0)
  expect(w.posts).toEqual([])
  expect(r.deny).toContain('no answer within 10 minutes')
  expect(w.calls.length).toBe(0)
})

test('a rejecting env read denies and releases the hold lock', async ($, on) => {
  const w = world(on, { inside: true, envThrowsOnce: true, answers: [{ status: 200, body: { decision: 'proceed' } }] })
  const first = (await $.tool.call(rm)) as { deny?: string }
  expect(first.deny).toContain('Blast Radius hit an error')
  expect(w.calls.length).toBe(0)
  // The lock was released: a second risky call reaches its own hold and runs.
  const second = await $.tool.call(rm)
  expect(second).not.toHaveProperty('deny')
  expect(w.calls.length).toBe(1)
})

test('a failing release POST still returns the answer and releases the lock', async ($, on) => {
  const w = world(on, {
    inside: true,
    releasePostThrows: true,
    answers: [{ status: 200, body: { decision: 'cancel' } }, { status: 200, body: { decision: 'proceed' } }],
  })
  const first = (await $.tool.call(rm)) as { deny?: string }
  expect(first.deny).toContain('the user pressed Cancel')
  const second = await $.tool.call(rm)
  expect(second).not.toHaveProperty('deny')
  expect(w.calls.length).toBe(1)
})

test('a decision request that never answers cannot stall the 10 minute limit', async ($, on) => {
  const w = world(on, { inside: true, fastForward: true, answers: ['hang'] })
  const r = (await $.tool.call(rm)) as { deny?: string }
  expect(r.deny).toContain('no answer within 10 minutes')
  expect(w.calls.length).toBe(0)
})

test('a decision other than exactly "proceed" never runs the command', async ($, on) => {
  const w = world(on, { inside: true, fastForward: true, answers: [{ status: 200, body: { decision: 'PROCEED' } }] })
  const r = (await $.tool.call(rm)) as { deny?: string }
  expect(r.deny).toContain('no answer within 10 minutes')
  expect(w.calls.length).toBe(0)
})

test('a non-JSON decision body never runs the command', async ($, on) => {
  const w = world(on, { inside: true, fastForward: true, answers: [{ status: 200, text: 'oops' }] })
  const r = (await $.tool.call(rm)) as { deny?: string }
  expect(r.deny).toContain('no answer within 10 minutes')
  expect(w.calls.length).toBe(0)
})
