import { mock } from 'claude-code/testing'

export type World = {
  os: 'darwin' | 'linux' | 'win32'
  env: Record<string, string>
  cwd: string
  top: string
  dirs: Record<string, [string, 'file' | 'dir'][]>
  status: string
  numstat: string
  exits?: Record<string, [number, string]>
  delays?: Record<string, number[]>
  denied?: string[]
  heads?: string[]
  tool?: (e: any) => unknown
  find?: string
  theme?: { toml: string; mtimeMs: number }
  du?: Record<string, string>
  duDelays?: number[]
  links?: string[]
  files?: Record<string, string>
}
export type Ran = string[][]
export const opens: unknown[] = []
export const envs: Record<string, string>[] = []

export function world(on: any, w: World, ran: Ran) {
  mock.env(on, w.env)
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_$: any, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_$: any, e: any) => {
    ran.push(['toast', String(e.text ?? e.message ?? JSON.stringify(e))])
    return { value: undefined }
  })
  const isTheme = (p: string) => p.replace(/\\/g, '/').endsWith('/.local/state/omarchy/current/theme/colors.toml')
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')
  on('fs.read', (_$: any, e: any) => {
    if (w.theme && isTheme(e.path)) return { value: w.theme.toml }
    const file = norm(e.path).replace(/^[A-Za-z]:/, '')
    if (w.files && file in w.files) return { value: w.files[file] }
    throw new Error('no theme file')
  })
  const dirOf = (p: string) => w.dirs[p] ?? w.dirs[p.replace(/^[A-Za-z]:/, '')]
  on('fs.list', async (_$: any, e: any) => {
    const path = norm(e.path)
    const bare = path.replace(/^[A-Za-z]:/, '')
    if (w.denied?.includes(bare)) return { deny: `EACCES: permission denied, scandir '${path}'` }
    const kids = dirOf(path)
    if (!kids) throw new Error(`ENOENT ${e.path}`)
    const value = kids.map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 1_700_000_000_000, isLink: w.links?.includes(`${bare}/${name}`) ?? false }))
    const delay = w.delays?.[bare]?.shift()
    if (delay) await clock.sleep(delay)
    return { value }
  })
  on('fs.stat', (_$: any, e: any) => {
    if (isTheme(e.path)) {
      ran.push(['theme-stat'])
      if (!w.theme) throw new Error(`ENOENT ${e.path}`)
      return { value: { kind: 'file', size: w.theme.toml.length, mtimeMs: w.theme.mtimeMs, isLink: false } }
    }
    const p = norm(e.path)
    const parent = p.slice(0, p.lastIndexOf('/')) || '/'
    const name = p.slice(p.lastIndexOf('/') + 1)
    const hit = dirOf(p) ? 'dir' : dirOf(parent)?.find(([n]) => n === name)?.[1]
    if (!hit) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: hit, size: 1, mtimeMs: name === 'a.ts' ? 1_800_000_000_500 : 1_700_000_000_000, isLink: false } }
  })
  on('process.run', async (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    ran.push(argv)
    if (e.init?.env) envs.push(e.init.env)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const exit = w.exits?.[argv[0] ?? '']
    if (exit) return { value: { exitCode: exit[0], stdout: '', stderr: exit[1], isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'find' && w.find !== undefined) return ok(w.find)
    if (argv[0] === 'du') {
      const delay = w.duDelays?.shift()
      if (delay) await clock.sleep(delay)
      return ok(w.du?.[argv.at(-1) ?? ''] ?? '')
    }
    if (argv[0] === 'uname') return ok(w.os === 'darwin' ? 'Darwin\n' : 'Linux\n')
    if (argv[0] === 'sh') return ok('missing\n')
    if (argv[0] === 'git') {
      const verb = argv.slice(4).find(a => !a.startsWith('-'))
      if (verb === 'rev-parse' && argv.at(-1) === 'HEAD') return ok(`${(w.heads && w.heads.length > 1 ? w.heads.shift() : w.heads?.[0]) ?? ''}\n`)
      if (verb === 'rev-parse') return w.top ? ok(`\n${w.top}\n`) : { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
      if (verb === 'status') return ok(w.status)
      if (verb === 'diff') return ok(w.numstat)
      if (verb === 'ls-files') {
        const files: string[] = []
        for (const [dir, kids] of Object.entries(w.dirs)) for (const [name, kind] of kids) if (kind === 'file' && dir.startsWith(w.top)) files.push(`${dir}/${name}`.slice(w.top.length + 1))
        return ok(files.join('\0'))
      }
      return ok('')
    }
    return ok('')
  })
  on('tool.call', (_$: any, e: any) => (w.tool?.(e) ?? { result: { stdout: '', stderr: '' } }) as any)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return clock
}
