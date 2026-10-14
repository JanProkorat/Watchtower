export type TaskStatus = 'in progress' | 'done' | 'interrupted'

// One prompt a session worked on, newest last.
export type Task = { text: string; status: TaskStatus; at: number }

// What another live session in the same repository is doing, as the banner draws it.
// `where` is the peer's folder when it differs from this session's (another worktree), else null.
export type Peer = { id: string; where: string | null; tasks: Task[] }

declare module 'claude-code' {
  interface PluginState {
    'collision-guard': { peers: Peer[] }
  }
}
