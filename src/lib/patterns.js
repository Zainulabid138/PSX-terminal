/**
 * patterns.js
 * -----------
 * Price-action / pattern detection from REAL data.
 *
 * Two honest categories given the PSX data source:
 *
 * 1) CLOSE-SERIES patterns (faithful from daily closes):
 *    - Support / resistance levels (swing pivots)
 *    - Trend structure (higher-highs/higher-lows vs lower-highs/lower-lows)
 *    - Breakout / breakdown vs recent range
 *    - Double top / double bottom (swing-based)
 *    - Gap up / gap down (today open vs previous close)
 *
 * 2) TODAY single-candle patterns (faithful from today's snapshot OHLC):
 *    - Doji, Hammer, Inverted Hammer, Shooting Star, Spinning Top, Marubozu
 *
 * Multi-candle candlestick patterns (engulfing, morning/evening star, harami,
 * three soldiers/crows, piercing, dark cloud) require consecutive historical
 * OHLC candles, which the EOD source does not provide. Those are reported as
 * "Requires OHLC candle history not available from source." rather than guessed.
 */

/** Find swing-high and swing-low pivot indices using a left/right window. */
export function findPivots(closes, window = 3) {
  const highs = [];
  const lows = [];
  for (let i = window; i < closes.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (closes[j] > closes[i]) isHigh = false;
      if (closes[j] < closes[i]) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: closes[i] });
    if (isLow) lows.push({ index: i, price: closes[i] });
  }
  return { highs, lows };
}

/**
 * Nearest support (below price) and resistance (above price) from recent pivots.
 * Returns { support, resistance } prices or null when none found.
 */
export function supportResistance(closes, window = 3) {
  if (closes.length < window * 2 + 2) return { support: null, resistance: null };
  const price = closes[closes.length - 1];
  const { highs, lows } = findPivots(closes, window);
  const resistances = highs.map((h) => h.price).filter((p) => p > price);
  const supports = lows.map((l) => l.price).filter((p) => p < price);
  return {
    resistance: resistances.length ? Math.min(...resistances) : null,
    support: supports.length ? Math.max(...supports) : null,
  };
}

/**
 * Determine trend structure from the last few swing pivots.
 * Returns 'uptrend' | 'downtrend' | 'sideways' and a short reason.
 */
export function trendStructure(closes, window = 3) {
  if (closes.length < window * 4) return { trend: 'sideways', reason: 'Insufficient data to determine structure.' };
  const { highs, lows } = findPivots(closes, window);
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  if (lastHighs.length === 2 && lastLows.length === 2) {
    const hh = lastHighs[1].price > lastHighs[0].price;
    const hl = lastLows[1].price > lastLows[0].price;
    const lh = lastHighs[1].price < lastHighs[0].price;
    const ll = lastLows[1].price < lastLows[0].price;
    if (hh && hl) return { trend: 'uptrend', reason: 'Higher highs and higher lows.' };
    if (lh && ll) return { trend: 'downtrend', reason: 'Lower highs and lower lows.' };
  }
  return { trend: 'sideways', reason: 'No clean higher-high/lower-low structure.' };
}

/** Detect breakout/breakdown vs the recent range (excluding the latest bar). */
export function breakout(closes, lookback = 20) {
  if (closes.length < lookback + 1) return null;
  const price = closes[closes.length - 1];
  const range = closes.slice(closes.length - 1 - lookback, closes.length - 1);
  const hi = Math.max(...range);
  const lo = Math.min(...range);
  if (price > hi) return { type: 'breakout', level: hi, reason: `Closed above ${lookback}-day high (${hi.toFixed(2)}).` };
  if (price < lo) return { type: 'breakdown', level: lo, reason: `Closed below ${lookback}-day low (${lo.toFixed(2)}).` };
  return null;
}

/** Swing-based double top / double bottom near the recent pivots. */
export function doubleTopBottom(closes, window = 3, tolerancePct = 2.5) {
  const { highs, lows } = findPivots(closes, window);
  const result = [];
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    if (Math.abs(a.price - b.price) / a.price * 100 <= tolerancePct) {
      result.push({ type: 'Double Top', bias: 'bearish', level: Math.max(a.price, b.price) });
    }
  }
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    if (Math.abs(a.price - b.price) / a.price * 100 <= tolerancePct) {
      result.push({ type: 'Double Bottom', bias: 'bullish', level: Math.min(a.price, b.price) });
    }
  }
  return result;
}

/** Gap up / gap down from today's open vs previous close. */
export function gap(open, prevClose) {
  if (open == null || prevClose == null || prevClose === 0) return null;
  const pct = ((open - prevClose) / prevClose) * 100;
  if (pct >= 2) return { type: 'Gap Up', pct };
  if (pct <= -2) return { type: 'Gap Down', pct };
  return null;
}

/**
 * Single-candle patterns from today's snapshot OHLC.
 * Returns an array of { name, bias }.
 */
export function todayCandlePatterns({ open, high, low, close }) {
  const out = [];
  if ([open, high, low, close].some((v) => v == null)) return out;
  const range = high - low;
  if (range <= 0) return out;
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const bodyPct = body / range;

  if (bodyPct < 0.1) {
    out.push({ name: 'Doji', bias: 'neutral' });
  }
  if (bodyPct < 0.3 && upperWick > body * 1.5 && lowerWick > body * 1.5) {
    out.push({ name: 'Spinning Top', bias: 'neutral' });
  }
  if (lowerWick > body * 2 && upperWick < body && bodyPct < 0.4) {
    out.push({ name: close >= open ? 'Hammer' : 'Hanging Man', bias: close >= open ? 'bullish' : 'bearish' });
  }
  if (upperWick > body * 2 && lowerWick < body && bodyPct < 0.4) {
    out.push({ name: close >= open ? 'Inverted Hammer' : 'Shooting Star', bias: close >= open ? 'bullish' : 'bearish' });
  }
  if (bodyPct > 0.9) {
    out.push({ name: close > open ? 'Bullish Marubozu' : 'Bearish Marubozu', bias: close > open ? 'bullish' : 'bearish' });
  }
  return out;
}

/**
 * Triangle / channel detection from swing-pivot trendline slopes.
 * Ascending: rising lows + roughly flat highs. Descending: falling highs +
 * roughly flat lows. Symmetrical: converging (falling highs + rising lows).
 * Faithful because it uses close-based swing pivots.
 */
export function triangle(closes, window = 3) {
  const { highs, lows } = findPivots(closes, window);
  if (highs.length < 2 || lows.length < 2) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  const hSlope = lineSlope(h.map((p) => p.price));
  const lSlope = lineSlope(l.map((p) => p.price));
  if (hSlope == null || lSlope == null) return null;
  const ref = closes[closes.length - 1] || 1;
  const flat = (s) => Math.abs(s) / ref < 0.001;
  if (lSlope > 0 && flat(hSlope)) return { type: 'Ascending Triangle', bias: 'bullish' };
  if (hSlope < 0 && flat(lSlope)) return { type: 'Descending Triangle', bias: 'bearish' };
  if (hSlope < 0 && lSlope > 0) return { type: 'Symmetrical Triangle', bias: 'neutral' };
  return null;
}

function lineSlope(values) {
  const n = values.length;
  if (n < 2) return null;
  let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i; }
  const d = n * sxx - sx * sx;
  return d === 0 ? null : (n * sxy - sx * sy) / d;
}

/**
 * Trap / false-breakout detection using the latest session's intraday extremes
 * (from the snapshot) against recent close-based support/resistance.
 *  - Bull trap: session pushed above resistance but closed back below it.
 *  - Bear trap: session pushed below support but closed back above it.
 *  - False breakout risk: a breakout/breakdown that occurred on below-average volume.
 */
export function trapSignals({ high, low, close, resistance, support, breakoutInfo, volRatio }) {
  const out = [];
  if (high != null && close != null && resistance != null && high > resistance && close < resistance) {
    out.push({ type: 'Bull Trap', bias: 'bearish', reason: `Session high pierced resistance (${resistance.toFixed(2)}) but closed back below it.` });
  }
  if (low != null && close != null && support != null && low < support && close > support) {
    out.push({ type: 'Bear Trap', bias: 'bullish', reason: `Session low pierced support (${support.toFixed(2)}) but closed back above it.` });
  }
  if (breakoutInfo && volRatio != null && volRatio < 1) {
    out.push({ type: 'Unconfirmed Breakout', bias: 'neutral', reason: `${breakoutInfo.type} occurred on below-average volume (${volRatio.toFixed(2)}x) — elevated false-breakout risk.` });
  }
  return out;
}

/**
 * Multi-candle candlestick patterns the source cannot support.
 * Returned so the UI can transparently say why they are not evaluated.
 */
export const UNAVAILABLE_CANDLE_PATTERNS = [
  'Bullish Engulfing', 'Bearish Engulfing', 'Morning Star', 'Evening Star',
  'Harami', 'Piercing Pattern', 'Dark Cloud Cover', 'Three White Soldiers',
  'Three Black Crows',
];
