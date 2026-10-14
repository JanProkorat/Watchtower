import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = 1_800_000_000_000
const TARGET = '/proj/src/a.ts'
const PEER_ID = 'peer0000-1111-2222-3333-444444444444'

// An in-memory folder with one other session that edited TARGET `minutesAgo` minutes ago.
function world(on: On, minutesAgo: number, answer: string) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/t' })
  const files = new Map<string, string>()
  const peer = {
    id: PEER_ID,
    root: '/proj',
    seenAt: NOW - 1000,
    isEnded: false,
    tasks: [{ text: 'Refactor the inbox panel', status: 'in progress', at: NOW - 600_000 }],
    edits: { [TARGET]: NOW - minutesAgo * 60_000 },
  }
  const asked: string[] = []
  const edits: string[] = []

  on('session.id', () => ({ value: 'self0000-1111-2222-3333-444444444444' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false } as never }))
  on('fs.list', ($, e) => ({
    value: [...files.keys(), `${e.path}/${PEER_ID}.json`]
      .filter(p => p.startsWith(`${e.path}/`))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false }) as never),
  }))
  on('fs.read', ($, e) => {
    if (e.path.endsWith(`/${PEER_ID}.json`)) return { value: JSON.stringify(peer) }
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', ($, e) => ({ value: { realPath: e.path } as never }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    return { result: { questions: e.questions, answers: { [question]: answer } } as never }
  })
  on('tool.call', { tool: 'Edit' }, ($, e) => {
    edits.push(e.file_path)
    return { result: {} as never }
  })
  return { asked, edits, peer, clock }
}

const EDIT = { tool: 'Edit', file_path: TARGET, old_string: 'a', new_string: 'b', replace_all: false } as const

test('a recent edit by another session asks, and Cancel refuses the edit', async ($, on) => {
  const { asked, edits } = world(on, 5, 'Cancel')
  const done = await $.tool.call(EDIT)
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('src/a.ts was changed 5 min ago by session peer0000')
  expect(asked[0]).toContain('Refactor the inbox panel')
  expect(done.deny).toContain('cancelled')
  expect(edits.length).toBe(0)
})

test('Proceed runs the edit and does not ask again for the same peer edit', async ($, on) => {
  const { asked, edits } = world(on, 5, 'Proceed')
  await $.tool.call(EDIT)
  await $.tool.call(EDIT)
  expect(asked.length).toBe(1)
  expect(edits.length).toBe(2)
})

test('Move to a worktree tells the model to use EnterWorktree', async ($, on) => {
  world(on, 5, 'Move to a worktree')
  const done = await $.tool.call(EDIT)
  expect(done.deny).toContain('EnterWorktree')
})

test('free text under Other is handed to the model', async ($, on) => {
  world(on, 5, 'wait until the other session commits')
  const done = await $.tool.call(EDIT)
  expect(done.deny).toContain('The user answered: "wait until the other session commits"')
})

test('an edit older than 30 minutes passes without asking', async ($, on) => {
  const { asked, edits } = world(on, 40, 'Cancel')
  const done = await $.tool.call(EDIT)
  expect(asked.length).toBe(0)
  expect(done.deny).toBeUndefined()
  expect(edits.length).toBe(1)
})

test('the banner lists the other session and follows it from in progress to done', async ($, on) => {
  const { peer, clock } = world(on, 5, 'Cancel')
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'collision-guard',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    expect(await band.find({ type: 'Text', text: /Another session here: peer0000/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /in progress: Refactor the inbox panel/ })).toBeDefined()
    await band.unmount()
  }

  peer.tasks = [{ text: 'Refactor the inbox panel', status: 'done', at: NOW - 600_000 }]
  peer.seenAt = NOW + 4000
  await clock.advance(5000)
  const band = await $.ui.mount({
    plugin: 'collision-guard',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
  })
  expect(await band.find({ type: 'Text', text: /done: Refactor the inbox panel/ })).toBeDefined()
  await band.unmount()
})
