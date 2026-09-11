'use strict';

/**
 * preload.js
 * ----------
 * Securely bridges the renderer (React) and the main process. Context isolation
 * is ON and nodeIntegration is OFF; the renderer can only call the whitelisted
 * functions exposed here. All data fetching happens in the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('psx', {
  // --- Market data (real PSX portal data) ---
  getMarketWatch: () => ipcRenderer.invoke('psx:market-watch'),
  getSymbols: () => ipcRenderer.invoke('psx:symbols'),
  getEod: (symbol) => ipcRenderer.invoke('psx:eod', symbol),
  getIntraday: (symbol) => ipcRenderer.invoke('psx:intraday', symbol),
  getAnnouncements: (opts) => ipcRenderer.invoke('psx:announcements', opts),
  getPayouts: (symbol) => ipcRenderer.invoke('psx:payouts', symbol),

  // --- Persistence (watchlist / notes / settings / alerts) ---
  getState: () => ipcRenderer.invoke('store:get'),
  setWatchlist: (symbols) => ipcRenderer.invoke('store:watchlist', symbols),
  setNote: (symbol, note) => ipcRenderer.invoke('store:note', { symbol, note }),
  setSettings: (patch) => ipcRenderer.invoke('store:settings', patch),
  setAlerts: (alerts) => ipcRenderer.invoke('store:alerts', alerts),
  setRadarLog: (log) => ipcRenderer.invoke('store:radarlog', log),
  setJournal: (journal) => ipcRenderer.invoke('store:journal', journal),
  setHoldings: (holdings) => ipcRenderer.invoke('store:holdings', holdings),

  // --- Desktop notifications ---
  notify: (title, body) => ipcRenderer.invoke('app:notify', { title, body }),
});
