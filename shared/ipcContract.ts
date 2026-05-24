export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } }
  | { kind: 'spawnInstance'; payload: { cwd: string; args?: string[] } }
  | { kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { kind: 'killInstance'; payload: { instanceId: string } }
  | { kind: 'removeInstance'; payload: { instanceId: string } }
  | { kind: 'reorderInstances'; payload: { orderedIds: string[] } }
  | { kind: 'listInstances'; payload: Record<string, never> }
  | { kind: 'chooseDirectory'; payload: { defaultPath?: string } }
  | { kind: 'getSetting'; payload: { key: string } }
  | { kind: 'setSetting'; payload: { key: string; value: string } }
  | { kind: 'previewHookInstall'; payload: Record<string, never> }
  | { kind: 'installHooks'; payload: Record<string, never> }
  | { kind: 'uninstallHooks'; payload: Record<string, never> }
  | { kind: 'snooze'; payload: { instanceId: string | '*'; untilMs: number } }
  | { kind: 'focusChanged'; payload: { instanceId: string | null } }
  | { kind: 'sendTestNotification'; payload: Record<string, never> }
  | { kind: 'projects:list'; payload: ProjectListFilterPayload }
  | { kind: 'projects:get'; payload: { id: number } }
  | { kind: 'projects:create'; payload: ProjectInputPayload }
  | { kind: 'projects:update'; payload: { id: number; input: Partial<ProjectInputPayload> } }
  | { kind: 'projects:archive'; payload: { id: number; archived: boolean } }
  | { kind: 'projects:delete'; payload: { id: number } };

export interface ProjectListFilterPayload {
  archived?: boolean;
  kind?: 'work' | 'time_off';
  search?: string;
}

export interface ProjectInputPayload {
  name: string;
  color?: string;
  kind?: 'work' | 'time_off';
  isDefault?: boolean;
  folderPath?: string | null;
  jiraGlobs?: string[];
  description?: string | null;
}

export interface ProjectViewPayload {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  kind: 'work' | 'time_off';
  isDefault: boolean;
  folderPath: string | null;
  jiraGlobs: string[];
  description: string | null;
  createdAt: string;
  epicCount: number;
  totalMinutes: number;
}

export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number; orch: number } }
  | { kind: 'spawnInstance'; payload: { instanceId: string | null; error?: string } }
  | { kind: 'ptyWrite'; payload: { ok: true } }
  | { kind: 'ptyResize'; payload: { ok: true } }
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'removeInstance'; payload: { ok: true } }
  | { kind: 'reorderInstances'; payload: { ok: true } }
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{ id: string; cwd: string; status: string; lastActivityAt: number }>;
      };
    }
  | { kind: 'chooseDirectory'; payload: { path: string | null } }
  | { kind: 'getSetting'; payload: { value: string | null } }
  | { kind: 'setSetting'; payload: { ok: true } }
  | {
      kind: 'previewHookInstall';
      payload: {
        settingsPath: string;
        helperPath: string;
        alreadyInstalled: boolean;
        entries: Array<{ event: string; command: string; alreadyPresent: boolean }>;
        preserved: Array<{ event: string; command: string }>;
      };
    }
  | { kind: 'installHooks'; payload: { changed: boolean; backedUp: string | null } }
  | { kind: 'uninstallHooks'; payload: { changed: boolean } }
  | { kind: 'snooze'; payload: { ok: true } }
  | { kind: 'focusChanged'; payload: { ok: true } }
  | { kind: 'sendTestNotification'; payload: { ok: true } }
  | { kind: 'projects:list'; payload: { projects: ProjectViewPayload[] } }
  | { kind: 'projects:get'; payload: { project: ProjectViewPayload | null } }
  | { kind: 'projects:create'; payload: { project: ProjectViewPayload } }
  | { kind: 'projects:update'; payload: { project: ProjectViewPayload } }
  | { kind: 'projects:archive'; payload: { ok: true } }
  | { kind: 'projects:delete'; payload: { ok: true } };

export type IpcPush =
  | { kind: 'hello'; payload: { version: string } }
  | { kind: 'ptyData'; payload: { instanceId: string; chunk: string } }
  | { kind: 'ptyExit'; payload: { instanceId: string; code: number } }
  | { kind: 'stateChanged'; payload: { instanceId: string; status: string } }
  | {
      kind: 'notify';
      payload: { instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' };
    }
  | { kind: 'clearAttention'; payload: { instanceId: string } }
  | { kind: 'badge'; payload: { count: number } }
  | { kind: 'activateInstance'; payload: { instanceId: string } }
  | { kind: 'triggerNewInstance'; payload: Record<string, never> }
  | {
      kind: 'orchestratorCrashed';
      payload: { code: number | null; restarting: boolean };
    };

export interface WatchtowerBridge {
  invoke<T extends IpcRequest['kind']>(
    kind: T,
    payload: Extract<IpcRequest, { kind: T }>['payload'],
  ): Promise<Extract<IpcResponse, { kind: T }>['payload']>;
  on<T extends IpcPush['kind']>(
    kind: T,
    handler: (payload: Extract<IpcPush, { kind: T }>['payload']) => void,
  ): () => void;
}
