'use strict';

/**
 * store.js
 * --------
 * A tiny, dependency-free JSON persistence layer for user data
 * (watchlist, settings). Stored in Electron's per-user `userData` folder so it
 * survives app restarts. Reads/writes are synchronous and small, which is fine
 * for this volume of data and avoids native-module build friction.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'psx-terminal-store.json');

const DEFAULTS = {
  watchlist: [], // array of symbols
  notes: {}, // symbol -> string
  tags: {}, // symbol -> color tag
  alerts: [], // array of alert objects { id, symbol, type, value, note, createdAt, triggeredAt }
  radarLog: [], // rolling history of live-radar momentum alerts (last 4 days)
  journal: [], // user's trade journal (open + closed trades)
  holdings: [], // portfolio holdings { symbol, qty, avgCost, addedAt }
  settings: {
    refreshSeconds: 10,
    soundAlerts: true,
    desktopNotifications: true,
  },
};

function readStore() {
  try {
    const raw = fs.readFileSync(FILE(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(FILE(), JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

function getState() {
  return readStore();
}

function setWatchlist(symbols) {
  const s = readStore();
  s.watchlist = Array.from(new Set(symbols));
  writeStore(s);
  return s.watchlist;
}

function setNote(symbol, note) {
  const s = readStore();
  s.notes[symbol] = note;
  writeStore(s);
  return s.notes;
}

function setSettings(patch) {
  const s = readStore();
  s.settings = { ...s.settings, ...patch };
  writeStore(s);
  return s.settings;
}

function setAlerts(alerts) {
  const s = readStore();
  s.alerts = Array.isArray(alerts) ? alerts : [];
  writeStore(s);
  return s.alerts;
}

function setRadarLog(log) {
  const s = readStore();
  s.radarLog = Array.isArray(log) ? log : [];
  writeStore(s);
  return s.radarLog;
}

function setJournal(journal) {
  const s = readStore();
  s.journal = Array.isArray(journal) ? journal : [];
  writeStore(s);
  return s.journal;
}

function setHoldings(holdings) {
  const s = readStore();
  s.holdings = Array.isArray(holdings) ? holdings : [];
  writeStore(s);
  return s.holdings;
}

module.exports = { getState, setWatchlist, setNote, setSettings, setAlerts, setRadarLog, setJournal, setHoldings };
