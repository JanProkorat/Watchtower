import { app } from 'electron';
import { createMainWindow } from './window.js';

app.setName('Watchtower');

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  // Keep the orchestrator alive in the background — do NOT quit on window close.
  // Tray menu and Cmd+Q drive real quit (wired up in a later task).
});
