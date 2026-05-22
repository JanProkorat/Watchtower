import { Notification, app } from 'electron';
import path from 'node:path';
import { createMainWindow, getMainWindow } from './window.js';

export interface FireOptions {
  instanceId: string;
  cwd: string;
  kind: 'waiting-permission' | 'idle-notify';
  /** Called when the user clicks the notification. */
  onClick(instanceId: string): void;
}

export function isNotificationSupported(): boolean {
  return Notification.isSupported();
}

export function fireMacNotification(opts: FireOptions): void {
  if (!Notification.isSupported()) {
    console.warn('[notifications] not supported on this platform');
    return;
  }
  const cwdLabel = path.basename(opts.cwd) || opts.cwd;
  const body =
    opts.kind === 'waiting-permission'
      ? `Claude in ${cwdLabel} needs permission`
      : `Claude in ${cwdLabel} is waiting`;
  const n = new Notification({
    title: app.getName(),
    body,
    silent: false,
  });
  n.on('click', () => {
    const win = getMainWindow() ?? createMainWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    opts.onClick(opts.instanceId);
  });
  n.show();
}

export function fireTestNotification(): void {
  if (!Notification.isSupported()) return;
  new Notification({
    title: app.getName(),
    body: 'Test notification — Watchtower can ping you.',
    silent: false,
  }).show();
}
