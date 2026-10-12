import { useCallback, useEffect, useState } from 'react';
import {
  upsertChatItem,
  type ChatItem,
  type ChatPermissionMode,
  type ChatResponse,
  type ChatState,
} from '@watchtower/shared/chat.js';
import { invoke } from './ipc';

const INITIAL_STATE: ChatState = { busy: false, live: false, permissionMode: 'default', model: null, models: [] };

export interface ChatHandle {
  items: ChatItem[];
  state: ChatState;
  loaded: boolean;
  send(text: string): Promise<boolean>;
  interrupt(): void;
  respond(itemId: string, response: ChatResponse): void;
  setPermissionMode(mode: ChatPermissionMode): void;
  setModel(model: string | null): void;
}

/** One chat instance's conversation: the snapshot, then live `chatEvent` pushes. */
export function useChat(instanceId: string): ChatHandle {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<ChatState>(INITIAL_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setItems([]);
    setState(INITIAL_STATE);
    setLoaded(false);
    // Pushes that land while the snapshot is in flight are newer: replay them
    // over it rather than letting the snapshot overwrite them.
    const early: ChatItem[] = [];
    let snapshotIn = false;
    const off = window.watchtower.on('chatEvent', (e) => {
      if (e.instanceId !== instanceId) return;
      if (e.op === 'upsert') {
        if (!snapshotIn) early.push(e.item);
        setItems((prev) => upsertChatItem(prev, e.item));
      } else if (e.op === 'state') {
        setState(e.state);
      } else {
        setItems(e.snapshot.items);
        setState(e.snapshot.state);
      }
    });
    invoke('chat:snapshot', { instanceId })
      .then((snap) => {
        if (!alive) return;
        snapshotIn = true;
        if (snap) {
          setItems(early.reduce(upsertChatItem, snap.items));
          setState((prev) => (prev === INITIAL_STATE ? snap.state : prev));
        }
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);

  const send = useCallback(
    async (text: string) => (await invoke('chat:send', { instanceId, text })).ok,
    [instanceId],
  );
  const interrupt = useCallback(() => void invoke('chat:interrupt', { instanceId }), [instanceId]);
  const respond = useCallback(
    (itemId: string, response: ChatResponse) => void invoke('chat:respond', { instanceId, itemId, response }),
    [instanceId],
  );
  const setPermissionMode = useCallback(
    (mode: ChatPermissionMode) => void invoke('chat:setPermissionMode', { instanceId, mode }),
    [instanceId],
  );
  const setModel = useCallback(
    (model: string | null) => void invoke('chat:setModel', { instanceId, model }),
    [instanceId],
  );

  return { items, state, loaded, send, interrupt, respond, setPermissionMode, setModel };
}
