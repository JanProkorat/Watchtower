import { Tray, Menu, nativeImage, app, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMainWindow, getMainWindow, toggleMainWindow } from './window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let badgeCount = 0;
let entries: TrayInstanceEntry[] = [];

let onSelectInstance: ((id: string) => void) | null = null;
let onSnoozeAll: ((ms: number) => void) | null = null;
let onNewInstance: (() => void) | null = null;

export interface TrayInstanceEntry {
  id: string;
  label: string;
  status: string;
}

function basename(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function loadTrayIcon(): NativeImage {
  // Prefer the bundled template icon (build-resources/tray-template.png).
  // electron-builder copies build-resources/ into the .app's Resources/
  // directory. In dev it lives alongside the repo root.
  const candidates = [
    path.join(__dirname, '..', '..', 'build-resources', 'tray-template.png'),
    process.resourcesPath ? path.join(process.resourcesPath, 'tray-template.png') : null,
  ].filter((c): c is string => c !== null);

  for (const c of candidates) {
    if (existsSync(c)) {
      const img = nativeImage.createFromPath(c);
      img.setTemplateImage(true);
      return img;
    }
  }

  // Fallback: a tiny built-in image so the tray still appears. A circle
  // drawn into a 16×16 buffer would be ideal but requires no extra deps —
  // an empty NativeImage is rendered as the system default placeholder.
  return nativeImage.createEmpty();
}

function rebuildMenu(): void {
  if (!tray) return;
  const liveCount = entries.length;
  const items: MenuItemConstructorOptions[] = [
    {
      label: `${liveCount} running · ${badgeCount} waiting`,
      enabled: false,
    },
    { type: 'separator' },
    ...entries.map<MenuItemConstructorOptions>((e) => ({
      label: `${e.label} — ${e.status}`,
      click: () => onSelectInstance?.(e.id),
    })),
    ...(entries.length > 0 ? [{ type: 'separator' as const }] : []),
    { label: 'New instance…', click: () => onNewInstance?.() },
    {
      label: 'Snooze all',
      submenu: [
        { label: '5 minutes', click: () => onSnoozeAll?.(5 * 60_000) },
        { label: '30 minutes', click: () => onSnoozeAll?.(30 * 60_000) },
        { label: '1 hour', click: () => onSnoozeAll?.(60 * 60_000) },
      ],
    },
    { label: 'Show Watchtower', click: () => createMainWindow().show() },
    { type: 'separator' },
    {
      label: liveCount > 0 ? `Quit (close ${liveCount} session${liveCount === 1 ? '' : 's'})` : 'Quit Watchtower',
      click: () => app.quit(),
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

export interface StartTrayOptions {
  onSelectInstance(id: string): void;
  onSnoozeAll(ms: number): void;
  onNewInstance(): void;
}

export function startTray(opts: StartTrayOptions): void {
  if (tray) return;
  onSelectInstance = opts.onSelectInstance;
  onSnoozeAll = opts.onSnoozeAll;
  onNewInstance = opts.onNewInstance;
  tray = new Tray(loadTrayIcon());
  tray.setToolTip('Watchtower');
  tray.on('click', () => toggleMainWindow());
  rebuildMenu();
}

export function setTrayBadge(count: number): void {
  badgeCount = count;
  if (tray) {
    // Numeric badge in the menu-bar title — small, monospaced.
    tray.setTitle(count > 0 ? ` ${count}` : '');
  }
  // Also drive the Dock badge (macOS) so the user notices even when the
  // menu bar is autohidden.
  app.dock?.setBadge(count > 0 ? String(count) : '');
  rebuildMenu();
}

export function setTrayEntries(next: TrayInstanceEntry[]): void {
  entries = next;
  rebuildMenu();
}

export async function refreshTrayFromOrchestrator(
  invoke: <T>(kind: 'listInstances', payload: Record<string, never>) => Promise<{
    instances: Array<{ id: string; cwd: string; status: string }>;
  }>,
): Promise<void> {
  try {
    const res = await invoke('listInstances', {} as never);
    setTrayEntries(
      res.instances.map((i) => ({
        id: i.id,
        label: basename(i.cwd) || i.cwd,
        status: i.status,
      })),
    );
  } catch (err) {
    console.error('[tray] refresh failed:', err);
  }
}

export function focusInstanceTab(instanceId: string): void {
  const win = getMainWindow() ?? createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('watchtower:push', 'activateInstance', { instanceId });
}
