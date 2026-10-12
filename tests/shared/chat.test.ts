import { describe, it, expect } from 'vitest';
import { upsertChatItem, CHAT_PERMISSION_MODES, type ChatItem } from '@watchtower/shared/chat.js';

describe('upsertChatItem', () => {
  it('replaces by id in place, else appends', () => {
    const a: ChatItem = { kind: 'user', id: 'a', text: '1' };
    const b: ChatItem = { kind: 'user', id: 'b', text: '2' };
    const list = upsertChatItem(upsertChatItem([], a), b);
    expect(list.map((i) => i.id)).toEqual(['a', 'b']);
    const next = upsertChatItem(list, { ...a, text: 'changed' });
    expect(next).toEqual([{ kind: 'user', id: 'a', text: 'changed' }, b]);
    expect(list[0]).toBe(a); // the old list is untouched
  });

  it('offers the four session modes', () => {
    expect(CHAT_PERMISSION_MODES.map((m) => m.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });
});
