import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Peer, Task } from '../types'

// Each session writes only its own JSON file under ~/.claude/collision-guard/<repo>/,
// so two sessions never write the same file; each reads the others' to compare.

const WINDOW_MS = 30 * 60 * 1000
const HEARTBEAT_MS = 5_000
// A session whose file has not been touched for this long is gone (crashed or closed).
const LIVE_MS = 60_000
const MAX_TASKS = 5
const TASK_CHARS = 70

type SessionFile = {
  id: string
  root: string
  seenAt: number
  isEnded: boolean
  tasks: Task[]
  // Normalized absolute path → when this session last changed it.
  edits: Record<string, number>
}

type Hit = { file: SessionFile; at: number }

const peers = atom({ plugin: 'collision-guard', key: 'peers' } as const, [])

const short = (id: string): string => id.slice(0, 8)

const ago = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 1 ? 'less than a minute ago' : `${minutes} min ago`
}

const summarize = (text: string): string => {
  const line = text.split('\n').find(l => l.trim() !== '')?.trim().replace(/\s+/g, ' ') ?? ''
  return line.length > TASK_CHARS ? `${line.slice(0, TASK_CHARS - 1)}…` : line
}

let me: SessionFile | null = null
let dir = ''
let lastPeers = ''
// Path → the peer edit time the user already said Proceed to, so one edit asks once.
const acknowledged = new Map<string, number>()

const fileOf = (id: string): string => `${dir}/${id}.json`

// Watchtower: inside a Watchtower terminal (WATCHTOWER_INSTANCE_ID set) the peer band is drawn by
// Watchtower. The mod posts the peer list to its localhost listener on every change and draws nothing.
const FETCH_TIMEOUT_MS = 2000
const POST_COALESCE_MS = 200
type Bridge = { url: string; token: string; instanceId: string }
let inWatchtower = false
let bridge: Bridge | null | undefined // undefined or null: looked up again on the next post
let postQueued = false
let lastPosted = ''
let wanted: Peer[] = []

async function discoverBridge($: EngineInterface): Promise<Bridge | null> {
  try {
    const instanceId = await $.env.get('WATCHTOWER_INSTANCE_ID')
    if (!instanceId) return null
    const home = (await $.env.get('HOME')) ?? ''
    const supportDir = (await $.env.get('WATCHTOWER_SUPPORT_DIR')) || `${home}/Library/Application Support/Watchtower`
    const sidecar = JSON.parse(await $.fs.read(`${supportDir}/listener.json`)) as { port?: number; token?: string }
    const port = Number(sidecar.port)
    const token = String(sidecar.token ?? '')
    if (!port || !token) return null
    return { url: `http://127.0.0.1:${port}/mods/collision-guard`, token, instanceId }
  } catch {
    return null
  }
}

/** Posts the body; true when Watchtower took it. Never throws. */
async function postToWatchtower($: EngineInterface, body: string): Promise<boolean> {
  try {
    if (!bridge) bridge = await discoverBridge($)
    const b = bridge
    if (!b) return false
    const res = await Promise.race([
      $.http.fetch(b.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${b.token}`, 'x-watchtower-instance': b.instanceId },
        body,
      }),
      $.clock.sleep(FETCH_TIMEOUT_MS).then(() => {
        throw new Error('timeout')
      }),
    ])
    if (res.status === 401 || res.status === 404) bridge = undefined
    return res.status >= 200 && res.status < 300
  } catch {
    bridge = undefined
    return false
  }
}

// Posts the latest peer list when it differs from the last one Watchtower took; bursts become one post.
function watchtowerSync($: EngineInterface, list: Peer[]): void {
  if (!inWatchtower) return
  wanted = list
  if (postQueued) return
  postQueued = true
  $.clock.after(POST_COALESCE_MS, () => {
    postQueued = false
    void (async () => {
      const body = JSON.stringify({ version: 1, peers: wanted })
      if (body === lastPosted) return
      if (await postToWatchtower($, body)) lastPosted = body
    })().catch(() => undefined)
  })
}

async function readAll($: EngineInterface): Promise<SessionFile[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const files: SessionFile[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      files.push(JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as SessionFile)
    } catch {
      // A file mid-write or not ours: skip it this round.
    }
  }
  return files
}

async function save($: EngineInterface): Promise<void> {
  if (me === null) return
  const now = await $.clock.now()
  me.seenAt = now
  for (const [path, at] of Object.entries(me.edits)) {
    if (now - at > WINDOW_MS) delete me.edits[path]
  }
  await $.fs.write(fileOf(me.id), JSON.stringify(me))
}

async function refresh($: EngineInterface): Promise<void> {
  if (me === null) return
  const self = me
  const now = await $.clock.now()
  const list: Peer[] = (await readAll($))
    .filter(f => f.id !== self.id && !f.isEnded && now - f.seenAt < LIVE_MS)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(f => ({ id: f.id, where: f.root === self.root ? null : f.root, tasks: f.tasks.slice(-3) }))
  const text = JSON.stringify(list)
  watchtowerSync($, list) // Watchtower: also retries a post that failed while the list stayed the same
  if (text === lastPeers) return
  lastPeers = text
  await update($, peers, () => list)
}

// Loads this session's own file, or starts one; a /clear gives the process a new id.
async function ensureMe($: EngineInterface): Promise<SessionFile> {
  const id = await $.session.id()
  if (me !== null && me.id === id) return me
  const root = await $.session.root()
  const repo = await $.session.repo()
  const home = (await $.env.get('HOME')) ?? ''
  const key = (repo?.root ?? root).replace(/[^A-Za-z0-9._-]+/g, '_')
  dir = `${home}/.claude/collision-guard/${key}`
  let restored: SessionFile | null = null
  try {
    restored = JSON.parse(await $.fs.read(fileOf(id))) as SessionFile
  } catch {
    restored = null
  }
  me = { id, root, seenAt: 0, isEnded: false, tasks: restored?.tasks ?? [], edits: restored?.edits ?? {} }
  await save($)
  return me
}

async function normalize($: EngineInterface, path: string): Promise<string> {
  const cwd = await $.session.cwd()
  const absolute = path.startsWith('/') ? path : `${cwd}/${path}`
  try {
    return (await $.fs.stat(absolute, { resolve: true })).realPath ?? absolute
  } catch {
    // A file Write is about to create: resolve its folder instead.
    const cut = absolute.lastIndexOf('/')
    try {
      const parent = (await $.fs.stat(absolute.slice(0, cut) || '/', { resolve: true })).realPath
      return parent ? `${parent}/${absolute.slice(cut + 1)}` : absolute
    } catch {
      return absolute
    }
  }
}

// Answers a refusal text when the edit must not happen, undefined to let it run.
async function check($: EngineInterface, path: string): Promise<string | undefined> {
  const self = await ensureMe($)
  const target = await normalize($, path)
  const now = await $.clock.now()
  const hits: Hit[] = (await readAll($))
    .filter(f => f.id !== self.id)
    .map(f => ({ file: f, at: f.edits?.[target] ?? 0 }))
    .filter(h => now - h.at < WINDOW_MS)
    .sort((a, b) => b.at - a.at)
  const top = hits[0]
  if (top === undefined || (acknowledged.get(target) ?? 0) >= top.at) return undefined

  const shown = target.startsWith(`${self.root}/`) ? target.slice(self.root.length + 1) : target
  const task = top.file.tasks.at(-1)
  const who =
    `session ${short(top.file.id)}` +
    (task ? ` (working on "${task.text}")` : '') +
    (top.file.isEnded ? ', now closed' : '') +
    (hits.length > 1 ? `, and ${hits.length - 1} more` : '')
  const when = ago(now - top.at)
  const question = `${shown} was changed ${when} by ${who}. Edit it anyway?`

  let answer: string
  try {
    answer = await $.ui.ask(question, { header: 'Collision', options: ['Proceed', 'Move to a worktree', 'Cancel'] })
  } catch {
    answer = 'Cancel'
  }

  const fact = `Collision Guard: ${shown} was changed ${when} by another Claude Code session (${short(top.file.id)}).`
  switch (answer) {
    case 'Proceed':
      acknowledged.set(target, top.at)
      return undefined
    case 'Move to a worktree':
      return `${fact} The user chose to move this work to a git worktree. Call EnterWorktree, then redo this edit there.`
    case 'Cancel':
      return `${fact} The user cancelled the edit. Do not change this file; ask the user how to continue.`
    default:
      return `${fact} The edit was not made. The user answered: "${answer}". Follow that.`
  }
}

async function record($: EngineInterface, path: string, done: ToolCallResult): Promise<void> {
  if (done.deny !== undefined || done.isError === true) return
  const self = await ensureMe($)
  self.edits[await normalize($, path)] = await $.clock.now()
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Watchtower: bridge state is module-level, so a reload starts clean.
    inWatchtower = Boolean(await $.env.get('WATCHTOWER_INSTANCE_ID'))
    bridge = undefined
    postQueued = false
    lastPosted = ''
    await ensureMe($)
    await refresh($)
    $.clock.every(HEARTBEAT_MS, () => {
      void save($).then(() => refresh($)).catch(() => undefined)
    })
    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.text.trim() !== '') {
      const self = await ensureMe($)
      const now = await $.clock.now()
      const tasks: Task[] = self.tasks.map(t => (t.status === 'in progress' ? { ...t, status: 'done' } : t))
      tasks.push({ text: summarize(e.text), status: 'in progress', at: now })
      self.tasks = tasks.slice(-MAX_TASKS)
      await save($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && me !== null) {
      me.tasks = me.tasks.map(t =>
        t.status === 'in progress' ? { ...t, status: e.isAborted ? 'interrupted' : 'done' } : t,
      )
      await save($)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (me !== null) {
      me.isEnded = true
      await save($)
      me = null
    }
    return next(e)
  })

  // The guard lets the edit through if it fails itself: it warns, it does not lock files.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await check($, e.file_path)
    if (deny !== undefined) return { deny }
    const done = await next(e)
    await record($, e.file_path, done)
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await check($, e.file_path)
    if (deny !== undefined) return { deny }
    const done = await next(e)
    await record($, e.file_path, done)
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const deny = await check($, e.notebook_path)
    if (deny !== undefined) return { deny }
    const done = await next(e)
    await record($, e.notebook_path, done)
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (inWatchtower) return next(e) // Watchtower: it draws the band
    const list = await read($, peers)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const mark = { 'in progress': '●', done: '✓', interrupted: '✕' } as const
    return (
      <Box flexDirection="column">
        {list.map(peer => (
          <Box key={peer.id} flexDirection="column">
            <Text color="yellow">
              ⚠ Another session here: {short(peer.id)}
              {peer.where === null ? '' : ` (in ${peer.where})`}
            </Text>
            {peer.tasks.length === 0 ? (
              <Text dimColor>{'  '}no prompt yet</Text>
            ) : (
              peer.tasks.map(t => (
                <Text key={`${peer.id}-${t.at}`} dimColor={t.status !== 'in progress'}>
                  {'  '}
                  {mark[t.status]} {t.status}: {t.text}
                </Text>
              ))
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
