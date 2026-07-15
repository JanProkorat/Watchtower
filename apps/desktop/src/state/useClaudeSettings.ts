import { useCallback, useEffect, useState } from 'react';
import type { ClaudeSettingsReadPayload } from '@watchtower/shared/ipcContract.js';
import { invoke } from './ipc';

export type SettingsScope = 'global' | 'project';

interface State {
  loading: boolean;
  /** Resolved absolute path of the file we're reading. */
  path: string;
  /** Whether the file existed on disk at last read. */
  exists: boolean;
  /** Raw file content as last read from disk (or the saved-write value). */
  saved: string;
  /** The current draft in the editor — equal to `saved` when nothing pending. */
  draft: string;
  /** Last load / save error if any. */
  error: string | null;
}

/**
 * State for the Settings → settings.json tab.
 *
 * `saved` is the on-disk truth as of the last successful read or write.
 * `draft` is what the editor currently shows. `isDirty = saved !== draft`
 * drives the "Unsaved changes" badge + Save button affordance.
 *
 * A scope/path change triggers a refetch and resets draft to the new saved
 * value (any unsaved edits in the previous scope are dropped — the UI
 * should warn before letting the user switch).
 */
export interface UseClaudeSettingsResult extends State {
  isDirty: boolean;
  setDraft(content: string): void;
  /** Drop the draft and revert to the last on-disk content. */
  revert(): void;
  /** Write the draft. Resolves with the backup path on success. */
  save(): Promise<{ backupPath?: string }>;
  /** Re-read from disk (drops any unsaved draft). */
  refresh(): Promise<void>;
}

const EMPTY_FILE_TEMPLATE = '{\n}\n';

export function useClaudeSettings(scope: SettingsScope, projectPath?: string): UseClaudeSettingsResult {
  const [state, setState] = useState<State>({
    loading: true,
    path: '',
    exists: false,
    saved: '',
    draft: '',
    error: null,
  });

  const refresh = useCallback(async () => {
    if (scope === 'project' && !projectPath) {
      setState({
        loading: false,
        path: '',
        exists: false,
        saved: '',
        draft: '',
        error: null,
      });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = (await invoke('claudeSettings:read', {
        scope,
        projectPath,
      })) as ClaudeSettingsReadPayload;
      // Show a minimal valid JSON template when the file doesn't exist so
      // the editor isn't dropped into a confusing blank state. The user
      // can save it to actually create the file.
      const initial = res.exists ? res.content : EMPTY_FILE_TEMPLATE;
      setState({
        loading: false,
        path: res.path,
        exists: res.exists,
        saved: initial,
        draft: initial,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [scope, projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setDraft = useCallback((content: string) => {
    setState((s) => ({ ...s, draft: content }));
  }, []);

  const revert = useCallback(() => {
    setState((s) => ({ ...s, draft: s.saved }));
  }, []);

  const save = useCallback(async (): Promise<{ backupPath?: string }> => {
    const res = await invoke('claudeSettings:write', {
      scope,
      projectPath,
      content: state.draft,
    });
    if (!res.ok) {
      const message = res.error ?? 'Save failed';
      setState((s) => ({ ...s, error: message }));
      throw new Error(message);
    }
    setState((s) => ({
      ...s,
      saved: s.draft,
      exists: true,
      error: null,
    }));
    return { backupPath: res.backupPath };
  }, [scope, projectPath, state.draft]);

  return {
    ...state,
    isDirty: state.saved !== state.draft,
    setDraft,
    revert,
    save,
    refresh,
  };
}
