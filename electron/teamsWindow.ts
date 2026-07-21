import { BrowserWindow, session, desktopCapturer } from 'electron';
import { deriveTeamsState } from '@watchtower/shared/teamsState.js';
import { pushToRenderer } from './ipc.js';

const TEAMS_URL = 'https://teams.microsoft.com/';

// A current desktop Edge UA so Teams serves the full web app rather than its
// "unsupported browser" fallback. Bump periodically if Teams starts degrading.
const EDGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';

let teamsWindow: BrowserWindow | null = null;
let callStartedAt: number | null = null;

/** Recompute state from live window/audio and push it to the renderer. */
function emitState(): void {
  const open = teamsWindow != null && !teamsWindow.isDestroyed();
  const audible = open ? teamsWindow!.webContents.isCurrentlyAudible() : false;
  const next = deriveTeamsState({ open, audible, prevCallStartedAt: callStartedAt, now: Date.now() });
  callStartedAt = next.callStartedAt;
  pushToRenderer('teamsStateChanged', next);
}

export function createOrFocusTeamsWindow(): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    if (teamsWindow.isMinimized()) teamsWindow.restore();
    teamsWindow.focus();
    return;
  }

  // Persistent partition → login survives close/reopen and app restart.
  const ses = session.fromPartition('persist:teams');

  // Teams needs mic + camera; grant only media for this session.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  // Screen-share: hand back the primary screen source (no picker in v1).
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
      .catch(() => callback({}));
  });

  teamsWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    title: 'Teams',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    backgroundColor: '#1b1d27',
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  teamsWindow.webContents.setUserAgent(EDGE_UA);
  void teamsWindow.loadURL(TEAMS_URL);

  // isCurrentlyAudible() is the source of truth; these events are just triggers,
  // so their exact payload shape across Electron versions does not matter.
  const wc = teamsWindow.webContents;
  wc.on('audio-state-changed', emitState);
  wc.on('media-started-playing', emitState);
  wc.on('media-paused', emitState);

  teamsWindow.on('closed', () => {
    teamsWindow = null;
    callStartedAt = null;
    emitState();
  });

  emitState();
}

export function closeTeamsWindow(): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) teamsWindow.close();
}
