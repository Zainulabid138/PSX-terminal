import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyze } from '../lib/aiEngine.js';
import { vwapFromTicks } from '../lib/indicators.js';
import { applyStrategy, marketRegime, horizonFit, buyTurnSignal, holdingStrategy } from '../lib/strategy.js';
import { detectCorporateAction, tapeWarning } from '../lib/corporateAction.js';
import { analyzeTape } from '../lib/tape.js';
import { getMarketStatus } from '../utils/marketStatus.js';

/**
 * MarketContext
 * -------------
 * Central data layer for the renderer. Responsibilities:
 *   - Poll the live market-watch snapshot on an interval (no UI freeze: it's an
 *     async IPC call; React state updates when it resolves).
 *   - Expose rows, market status, errors, and persistence (watchlist/settings).
 *   - Provide getAnalysis(symbol): fetch EOD (+intraday VWAP) once, run the AI
 *     engine, and cache the result for a few minutes so the scanner, detail
 *     view, and assistant all reuse it instead of re-fetching.
 *
 * If window.psx is missing (i.e. the page is opened in a plain browser instead
 * of through Electron) we surface a clear message instead of fabricating data.
 */

const MarketContext = createContext(null);
export const useMarket = () => useContext(MarketContext);

const hasBridge = typeof window !== 'undefined' && !!window.psx;
const ANALYSIS_TTL_MS = 5 * 60 * 1000;
const OPP_SCAN_LIMIT = 60;

export const ALERT_TYPES = [
  { id: 'price_above', label: 'Price ≥', unit: 'PKR' },
  { id: 'price_below', label: 'Price ≤', unit: 'PKR' },
  { id: 'pct_above', label: 'Daily change % ≥', unit: '%' },
  { id: 'pct_below', label: 'Daily change % ≤', unit: '%' },
  { id: 'vol_above', label: 'Volume ≥ (spike)', unit: 'shares' },
];

/** Evaluate one alert against a live row. Returns true when the condition is met. */
function checkAlert(al, row) {
  switch (al.type) {
    case 'price_above': return row.current != null && row.current >= al.value;
    case 'price_below': return row.current != null && row.current <= al.value;
    case 'pct_above': return row.changePct != null && row.changePct >= al.value;
    case 'pct_below': return row.changePct != null && row.changePct <= al.value;
    case 'vol_above': return row.volume != null && row.volume >= al.value;
    default: return false;
  }
}

function alertMessage(al, row) {
  const label = (ALERT_TYPES.find((t) => t.id === al.type) || {}).label || al.type;
  return `${al.symbol}: ${label} ${al.value} — now ${al.type.startsWith('vol') ? row.volume : al.type.startsWith('pct') ? `${row.changePct?.toFixed(2)}%` : row.current}`;
}

/** Short, dependency-free alert beep via the Web Audio API (no external file). */
function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch (e) { /* audio not available */ }
}

export function MarketProvider({ children }) {
  const [rows, setRows] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [error, setError] = useState(hasBridge ? null : 'Not running inside the desktop app. Launch with "npm run dev" so the Electron backend can fetch live PSX data.');
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlistState] = useState([]);
  const [settings, setSettings] = useState({ refreshSeconds: 10, soundAlerts: true, desktopNotifications: true });
  const [alerts, setAlertsState] = useState([]);
  const [journal, setJournalState] = useState([]);
  const journalRef = useRef([]);
  useEffect(() => { journalRef.current = journal; }, [journal]);
  const [holdings, setHoldingsState] = useState([]);
  const holdingsRef = useRef([]);
  useEffect(() => { holdingsRef.current = holdings; }, [holdings]);
  const alertsRef = useRef([]);
  const settingsRef = useRef(settings);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const analysisCache = useRef(new Map()); // symbol -> { at, value }
  const indexCache = useRef({ at: 0, series: null }); // KSE-100 EOD, cached
  // Keep a ref of rows so getAnalysis (a stable callback) always sees the latest snapshot.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Fetch (and cache for 30 min) the KSE-100 series used for relative strength.
  const getIndexSeries = useCallback(async () => {
    if (!hasBridge) return null;
    if (indexCache.current.series && Date.now() - indexCache.current.at < 30 * 60 * 1000) return indexCache.current.series;
    const res = await window.psx.getEod('KSE100');
    const series = res.ok ? res.data : null;
    indexCache.current = { at: Date.now(), series };
    return series;
  }, []);

  // Index quote (KSE-100 / KMI-30 etc.) — value, change vs previous close, and
  // the last data date, from the real EOD series. Cached 5 min.
  const indexQuoteCache = useRef(new Map()); // symbol -> { at, summary }
  const getIndexQuote = useCallback(async (symbol) => {
    if (!hasBridge) return null;
    const c = indexQuoteCache.current.get(symbol);
    if (c && Date.now() - c.at < 5 * 60 * 1000) return c.summary;
    const res = await window.psx.getEod(symbol);
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return null;
    const s = res.data; // ascending by time
    const last = s[s.length - 1];
    const prev = last.prevClose != null ? last.prevClose : (s.length > 1 ? s[s.length - 2].close : null);
    const change = prev != null ? last.close - prev : null;
    const summary = { symbol, value: last.close, prev, change, changePct: prev ? (change / prev) * 100 : null, date: last.time };
    indexQuoteCache.current.set(symbol, { at: Date.now(), summary });
    return summary;
  }, []);

  // Live sector strength for a given sector, from the current snapshot rows.
  const computeSectorStrength = useCallback((sectorName) => {
    if (!sectorName) return null;
    const peers = rowsRef.current.filter((r) => r.sectorName === sectorName && r.changePct != null && !r.isDebt);
    if (!peers.length) return null;
    let wsum = 0; let vol = 0; let adv = 0;
    for (const r of peers) { const w = r.volume || 1; wsum += r.changePct * w; vol += w; if (r.changePct > 0) adv++; }
    return { name: sectorName, avgChange: vol ? wsum / vol : 0, breadth: (adv / peers.length) * 100, count: peers.length };
  }, []);

  // --- Load persisted state once ---
  useEffect(() => {
    if (!hasBridge) return;
    window.psx.getState().then((res) => {
      if (res.ok) {
        setWatchlistState(res.data.watchlist || []);
        setSettings(res.data.settings || { refreshSeconds: 10, soundAlerts: true, desktopNotifications: true });
        setAlertsState(res.data.alerts || []);
        setRadarLogState(pruneLog(res.data.radarLog || []));
        setJournalState(res.data.journal || []);
        setHoldingsState(res.data.holdings || []);
      }
    });
  }, []);

  // --- Poll the market snapshot ---
  const refresh = useCallback(async () => {
    if (!hasBridge) { setLoading(false); return; }
    const res = await window.psx.getMarketWatch();
    if (res.ok) {
      setRows(res.data.rows);
      setFetchedAt(res.data.fetchedAt);
      setError(null);
    } else {
      setError(res.error || 'Data unavailable from source.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const sec = Math.max(5, settings.refreshSeconds || 10);
    const id = setInterval(refresh, sec * 1000);
    return () => clearInterval(id);
  }, [refresh, settings.refreshSeconds]);

  // --- Analysis with caching ---
  const getAnalysis = useCallback(async (symbol) => {
    if (!hasBridge) return null;
    const cached = analysisCache.current.get(symbol);
    if (cached && Date.now() - cached.at < ANALYSIS_TTL_MS) return cached.value;

    const snapshot = rowsRef.current.find((r) => r.symbol === symbol) || { symbol };
    const eodRes = await window.psx.getEod(symbol);
    if (!eodRes.ok) {
      const value = { ok: false, status: 'error', message: 'Data unavailable from source.', detail: eodRes.error };
      analysisCache.current.set(symbol, { at: Date.now(), value });
      return value;
    }
    // Intraday VWAP + tape (both from the same real tick fetch); faithful.
    let vwap = null; let tape = null;
    try {
      const intr = await window.psx.getIntraday(symbol);
      if (intr.ok) { vwap = vwapFromTicks(intr.data); tape = analyzeTape(intr.data); }
    } catch (e) { /* intraday optional */ }

    // Relative strength vs KSE-100 and live sector strength (both faithful).
    const indexSeries = await getIndexSeries().catch(() => null);
    const sectorStrength = computeSectorStrength(snapshot.sectorName);

    const value = analyze({ snapshot, eod: eodRes.data, intradayVwap: vwap, indexSeries, sectorStrength });

    // Veteran-trader decision layer: market regime + Weinstein stage + setup + conviction.
    if (value.ok) {
      const closes = eodRes.data.map((d) => d.close).filter((v) => v != null);
      const regime = marketRegime((indexSeries || []).map((d) => d.close));
      Object.assign(value, applyStrategy(value, closes, regime));
      value.tape = tape; // today's large-trade (accumulation/distribution) read
    }

    analysisCache.current.set(symbol, { at: Date.now(), value });
    return value;
  }, [getIndexSeries, computeSectorStrength]);

  // --- Next-Day Watchlist (end-of-day scan) — stocks that closed strong on
  // volume today AND have a constructive chart, to WATCH/buy tomorrow. ---
  const [nextDay, setNextDay] = useState({ list: [], scannedAt: null, scanning: false, progress: 0 });
  const nextDayScanningRef = useRef(false);

  const runNextDayScan = useCallback(async () => {
    if (nextDayScanningRef.current) return;
    nextDayScanningRef.current = true;
    setNextDay((o) => ({ ...o, scanning: true, progress: 0, list: [] }));

    // Candidates: up on the day, liquid, and CLOSED STRONG (in the upper part of
    // the day's range) — the classic "closed near the high on volume" tell.
    const equity = rowsRef.current
      .filter((r) => !r.isDebt && r.current != null && (r.volume || 0) >= 50000 && (r.changePct || 0) > 0)
      .map((r) => {
        const cs = (r.high != null && r.low != null && r.high > r.low) ? (r.current - r.low) / (r.high - r.low) : 0.5;
        return { r, closeStrength: cs };
      })
      .filter((x) => x.closeStrength >= 0.55)
      .sort((a, b) => (b.r.volume || 0) - (a.r.volume || 0))
      .slice(0, 60);

    const found = [];
    for (let i = 0; i < equity.length; i++) {
      const { r, closeStrength } = equity[i];
      // eslint-disable-next-line no-await-in-loop
      const a = await getAnalysis(r.symbol);
      setNextDay((o) => ({ ...o, progress: Math.round(((i + 1) / equity.length) * 100) }));
      if (!a || !a.ok || a.stage?.stage === 4 || a.bullishProbability < 55 || !a.levels) continue;
      const relVol = a.metrics?.volRatio || 0;
      let score = a.conviction * 0.5 + closeStrength * 100 * 0.2 + (Math.min(relVol, 3) / 3) * 100 * 0.2 + (Math.min(Math.max(r.changePct || 0, 0), 5) / 5) * 100 * 0.1;

      // --- Robustness upgrades (reduce false positives; can't remove gap risk) ---
      const flags = [];
      // 1) Tape: was the strong close backed by big BUYING, or was it distribution?
      if (a.tape) {
        if (a.tape.bias === 'buy') score += 8;
        else if (a.tape.bias === 'sell') { score -= 25; flags.push(`Closed up but big SELLING dominated today (${a.tape.buyPct}% buy) — accumulation not confirmed; treat with caution.`); }
      }
      // 2) PSX ±10% circuit: near the upper lock -> may open locked or snap back.
      if ((r.changePct || 0) >= 9.5) { score -= 12; flags.push('Closed near the +10% circuit limit — it may open locked or reverse tomorrow; do not chase the open.'); }
      // 3) Overextended: price already far above its buy zone -> poor entry risk.
      if (a.levels && r.current > a.levels.buyZone[1] * 1.03) { score -= 6; flags.push('Extended above the buy zone — wait for a pullback rather than chasing.'); }

      score = Math.round(Math.max(0, Math.min(100, score)));
      found.push({ symbol: r.symbol, name: r.name, changePct: r.changePct, closeStrength: Math.round(closeStrength * 100), relVol, score, tape: a.tape, flags, a });
      setNextDay((o) => ({ ...o, list: [...found].sort((x, y) => y.score - x.score).slice(0, 6) }));
    }
    setNextDay((o) => ({ ...o, list: found.sort((x, y) => y.score - x.score).slice(0, 6), scanning: false, scannedAt: Date.now() }));
    nextDayScanningRef.current = false;
  }, [getAnalysis]);

  // --- Investment Planner (horizon-based): 1M / 3M / 6M / 1Y ---
  const [planner, setPlanner] = useState({ horizon: '3M', list: [], scanning: false, progress: 0, scannedAt: null });
  const plannerScanningRef = useRef(false);

  const runPlannerScan = useCallback(async (horizon) => {
    if (plannerScanningRef.current) return;
    plannerScanningRef.current = true;
    setPlanner((o) => ({ ...o, horizon, scanning: true, progress: 0, list: [] }));
    const equity = rowsRef.current
      .filter((r) => !r.isDebt && r.current != null && (r.volume || 0) >= 50000)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 60);
    const found = [];
    for (let i = 0; i < equity.length; i++) {
      const r = equity[i];
      // eslint-disable-next-line no-await-in-loop
      const a = await getAnalysis(r.symbol);
      setPlanner((o) => ({ ...o, progress: Math.round(((i + 1) / equity.length) * 100) }));
      if (!a || !a.ok) continue;
      const fit = horizonFit(a, horizon);
      if (fit.ok) {
        found.push({ symbol: r.symbol, name: r.name, changePct: r.changePct, score: fit.score, why: fit.why, a });
        setPlanner((o) => ({ ...o, list: [...found].sort((x, y) => y.score - x.score).slice(0, 8) }));
      }
    }
    setPlanner((o) => ({ ...o, list: found.sort((x, y) => y.score - x.score).slice(0, 8), scanning: false, scannedAt: Date.now() }));
    plannerScanningRef.current = false;
  }, [getAnalysis]);

  // --- Buy Signals: "buy-the-dip turn in an uptrend" for watchlist + market ---
  const [buySignals, setBuySignals] = useState({ watch: [], fresh: [], scanning: false, progress: 0, scannedAt: null });
  const buySignalScanningRef = useRef(false);

  // Shared "reality check" for a buy candidate: scan its own recent PSX filings
  // for corporate actions (rights issue etc.) and read today's tape. Returns a
  // list of { severity, type, text }. Cached briefly per symbol.
  const corpCache = useRef(new Map()); // symbol -> { at, warnings }
  const realWorldWarnings = useCallback(async (sym, a) => {
    const warnings = [];
    let corp = { hits: [] };
    const cached = corpCache.current.get(sym);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
      corp = cached.corp;
    } else if (hasBridge) {
      try {
        const ann = await window.psx.getAnnouncements({ type: 'C', count: 12, symbol: sym });
        if (ann.ok) {
          const items = (ann.data.items || []).filter((i) => !i.symbol || i.symbol === sym);
          corp = detectCorporateAction({ items });
        }
      } catch (e) { /* filings optional; degrade gracefully */ }
      corpCache.current.set(sym, { at: Date.now(), corp });
    }
    for (const h of corp.hits) warnings.push({ severity: h.severity, type: h.type, text: `${h.type} — ${h.note}`, date: h.date });
    const tw = tapeWarning(a?.tape);
    if (tw) warnings.push({ severity: 'high', type: 'Tape', text: tw });
    return warnings;
  }, [hasBridge]);

  const runBuySignalScan = useCallback(async () => {
    if (buySignalScanningRef.current) return;
    buySignalScanningRef.current = true;
    setBuySignals((o) => ({ ...o, scanning: true, progress: 0, watch: [], fresh: [] }));
    const wl = watchlistRef.current;
    const universe = rowsRef.current
      .filter((r) => !r.isDebt && r.current != null && (r.volume || 0) >= 50000)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 60).map((r) => r.symbol);
    const symbols = Array.from(new Set([...wl, ...universe]));
    const watch = []; const fresh = [];
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      // eslint-disable-next-line no-await-in-loop
      const a = await getAnalysis(sym);
      setBuySignals((o) => ({ ...o, progress: Math.round(((i + 1) / symbols.length) * 100) }));
      if (!a || !a.ok) continue;
      const sig = buyTurnSignal(a);
      if (!sig.ok) continue;
      // Real-world gates the chart can't see: corporate actions (rights issue,
      // de-listing, etc.) from the stock's OWN recent filings, plus today's tape
      // (distribution). Only run for the few finalists, so it stays fast.
      const warnings = await realWorldWarnings(sym, a);
      const risky = warnings.some((w) => w.severity === 'high');
      const row = rowsRef.current.find((r) => r.symbol === sym) || {};
      const entry = { symbol: sym, name: row.name, changePct: row.changePct, score: risky ? Math.max(0, a.conviction - 45) : a.conviction, reasons: sig.reasons, caution: sig.caution, warnings, risky, a };
      if (wl.includes(sym)) watch.push(entry); else fresh.push(entry);
      setBuySignals((o) => ({ ...o, watch: [...watch].sort((x, y) => y.score - x.score), fresh: [...fresh].sort((x, y) => y.score - x.score) }));
    }
    setBuySignals((o) => ({ ...o, watch: watch.sort((x, y) => y.score - x.score), fresh: fresh.sort((x, y) => y.score - x.score), scanning: false, scannedAt: Date.now() }));
    buySignalScanningRef.current = false;
  }, [getAnalysis, realWorldWarnings]);

  // Proactive watchlist BUY-CALL alerts: every few minutes, check watchlist
  // stocks; when one turns into a buy-the-dip signal, fire a desktop + sound
  // alert (once per symbol per 6h). Watchlist is small, so this is light.
  const buyAlertedRef = useRef(new Map());
  useEffect(() => {
    if (!hasBridge) return undefined;
    const check = async () => {
      for (const sym of watchlistRef.current) {
        // eslint-disable-next-line no-await-in-loop
        const a = await getAnalysis(sym).catch(() => null);
        if (!a || !a.ok) continue;
        const sig = buyTurnSignal(a);
        const last = buyAlertedRef.current.get(sym) || 0;
        if (sig.ok && Date.now() - last > 6 * 3600 * 1000) {
          // Don't fire a buy alert on a stock with a rights issue / de-listing /
          // distribution — the same reality check the scan uses.
          // eslint-disable-next-line no-await-in-loop
          const warnings = await realWorldWarnings(sym, a);
          if (warnings.some((w) => w.severity === 'high')) { buyAlertedRef.current.set(sym, Date.now()); continue; }
          buyAlertedRef.current.set(sym, Date.now());
          if (settingsRef.current.desktopNotifications) window.psx.notify('📈 Buy signal', `${sym} turned up in an uptrend — ${sig.reasons[0]}. Open it to see the plan.`);
          if (settingsRef.current.soundAlerts) playBeep();
        }
      }
    };
    const id = setInterval(check, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [getAnalysis, realWorldWarnings]);

  // Broad-market regime (KSE-100) for a top-level banner.
  const getRegime = useCallback(async () => {
    const series = await getIndexSeries().catch(() => null);
    return marketRegime((series || []).map((d) => d.close));
  }, [getIndexSeries]);

  // --- Top Picks scan: state lives here so results PERSIST across tab switches ---
  const [opportunities, setOpportunities] = useState({ list: [], scannedAt: null, scanning: false, progress: 0, regime: null });
  const oppScanningRef = useRef(false);

  const runOpportunityScan = useCallback(async () => {
    if (oppScanningRef.current) return;
    oppScanningRef.current = true;
    const regime = await getRegime();
    setOpportunities((o) => ({ ...o, scanning: true, progress: 0, list: [], regime }));

    const equity = rowsRef.current.filter((r) => !r.isDebt && r.current != null && (r.volume || 0) > 0);
    const candidates = [...equity].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, OPP_SCAN_LIMIT);

    // Clean picks rank above ones with a real-world red flag (rights issue,
    // distribution, etc.), so the top of the list is always the vetted calls.
    const rankKey = (p) => p.a.conviction - (p.risky ? 60 : 0);
    const found = [];
    for (let i = 0; i < candidates.length; i++) {
      const r = candidates[i];
      // eslint-disable-next-line no-await-in-loop
      const a = await getAnalysis(r.symbol);
      setOpportunities((o) => ({ ...o, progress: Math.round(((i + 1) / candidates.length) * 100) }));
      if (a && a.ok && a.conviction >= 55 && a.bullishProbability >= 55 && a.stage?.stage !== 4 && !a.conflict) {
        // eslint-disable-next-line no-await-in-loop
        const warnings = await realWorldWarnings(r.symbol, a);
        const risky = warnings.some((w) => w.severity === 'high');
        found.push({ symbol: r.symbol, name: r.name, changePct: r.changePct, warnings, risky, a });
        const sorted = [...found].sort((x, y) => rankKey(y) - rankKey(x));
        setOpportunities((o) => ({ ...o, list: sorted }));
      }
    }
    setOpportunities((o) => ({ ...o, list: found.sort((x, y) => rankKey(y) - rankKey(x)), scanning: false, scannedAt: Date.now() }));
    oppScanningRef.current = false;
  }, [getRegime, getAnalysis, realWorldWarnings]);

  // Load the regime once for the banner even before the first scan.
  useEffect(() => {
    if (!hasBridge) return;
    getRegime().then((regime) => setOpportunities((o) => (o.regime ? o : { ...o, regime })));
  }, [getRegime]);

  // --- Watchlist ---
  const toggleWatch = useCallback((symbol) => {
    setWatchlistState((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol];
      if (hasBridge) window.psx.setWatchlist(next);
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (hasBridge) window.psx.setSettings(patch);
      return next;
    });
  }, []);

  // --- Alerts CRUD ---
  const persistAlerts = useCallback((next) => {
    setAlertsState(next);
    if (hasBridge) window.psx.setAlerts(next);
  }, []);

  const addAlert = useCallback((alert) => {
    const id = `${alert.symbol}-${alert.type}-${alertsRef.current.length}-${Math.round(performance.now())}`;
    persistAlerts([...alertsRef.current, { ...alert, id, createdAt: Date.now(), triggeredAt: null }]);
  }, [persistAlerts]);

  const removeAlert = useCallback((id) => { persistAlerts(alertsRef.current.filter((a) => a.id !== id)); }, [persistAlerts]);
  const rearmAlert = useCallback((id) => { persistAlerts(alertsRef.current.map((a) => (a.id === id ? { ...a, triggeredAt: null } : a))); }, [persistAlerts]);

  // --- Live Momentum Radar: intraday price+volume spike detection ---
  // Compares each fresh snapshot to the previous one to catch a stock that is
  // suddenly rising on a burst of volume and making a new intraday high — the
  // "20 -> 20.50 with volume" scenario. Runs only during market hours.
  const [radar, setRadar] = useState({ list: [], updatedAt: null, active: false, warming: true });
  const prevSnapRef = useRef(new Map());     // symbol -> { current, volume }
  const volHistRef = useRef(new Map());      // symbol -> recent per-interval volume deltas
  const radarAlertedRef = useRef(new Map()); // symbol -> last alert time (cooldown)

  // Radar scope: 'all' (whole market) or 'watchlist' (only the user's watchlist).
  const [radarMode, setRadarMode] = useState('all');
  const radarModeRef = useRef('all');
  const watchlistRef = useRef([]);
  useEffect(() => { radarModeRef.current = radarMode; }, [radarMode]);
  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);

  // Persistent rolling history of radar alerts — kept for the last 4 days only.
  const RADAR_RETAIN_MS = 4 * 24 * 3600 * 1000;
  const [radarLog, setRadarLogState] = useState([]);
  const radarLogRef = useRef([]);
  useEffect(() => { radarLogRef.current = radarLog; }, [radarLog]);
  const pruneLog = (log) => { const cut = Date.now() - RADAR_RETAIN_MS; return log.filter((e) => e.at >= cut).slice(0, 1000); };
  const persistRadarLog = useCallback((log) => {
    const pruned = pruneLog(log);
    setRadarLogState(pruned);
    if (hasBridge) window.psx.setRadarLog(pruned);
  }, []);

  const tickCacheRef = useRef(new Map()); // symbol -> { at, ticks }

  // Second stage: for each volume-spike candidate, read the TAPE (intraday ticks)
  // to see whether LARGE players are BUYING or SELLING. Only big-buying names
  // fire a "strong" alert; big-selling ones are shown as distribution to avoid.
  const enrichRadar = useCallback(async (cands, now) => {
    if (!hasBridge || !cands.length) return;
    const enriched = [];
    for (const c of cands) {
      let ticks = null;
      const cached = tickCacheRef.current.get(c.symbol);
      if (cached && now - cached.at < 20000) ticks = cached.ticks;
      else {
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await window.psx.getIntraday(c.symbol);
          if (res.ok) { ticks = res.data; tickCacheRef.current.set(c.symbol, { at: now, ticks }); }
        } catch (e) { /* tape optional */ }
      }
      enriched.push({ ...c, tape: ticks ? analyzeTape(ticks) : null });
    }
    setRadar((prev) => ({ ...prev, list: enriched, updatedAt: now, active: true }));

    const fired = [];
    for (const h of enriched) {
      if (!h.tape || h.tape.bias !== 'buy') continue; // strong = large buyers in control
      const lastA = radarAlertedRef.current.get(h.symbol) || 0;
      if (now - lastA > 5 * 60 * 1000) {
        radarAlertedRef.current.set(h.symbol, now);
        const big = h.tape.biggest;
        const msg = `${h.symbol} @ ${h.price}: LARGE BUYING (${h.tape.buyPct}% buy pressure${big ? `, biggest ${big.volume} sh` : ''}). +${h.dPct.toFixed(2)}% now, vol ${h.surge.toFixed(1)}x.`;
        if (settingsRef.current.desktopNotifications) window.psx.notify('⚡ Big-Buy Momentum', msg);
        if (settingsRef.current.soundAlerts) playBeep();
        fired.push({
          symbol: h.symbol, name: h.name, price: h.price, dPct: h.dPct, surge: h.surge, changePct: h.changePct,
          at: now, buyPct: h.tape.buyPct, biggest: big ? big.volume : null, biggestPrice: big ? big.price : null,
        });
      }
    }
    if (fired.length) persistRadarLog([...fired, ...radarLogRef.current]);
  }, [persistRadarLog]);

  useEffect(() => {
    if (!rows.length) return;
    const status = getMarketStatus();
    const prev = prevSnapRef.current;
    const now = Date.now();
    const candidates = [];
    let haveBaseline = false;

    const wlMode = radarModeRef.current === 'watchlist';
    for (const r of rows) {
      if (r.isDebt || r.current == null || r.volume == null) continue;
      if (wlMode && !watchlistRef.current.includes(r.symbol)) { prev.set(r.symbol, { current: r.current, volume: r.volume }); continue; }
      const p = prev.get(r.symbol);
      if (p) {
        let vDelta = r.volume - p.volume;
        if (vDelta < 0) vDelta = 0;
        const hist = volHistRef.current.get(r.symbol) || [];
        const baseline = hist.length >= 2 ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
        if (baseline > 0) haveBaseline = true;
        const dPct = p.current ? ((r.current - p.current) / p.current) * 100 : 0;
        const surge = baseline > 0 ? vDelta / baseline : 0;
        const nearHigh = r.high == null || r.current >= r.high * 0.999;
        const liquid = r.volume >= 50000;
        if (status.open && dPct >= 0.3 && surge >= 3 && vDelta >= 10000 && nearHigh && liquid) {
          candidates.push({ symbol: r.symbol, name: r.name, price: r.current, dPct, surge, changePct: r.changePct, vDelta, at: now });
        }
        hist.push(vDelta); if (hist.length > 5) hist.shift();
        volHistRef.current.set(r.symbol, hist);
      }
      prev.set(r.symbol, { current: r.current, volume: r.volume });
    }

    if (!status.open) { setRadar({ list: [], updatedAt: now, active: false, warming: false }); return; }

    candidates.sort((a, b) => (b.surge * b.dPct) - (a.surge * a.dPct));
    setRadar({ list: candidates.slice(0, 12), updatedAt: now, active: true, warming: !haveBaseline });
    enrichRadar(candidates.slice(0, 8), now);
  }, [rows, enrichRadar]);

  // --- Alert evaluation: runs whenever fresh rows arrive (background, non-blocking) ---
  useEffect(() => {
    if (!rows.length || !alertsRef.current.length) return;
    let changed = false;
    const next = alertsRef.current.map((al) => {
      if (al.triggeredAt) return al;
      const row = rows.find((r) => r.symbol === al.symbol);
      if (!row || !checkAlert(al, row)) return al;
      changed = true;
      const msg = alertMessage(al, row);
      if (settingsRef.current.desktopNotifications && hasBridge) window.psx.notify('PSX Alert', msg);
      if (settingsRef.current.soundAlerts) playBeep();
      return { ...al, triggeredAt: Date.now(), lastMessage: msg };
    });
    if (changed) persistAlerts(next);
  }, [rows, persistAlerts]);

  // --- Derived equity rows (exclude debt instruments for the equity views) ---
  const equityRows = useMemo(() => rows.filter((r) => !r.isDebt && r.current != null), [rows]);

  // --- Trade Journal (user's own trades; honest track record) ---
  const persistJournal = useCallback((j) => {
    setJournalState(j);
    if (hasBridge) window.psx.setJournal(j);
  }, []);
  const addTrade = useCallback((trade) => {
    const id = `${trade.symbol}-${Math.round(performance.now())}`;
    persistJournal([{ ...trade, id, status: 'open', openedAt: Date.now() }, ...journalRef.current]);
  }, [persistJournal]);
  const closeTrade = useCallback((id, exit) => {
    persistJournal(journalRef.current.map((t) => (t.id === id ? { ...t, status: 'closed', exit, exitAt: Date.now() } : t)));
  }, [persistJournal]);
  const deleteTrade = useCallback((id) => { persistJournal(journalRef.current.filter((t) => t.id !== id)); }, [persistJournal]);

  // --- Portfolio holdings (positions you already own; strategy per holding) ---
  const persistHoldings = useCallback((h) => {
    setHoldingsState(h);
    if (hasBridge) window.psx.setHoldings(h);
  }, []);
  // Each holding keeps its individual BUY LOTS so you can see every purchase
  // (qty @ price @ date) and the weighted-average cost is derived from them.
  const legacyLots = (h) => (h.lots ? h.lots : [{ id: `${h.symbol}-legacy`, qty: h.qty, price: h.avgCost, at: h.addedAt || 0 }]);
  const addHolding = useCallback((holding) => {
    const sym = String(holding.symbol || '').toUpperCase().trim();
    if (!sym || !(holding.qty > 0) || !(holding.avgCost > 0)) return;
    const lot = { id: `${sym}-${Math.round(performance.now())}-${holding.qty}`, qty: holding.qty, price: holding.avgCost, at: holding.at || Date.now() };
    const existing = holdingsRef.current.find((h) => h.symbol === sym);
    let next;
    if (existing) {
      next = holdingsRef.current.map((h) => (h.symbol === sym ? { ...h, lots: [...legacyLots(h), lot] } : h));
    } else {
      next = [{ symbol: sym, lots: [lot], addedAt: Date.now() }, ...holdingsRef.current];
    }
    persistHoldings(next);
  }, [persistHoldings]);
  const removeLot = useCallback((symbol, lotId) => {
    const next = holdingsRef.current
      .map((h) => (h.symbol === symbol ? { ...h, lots: legacyLots(h).filter((l) => l.id !== lotId) } : h))
      .filter((h) => legacyLots(h).length > 0);
    persistHoldings(next);
  }, [persistHoldings]);
  const removeHolding = useCallback((symbol) => {
    persistHoldings(holdingsRef.current.filter((h) => h.symbol !== symbol));
  }, [persistHoldings]);
  const setHoldingStop = useCallback((symbol, stop) => {
    const v = stop != null && Number(stop) > 0 ? Number(stop) : null;
    persistHoldings(holdingsRef.current.map((h) => (h.symbol === symbol ? { ...h, stop: v } : h)));
  }, [persistHoldings]);

  // Open-position guard: desktop + sound alert the moment a held trade hits its
  // stop or target — from ANY tab, so you can act to protect capital / book.
  const tradeAlertedRef = useRef(new Map()); // trade id -> 'stop' | 'target'
  useEffect(() => {
    if (!rows.length || !journalRef.current.length) return;
    if (!getMarketStatus().open) return; // prices only move while open
    for (const t of journalRef.current) {
      if (t.status !== 'open') continue;
      const r = rows.find((x) => x.symbol === t.symbol);
      if (!r || r.current == null) continue;
      const fired = tradeAlertedRef.current.get(t.id);
      if (r.current <= t.stop && fired !== 'stop') {
        tradeAlertedRef.current.set(t.id, 'stop');
        if (settingsRef.current.desktopNotifications && hasBridge) window.psx.notify('⛔ Stop hit', `${t.symbol} hit your stop ${t.stop} (now ${r.current}). Consider exiting to protect capital.`);
        if (settingsRef.current.soundAlerts) playBeep();
      } else if (t.target != null && r.current >= t.target && fired !== 'target') {
        tradeAlertedRef.current.set(t.id, 'target');
        if (settingsRef.current.desktopNotifications && hasBridge) window.psx.notify('🎯 Target hit', `${t.symbol} reached your target ${t.target} (now ${r.current}). Consider booking profit.`);
        if (settingsRef.current.soundAlerts) playBeep();
      }
    }
  }, [rows]);

  // Portfolio holdings guard — the autonomous "protect my positions" watcher.
  // Every 2 min while the market is open, it checks each holding you added and
  // fires a desktop + sound alert BEFORE the loss grows: on the hard stop, when
  // it approaches the stop, when the stock TURNS to a downtrend (early sell to
  // limit loss), on a sharp intraday drop, and on heavy selling (distribution).
  // Deduped per symbol+reason so it warns once, not every tick.
  const holdingAlertedRef = useRef(new Map()); // `${symbol}:${type}` -> timestamp
  useEffect(() => {
    if (!hasBridge) return undefined;
    const r2 = (n) => Math.round(n * 100) / 100;
    const fireOnce = (sym, type, title, body, cooldownH) => {
      const key = `${sym}:${type}`;
      const last = holdingAlertedRef.current.get(key) || 0;
      if (Date.now() - last < (cooldownH || 6) * 3600 * 1000) return;
      holdingAlertedRef.current.set(key, Date.now());
      if (settingsRef.current.desktopNotifications) window.psx.notify(title, body);
      if (settingsRef.current.soundAlerts) playBeep();
    };
    const check = async () => {
      if (!getMarketStatus().open) return;
      for (const h of holdingsRef.current) {
        const r = rowsRef.current.find((x) => x.symbol === h.symbol);
        if (!r || r.current == null) continue;
        const price = r.current;
        const lots = h.lots ? h.lots : [{ qty: h.qty, price: h.avgCost }];
        const qty = lots.reduce((s, l) => s + l.qty, 0);
        const invested = lots.reduce((s, l) => s + l.qty * l.price, 0);
        const avgCost = qty > 0 ? invested / qty : 0;
        const plPct = avgCost ? ((price - avgCost) / avgCost) * 100 : 0;
        // eslint-disable-next-line no-await-in-loop
        const a = await getAnalysis(h.symbol).catch(() => null);
        const adv = holdingStrategy(a, avgCost, price);
        const stop = (h.stop != null && h.stop > 0) ? h.stop : adv.stop;
        const m = (a && a.metrics) || {};
        const pl = `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`;

        // 1) Hard stop hit — strongest; skip the softer alerts this round.
        if (stop != null && price <= stop) {
          fireOnce(h.symbol, 'stop', '⛔ Stop hit — SELL', `${h.symbol} at ${r2(price)} hit your stop ${r2(stop)} (${pl}). Exit now to protect capital.`, 6);
          continue;
        }
        // 2) Turned to a downtrend — the early "sell to limit loss" call.
        if (adv.tone === 'sell') {
          fireOnce(h.symbol, 'downtrend', '🔻 Downtrend — reduce/exit', `${h.symbol} has turned to a downtrend (Stage-4/bearish) at ${r2(price)} (${pl}). Reduce or exit early to keep the loss small — don't hope-hold.`, 8);
        } else if (m.ema20 != null && price < m.ema20 && avgCost && price < avgCost) {
          // Short-term trend break while in loss — early warning to tighten up.
          fireOnce(h.symbol, 'emabreak', '⚠ Trend weakening', `${h.symbol} slipped below its short-term trend (EMA20 ${r2(m.ema20)}) and you're in loss (${pl}). Watch closely / tighten your stop.`, 10);
        }
        // 3) Falling fast today — protect before it breaks lower.
        if (r.changePct != null && r.changePct <= -4) {
          fireOnce(h.symbol, 'sharpdrop', '📉 Falling fast', `${h.symbol} is down ${r.changePct.toFixed(1)}% today (now ${r2(price)}). If it breaks support, exit early to keep the loss small.`, 4);
        }
        // 4) Heavy selling on the tape (distribution) in a position you hold.
        if (a && a.tape && a.tape.bias === 'sell') {
          fireOnce(h.symbol, 'distribution', '🔻 Big selling on the tape', `${h.symbol}: large sellers in control today (buy pressure ${a.tape.buyPct}%). Consider protecting your position (now ${r2(price)}).`, 6);
        }
      }
    };
    check();
    const id = setInterval(check, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [hasBridge, getAnalysis]);

  // --- Announcements (official PSX filings — factual only) ---
  const getAnnouncements = useCallback(async (opts) => {
    if (!hasBridge) return { ok: false, error: 'Desktop backend required.' };
    return window.psx.getAnnouncements(opts);
  }, []);
  const getPayouts = useCallback(async (sym) => {
    if (!hasBridge) return { ok: false };
    return window.psx.getPayouts(sym);
  }, []);

  // --- Upcoming Dividends: scan liquid + watchlist payouts, compute eligibility ---
  const [dividends, setDividends] = useState({ list: [], scanning: false, progress: 0, scannedAt: null });
  const dividendScanningRef = useRef(false);

  const runDividendScan = useCallback(async () => {
    if (dividendScanningRef.current) return;
    dividendScanningRef.current = true;
    setDividends((o) => ({ ...o, scanning: true, progress: 0, list: [] }));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parseDMY = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
    const workdaysBefore = (d, n) => { const x = new Date(d); let c = 0; while (c < n) { x.setDate(x.getDate() - 1); const wd = x.getDay(); if (wd !== 0 && wd !== 6) c++; } return x; };

    const wl = watchlistRef.current;
    const liquid = rowsRef.current.filter((r) => !r.isDebt && r.current != null && (r.volume || 0) >= 50000)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 90).map((r) => r.symbol);
    const syms = Array.from(new Set([...wl, ...liquid]));
    const found = [];
    for (let i = 0; i < syms.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await getPayouts(syms[i]).catch(() => null);
      setDividends((o) => ({ ...o, progress: Math.round(((i + 1) / syms.length) * 100) }));
      if (!res || !res.ok || !res.data.items.length) continue;
      for (const e of res.data.items) {
        if (!/\(D\)/i.test(e.details)) continue; // cash dividend only
        const bc = parseDMY(e.bookClosure); if (!bc) continue;
        const diffDays = (bc - today) / 86400000;
        if (diffDays < -3 || diffDays > 60) continue; // near/upcoming only
        const lastBuy = workdaysBefore(bc, 3);
        const row = rowsRef.current.find((r) => r.symbol === syms[i]) || {};
        found.push({
          symbol: syms[i], name: row.name, price: row.current,
          details: e.details.replace(/\s+/g, ' '), bookClosure: e.bookClosure.replace(/\s+/g, ' '),
          lastBuyMs: lastBuy.getTime(), eligible: today <= lastBuy, inWatch: wl.includes(syms[i]),
        });
        break;
      }
      setDividends((o) => ({ ...o, list: [...found].sort((a, b) => a.lastBuyMs - b.lastBuyMs) }));
    }
    setDividends((o) => ({ ...o, list: found.sort((a, b) => a.lastBuyMs - b.lastBuyMs), scanning: false, scannedAt: Date.now() }));
    dividendScanningRef.current = false;
  }, [getPayouts]);

  const value = {
    rows, equityRows, fetchedAt, error, loading, hasBridge,
    watchlist, toggleWatch, settings, updateSettings,
    alerts, addAlert, removeAlert, rearmAlert,
    getAnalysis, getAnnouncements, getPayouts, getRegime, getIndexQuote, refresh,
    dividends, runDividendScan,
    opportunities, runOpportunityScan,
    radar, radarLog, radarMode, setRadarMode,
    nextDay, runNextDayScan,
    planner, runPlannerScan,
    buySignals, runBuySignalScan,
    journal, addTrade, closeTrade, deleteTrade,
    holdings, addHolding, removeLot, removeHolding, setHoldingStop,
  };

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}
