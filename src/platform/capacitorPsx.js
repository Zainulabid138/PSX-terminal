/**
 * capacitorPsx.js
 * ---------------
 * The mobile (Android) implementation of the `window.psx.*` bridge — the exact
 * same API the Electron preload exposes, so the entire React app + MarketContext
 * run unchanged. Network goes through Capacitor's NATIVE HTTP (bypasses CORS),
 * persistence through Preferences, and alerts through native LocalNotifications.
 */
import { CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { createPsxClient } from './psxCore.js';

const client = createPsxClient({
  request: async ({ url, method = 'GET', headers = {}, body = null }) => {
    const opts = { url, method, headers, responseType: 'text', connectTimeout: 20000, readTimeout: 20000 };
    if (body != null) opts.data = body;
    const res = await CapacitorHttp.request(opts);
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return { status: res.status, text };
  },
});

const wrap = (p) => p.then((data) => ({ ok: true, data })).catch((e) => ({ ok: false, error: (e && e.message) || 'Data unavailable from source.' }));

// --- Persistence (mirrors electron/store.js DEFAULTS) ---
const STORE_KEY = 'psx-terminal-store';
const DEFAULTS = { watchlist: [], notes: {}, tags: {}, alerts: [], radarLog: [], journal: [], holdings: [], paper: null, settings: { refreshSeconds: 10, soundAlerts: true, desktopNotifications: true } };
let _cache = null;
async function readStore() {
  if (_cache) return _cache;
  try { const { value } = await Preferences.get({ key: STORE_KEY }); _cache = value ? { ...DEFAULTS, ...JSON.parse(value) } : { ...DEFAULTS }; }
  catch { _cache = { ...DEFAULTS }; }
  return _cache;
}
async function writeStore(patch) {
  const s = await readStore();
  Object.assign(s, patch);
  _cache = s;
  try { await Preferences.set({ key: STORE_KEY, value: JSON.stringify(s) }); } catch { /* best-effort */ }
  return s;
}

let _notifId = 1;
let _notifReady = false;
async function ensureNotif() {
  if (_notifReady) return;
  try { await LocalNotifications.requestPermissions(); } catch { /* ignore */ }
  _notifReady = true;
}

export const capacitorPsx = {
  getMarketWatch: () => wrap(client.getMarketWatch()),
  getSymbols: () => wrap(client.getSymbols()),
  getEod: (s) => wrap(client.getEod(s)),
  getIntraday: (s) => wrap(client.getIntraday(s)),
  getAnnouncements: (o) => wrap(client.getAnnouncements(o)),
  getPayouts: (s) => wrap(client.getPayouts(s)),

  getState: () => wrap(readStore().then((s) => ({ ...s }))),
  setWatchlist: (symbols) => writeStore({ watchlist: Array.from(new Set(symbols)) }).then((s) => ({ ok: true, data: s.watchlist })),
  setNote: (symbol, note) => readStore().then((s) => writeStore({ notes: { ...s.notes, [symbol]: note } })).then((s) => ({ ok: true, data: s.notes })),
  setSettings: (patch) => readStore().then((s) => writeStore({ settings: { ...s.settings, ...patch } })).then((s) => ({ ok: true, data: s.settings })),
  setAlerts: (alerts) => writeStore({ alerts: Array.isArray(alerts) ? alerts : [] }).then((s) => ({ ok: true, data: s.alerts })),
  setRadarLog: (log) => writeStore({ radarLog: Array.isArray(log) ? log : [] }).then((s) => ({ ok: true, data: s.radarLog })),
  setJournal: (journal) => writeStore({ journal: Array.isArray(journal) ? journal : [] }).then((s) => ({ ok: true, data: s.journal })),
  setHoldings: (holdings) => writeStore({ holdings: Array.isArray(holdings) ? holdings : [] }).then((s) => ({ ok: true, data: s.holdings })),
  setPaper: (paper) => writeStore({ paper: paper || null }).then((s) => ({ ok: true, data: s.paper })),

  notify: async (title, body) => {
    await ensureNotif();
    try {
      await LocalNotifications.schedule({ notifications: [{ id: _notifId++, title, body, schedule: { at: new Date(Date.now() + 100) } }] });
    } catch { /* ignore */ }
    return { ok: true };
  },
};
