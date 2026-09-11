/**
 * projection.js — an HONEST "how far could it move" range.
 * -------------------------------------------------------
 * You cannot predict a specific future price. What you CAN do is estimate a
 * realistic RANGE from the stock's own volatility: over N trading days, price
 * is roughly within ± (daily σ × √N) with ~68% likelihood (1 std), ~95% at
 * 2 std. This is a spread of possibilities — NOT a forecast, NOT a target.
 *
 * Direction is a separate question (the engine's bullish/bearish probability).
 * If volatility is extreme (e.g., a pumped penny stock), the range explodes —
 * which is the honest signal that a "target" for that stock is meaningless.
 */

const HORIZON_DAYS = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 };

export function project(price, dailyVolPct, horizon) {
  if (price == null || !dailyVolPct || dailyVolPct <= 0) return null;
  const N = HORIZON_DAYS[horizon] || 63;
  const sig = dailyVolPct / 100;
  const band = sig * Math.sqrt(N);
  const extreme = dailyVolPct >= 8; // ~8%+ daily σ = wild/speculative
  return {
    horizon,
    days: N,
    dailyVolPct,
    band,
    extreme,
    r68: [price * Math.exp(-band), price * Math.exp(band)],
    r95: [price * Math.exp(-2 * band), price * Math.exp(2 * band)],
  };
}

export const PROJECTION_HORIZONS = Object.keys(HORIZON_DAYS);
