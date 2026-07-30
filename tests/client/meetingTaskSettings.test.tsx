// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../apps/desktop/src/theme';
import { ToastProvider } from '../../apps/desktop/src/state/useToast';
import {
  MeetingTaskSettings,
  MEETINGS_DEFAULT_TASK_KEY,
  MEETINGS_ONE_ON_ONE_TASK_KEY,
  MEETINGS_ALL_COMPANY_TASK_KEY,
} from '../../apps/desktop/src/components/settings/MeetingTaskSettings';

// Meeting routing used to hardcode GREEN-100 (1:1 / .NET sync) and GREEN-34
// (all-company) inside the logger script. Both are now settings, and an unset
// rule reports its meetings as unresolved rather than filing them under the
// default task — so each row must read and write its OWN key, and must say so
// while it is unset.

const TASKS: Record<string, { id: number; number: string; title: string }> = {
  'GREEN-100': { id: 11, number: 'GREEN-100', title: '1:1 + syncs' },
  'GREEN-34': { id: 22, number: 'GREEN-34', title: 'Celofiremní porada' },
  'GREEN-345': { id: 33, number: 'GREEN-345', title: 'Sprint 19' },
  'GREEN-777': { id: 77, number: 'GREEN-777', title: 'Syncs 2026' },
};

function joined(t: { id: number; number: string; title: string }) {
  return {
    ...t,
    epicName: 'Meetings',
    projectName: 'Green Code',
    projectColor: '#22c55e',
  };
}

function mount(settings: Record<string, string>) {
  const setSetting = vi.fn(async () => ({ ok: true }));
  const invokeMock = vi.fn(async (kind: string, payload: any) => {
    switch (kind) {
      case 'getSetting':
        return { value: settings[payload.key] ?? '' };
      case 'setSetting':
        return setSetting(payload);
      case 'tasks:findById': {
        const t = Object.values(TASKS).find((x) => x.id === payload.id);
        return { task: t ? joined(t) : null };
      }
      case 'tasks:findByNumber': {
        const t = TASKS[payload.number];
        return { task: t ? joined(t) : null };
      }
      case 'epics:listAll':
        return { epics: [] };
      default:
        return {};
    }
  });
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = { invoke: invokeMock, on: vi.fn(() => () => {}) };

  render(
    <ThemeProvider theme={darkTheme}>
      <ToastProvider>
        <MeetingTaskSettings />
      </ToastProvider>
    </ThemeProvider>,
  );
  return { invokeMock, setSetting };
}

/** The "Task number" field belonging to the row with the given label. */
function fieldFor(label: string): HTMLInputElement {
  const heading = screen.getByText(label);
  const row = heading.parentElement!;
  return row.querySelector('input') as HTMLInputElement;
}

describe('MeetingTaskSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads each rule from its own setting key and shows the configured task', async () => {
    const { invokeMock } = mount({
      [MEETINGS_ONE_ON_ONE_TASK_KEY]: '11',
      [MEETINGS_ALL_COMPANY_TASK_KEY]: '22',
      [MEETINGS_DEFAULT_TASK_KEY]: '33',
    });

    await waitFor(() => expect(fieldFor('1:1 & .NET sync task').value).toBe('GREEN-100'));
    expect(fieldFor('All-company meeting task').value).toBe('GREEN-34');
    expect(fieldFor('Default meetings task').value).toBe('GREEN-345');

    for (const key of [
      MEETINGS_ONE_ON_ONE_TASK_KEY,
      MEETINGS_ALL_COMPANY_TASK_KEY,
      MEETINGS_DEFAULT_TASK_KEY,
    ]) {
      expect(invokeMock).toHaveBeenCalledWith('getSetting', { key });
    }
  });

  it('saves a re-pointed 1:1 rule to the 1:1 key only', async () => {
    const { setSetting } = mount({
      [MEETINGS_ONE_ON_ONE_TASK_KEY]: '11',
      [MEETINGS_ALL_COMPANY_TASK_KEY]: '22',
      [MEETINGS_DEFAULT_TASK_KEY]: '33',
    });

    const field = await waitFor(() => {
      const f = fieldFor('1:1 & .NET sync task');
      expect(f.value).toBe('GREEN-100');
      return f;
    });

    // Re-point the rule at a different task — the whole reason for this feature.
    fireEvent.change(field, { target: { value: 'GREEN-777' } });
    fireEvent.blur(field);
    await screen.findByText('Syncs 2026');

    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    fireEvent.click(saveButtons[0]!);

    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith({
        key: MEETINGS_ONE_ON_ONE_TASK_KEY,
        value: '77',
      }),
    );
    expect(setSetting).toHaveBeenCalledTimes(1);
  });

  it('warns that an unset rule leaves its meetings unresolved', async () => {
    mount({ [MEETINGS_DEFAULT_TASK_KEY]: '33' });

    await screen.findByText(
      /1:1 and \.NET sync meetings will be reported as unresolved and not logged/i,
    );
    await screen.findByText(
      /all-company meetings will be reported as unresolved and not logged/i,
    );
  });

  it('does not warn about the default task row when it is unset', async () => {
    mount({});

    // Both rule rows warn…
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    // …and neither warning is about the default fallback.
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert.textContent ?? '').not.toMatch(/default/i);
    }
  });
});
