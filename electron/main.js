'use strict';

/**
 * main.js
 * -------
 * Electron entry point. Creates the application window, wires up IPC handlers
 * that proxy to the PSX data service and the local store, and handles basic
 * lifecycle + crash safety.
 */

const { app, BrowserWindow, ipcMain, Notification, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const psx = require('./psxService');
const store = require('./store');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let powerBlockerId = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0e17',
    title: 'PSX Terminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep timers (the live poll / radar) running at full rate even when the
      // window is minimised, occluded, or the screen is locked. Without this,
      // Electron throttles background timers and the radar would slow down.
      backgroundThrottling: false,
    },
  });

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC: market data. Each handler returns { ok, data } or { ok:false, error }
// so the renderer can show "Data unavailable from source." cleanly.
// ---------------------------------------------------------------------------

function wrap(fn) {
  return async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  };
}

ipcMain.handle('psx:market-watch', wrap(() => psx.getMarketWatch()));
ipcMain.handle('psx:symbols', wrap(async () => Array.from((await psx.getSymbols()).entries()).map(([symbol, m]) => ({ symbol, ...m }))));
ipcMain.handle('psx:eod', wrap((symbol) => psx.getEod(symbol)));
ipcMain.handle('psx:intraday', wrap((symbol) => psx.getIntraday(symbol)));
ipcMain.handle('psx:announcements', wrap((opts) => psx.getAnnouncements(opts || {})));
ipcMain.handle('psx:payouts', wrap((symbol) => psx.getPayouts(symbol)));

// ---------------------------------------------------------------------------
// IPC: persistence
// ---------------------------------------------------------------------------

ipcMain.handle('store:get', wrap(async () => store.getState()));
ipcMain.handle('store:watchlist', wrap(async (symbols) => store.setWatchlist(symbols)));
ipcMain.handle('store:note', wrap(async ({ symbol, note }) => store.setNote(symbol, note)));
ipcMain.handle('store:settings', wrap(async (patch) => store.setSettings(patch)));
ipcMain.handle('store:alerts', wrap(async (alerts) => store.setAlerts(alerts)));
ipcMain.handle('store:radarlog', wrap(async (log) => store.setRadarLog(log)));
ipcMain.handle('store:journal', wrap(async (journal) => store.setJournal(journal)));
ipcMain.handle('store:holdings', wrap(async (holdings) => store.setHoldings(holdings)));

// ---------------------------------------------------------------------------
// IPC: desktop notifications
// ---------------------------------------------------------------------------

ipcMain.handle('app:notify', wrap(async ({ title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'PSX Terminal', body: body || '' }).show();
  }
  return true;
}));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  // Prevent the OS from suspending the app (keeps the system active for the
  // live radar) while still allowing the SCREEN to turn off when locked.
  try {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[main] powerSaveBlocker failed:', e);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Crash safety: log unhandled errors instead of silently dying.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[main] unhandledRejection:', reason);
});
