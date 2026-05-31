import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrchestrator } from './orchestratorHost.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow) {
    mainWindow.show();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Watchtower',
    // Drop the native title bar but keep the traffic lights inset top-left;
    // the renderer draws the global instance tab bar in the reclaimed strip.
    // trafficLightPosition vertically centres the controls inside that ~40px
    // bar (default y sits too high once the bar replaces the OS title bar).
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    backgroundColor: '#0e0f12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.WATCHTOWER_DEV_URL) {
    void mainWindow.loadURL(process.env.WATCHTOWER_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'right' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('focus', () => {
    try { void getOrchestrator().invoke('windowFocusChanged', { focused: true }); } catch { /* orch not ready */ }
  });
  mainWindow.on('blur', () => {
    try { void getOrchestrator().invoke('windowFocusChanged', { focused: false }); } catch { /* orch not ready */ }
  });
  return mainWindow;
}

export function toggleMainWindow(): void {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    createMainWindow().show();
  }
}
