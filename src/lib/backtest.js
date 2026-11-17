/**
 * backtest.js — an HONEST historical test of the trend/momentum signal.
 * -------------------------------------------------------------------
 * Walks a stock's real daily-close history and, using ONLY data available up to
 * each day (no look-ahead), marks days that met the buy rule:
 *   - Stage 2 proxy: close above a RISING 150-day SMA
 *   - Trend: EMA20 > EMA50
 *   - Momentum: RSI(14) in 50–70 AND MACD above its signal
 * Then it simulates a mechanical 2:1 trade from the next day: stop at -1R,
 * target at +2R (R sized from the stock's own volatility), exiting on the first
 * close to breach either, or at the horizon. Non-overlapping trades.
 *
 * HONEST LIMITATIONS (surfaced in the UI):
 *   - CLOSE-only data: stops/targets are checked on the daily CLOSE, so real
 *     intraday hits are not modelled — results are approximate/optimistic.
 *   - No brokerage, tax or slippage. No dividends. Past ≠ future.
 *   - A single stock is a tiny sample; treat as indicative, not proof.
 */

import { ema, sma, rsi, macd, returnVolatility } from './indicators.js';

export function backtest(closes, opts = {}) {
  const horizon = opts.horizon || 10;
  if (!closes || closes.length < 200) return { error: 'Need at least 200 daily closes to backtest.' };

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const s150 = sma(closes, 150);
  const rs = rsi(closes, 14);
  const mac = macd(closes);

  // One volatility-based R for the whole run (documented simplification).
  const vol = returnVolatility(closes, 60) || 3;
  const stopFrac = Math.min(0.08, Math.max(0.02, (vol / 100) * 1.5));

  const trades = [];
  for (let t = 170; t < closes.length - 1; t++) {
    if (e20[t] == null || e50[t] == null || s150[t] == null || s150[t - 20] == null || rs[t] == null || mac.macd[t] == null || mac.signal[t] == null) continue;
    const stage2 = closes[t] > s150[t] && s150[t] > s150[t - 20];
    const trend = e20[t] > e50[t];
    const mom = rs[t] >= 50 && rs[t] < 70 && mac.macd[t] > mac.signal[t];
    if (!(stage2 && trend && mom)) continue;

    const entry = closes[t];
    const risk = entry * stopFrac;
    const stop = entry - risk;
    const target = entry + 2 * risk;
    let rMult = null; let exitIdx = null;
    for (let k = t + 1; k <= Math.min(t + horizon, closes.length - 1); k++) {
      if (closes[k] <= stop) { rMult = -1; exitIdx = k; break; }
      if (closes[k] >= target) { rMult = 2; exitIdx = k; break; }
    }
    if (rMult == null) { exitIdx = Math.min(t + horizon, closes.length - 1); rMult = (closes[exitIdx] - entry) / risk; }
    trades.push({ t, entry, exit: closes[exitIdx], rMult, hold: exitIdx - t });
    t = exitIdx; // non-overlapping: resume after the exit
  }

  if (!trades.length) return { trades: 0, stopFrac };
  const wins = trades.filter((x) => x.rMult > 0);
  const grossWinR = wins.reduce((a, b) => a + b.rMult, 0);
  const grossLossR = Math.abs(trades.filter((x) => x.rMult <= 0).reduce((a, b) => a + b.rMult, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    losses: trades.length - wins.length,
    winRate: (wins.length / trades.length) * 100,
    avgR: trades.reduce((a, b) => a + b.rMult, 0) / trades.length,
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : Infinity,
    avgHold: trades.reduce((a, b) => a + b.hold, 0) / trades.length,
    stopFrac, horizon,
    totalR: trades.reduce((a, b) => a + b.rMult, 0),
    grossWinR, grossLossR,
  };
}

/** Merge many single-stock results into one aggregate (for a basket/watchlist). */
export function aggregate(results) {
  const valid = results.filter((r) => r && r.trades > 0);
  if (!valid.length) return { trades: 0, symbols: 0 };
  const trades = valid.reduce((a, b) => a + b.trades, 0);
  const wins = valid.reduce((a, b) => a + b.wins, 0);
  const totalR = valid.reduce((a, b) => a + b.totalR, 0);
  const grossWinR = valid.reduce((a, b) => a + b.grossWinR, 0);
  const grossLossR = valid.reduce((a, b) => a + b.grossLossR, 0);
  return {
    symbols: valid.length,
    trades,
    wins,
    losses: trades - wins,
    winRate: (wins / trades) * 100,
    avgR: totalR / trades,
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : Infinity,
    totalR,
  };
}
