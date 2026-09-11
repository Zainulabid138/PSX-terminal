/**
 * indicators.js
 * -------------
 * Pure technical-analysis functions. Every value is computed from REAL market
 * data passed in by the caller (PSX EOD close/volume series + today's snapshot).
 *
 * IMPORTANT — honesty about the data source:
 * The PSX EOD endpoint provides daily CLOSE and VOLUME, but NOT historical
 * open/high/low. Therefore indicators that strictly require historical OHLC
 * (ATR, ADX, CCI, classic Stochastic with H/L, SuperTrend, Ichimoku, PSAR,
 * Parabolic SAR) cannot be computed faithfully from daily history. Those are
 * reported by the AI layer as "Data unavailable from source." rather than
 * being approximated and presented as if exact. Indicators here are the ones
 * that are correct from close+volume (and intraday ticks for VWAP).
 *
 * All functions return null (or arrays padded with null) when there is
 * insufficient data, so the UI can show "Insufficient data to calculate."
 */

/** Simple Moving Average -> array aligned to input (null until enough data). */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential Moving Average -> array aligned to input (null until seeded). */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  // Seed with SMA of the first `period` values.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (used by RSI). */
function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index (Wilder). Returns array aligned to closes. */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  const gains = new Array(closes.length).fill(0);
  const losses = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }
  const avgGain = wilderSmooth(gains.slice(1), period);
  const avgLoss = wilderSmooth(losses.slice(1), period);
  for (let i = 0; i < avgGain.length; i++) {
    if (avgGain[i] === null) continue;
    const ag = avgGain[i];
    const al = avgLoss[i];
    const idx = i + 1; // realign to closes
    if (al === 0) {
      out[idx] = 100;
    } else {
      const rs = ag / al;
      out[idx] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

/** MACD (12,26,9). Returns { macd, signal, histogram } arrays aligned to closes. */
export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  // Signal = EMA of the macdLine over its non-null section.
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signal = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const sub = macdLine.slice(firstValid).map((v) => (v === null ? 0 : v));
    const sig = ema(sub, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i];
  }
  const histogram = closes.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null ? macdLine[i] - signal[i] : null
  );
  return { macd: macdLine, signal, histogram };
}

/** Bollinger Bands (20, 2) on close. Returns { middle, upper, lower } arrays. */
export function bollinger(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - middle[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
  }
  return { middle, upper, lower };
}

/** On-Balance Volume from close + volume. Returns array aligned to input. */
export function obv(closes, volumes) {
  const out = new Array(closes.length).fill(null);
  if (closes.length === 0) return out;
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    const v = volumes[i] || 0;
    if (closes[i] > closes[i - 1]) acc += v;
    else if (closes[i] < closes[i - 1]) acc -= v;
    out[i] = acc;
  }
  return out;
}

/** Rate of Change (%) over `period` closes. */
export function roc(closes, period = 10) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    if (closes[i - period] !== 0) out[i] = ((closes[i] - closes[i - period]) / closes[i - period]) * 100;
  }
  return out;
}

/**
 * Close-based Stochastic oscillator. Classic Stochastic uses session high/low;
 * because PSX EOD history lacks H/L, we compute %K from the rolling max/min of
 * CLOSE. This is labelled clearly in the UI as close-based so it is not
 * mistaken for the H/L variant.
 */
export function stochasticClose(closes, period = 14, smoothK = 3, smoothD = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (closes[j] > hi) hi = closes[j];
      if (closes[j] < lo) lo = closes[j];
    }
    k[i] = hi === lo ? 50 : ((closes[i] - lo) / (hi - lo)) * 100;
  }
  const kSmoothArr = sma(k.map((v) => (v === null ? 0 : v)), smoothK).map((v, i) =>
    k[i] === null ? null : v
  );
  const d = sma(kSmoothArr.map((v) => (v === null ? 0 : v)), smoothD).map((v, i) =>
    kSmoothArr[i] === null ? null : v
  );
  return { k: kSmoothArr, d };
}

/**
 * Daily return volatility (standard deviation of close-to-close % returns) over
 * `period`. This is a faithful volatility measure from close data and is used
 * for risk sizing in place of ATR (which needs H/L history the source lacks).
 * Returns the latest value as a percentage, or null.
 */
export function returnVolatility(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const returns = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] === 0) continue;
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/**
 * VWAP from intraday ticks ([{ price, volume }]). Faithful because intraday
 * provides per-tick price & volume. Returns a single VWAP number or null.
 */
export function vwapFromTicks(ticks) {
  if (!ticks || ticks.length === 0) return null;
  let pv = 0;
  let vol = 0;
  for (const t of ticks) {
    if (t.price == null || t.volume == null) continue;
    pv += t.price * t.volume;
    vol += t.volume;
  }
  return vol > 0 ? pv / vol : null;
}

/** Returns the last non-null value of an indicator array. */
export function last(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  }
  return null;
}

/** Average of the last `n` volumes (excluding today if requested). */
export function averageVolume(volumes, n = 20) {
  const valid = volumes.filter((v) => v != null);
  if (valid.length < n) return null;
  const slice = valid.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** 52-week (or full-history) high/low from closes. */
export function highLow(closes, lookback = 252) {
  if (!closes.length) return { high: null, low: null };
  const slice = closes.slice(-lookback);
  return { high: Math.max(...slice), low: Math.min(...slice) };
}

// ---------------------------------------------------------------------------
// Additional faithful indicators (close/volume-based) added for the
// institutional-grade analysis engine.
// ---------------------------------------------------------------------------

/**
 * Stochastic RSI. StochRSI is the stochastic oscillator applied to the RSI
 * series (which itself comes from closes), so it is faithfully computable
 * without high/low data. Returns { k, d } arrays plus the latest %K.
 */
export function stochRSI(closes, rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
  const r = rsi(closes, rsiPeriod);
  const k = new Array(closes.length).fill(null);
  for (let i = 0; i < r.length; i++) {
    if (r[i] === null) continue;
    let hi = -Infinity; let lo = Infinity; let cnt = 0;
    for (let j = i; j >= 0 && cnt < stochPeriod; j--) {
      if (r[j] === null) continue;
      hi = Math.max(hi, r[j]); lo = Math.min(lo, r[j]); cnt++;
    }
    if (cnt < stochPeriod) continue;
    k[i] = hi === lo ? 50 : ((r[i] - lo) / (hi - lo)) * 100;
  }
  const kS = sma(k.map((v) => (v === null ? 0 : v)), smoothK).map((v, i) => (k[i] === null ? null : v));
  const d = sma(kS.map((v) => (v === null ? 0 : v)), smoothD).map((v, i) => (kS[i] === null ? null : v));
  return { k: kS, d };
}

/** Linear-regression slope of a numeric array (per-index change). */
export function slope(values) {
  const n = values.length;
  if (n < 2) return null;
  let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i; }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? null : (n * sxy - sx * sy) / denom;
}

/**
 * Resample a daily series ([{time, close, volume}], ascending) into weekly or
 * monthly bars. Close = last trading day's close in the bucket (faithful),
 * volume = sum over the bucket.
 */
export function resample(series, period = 'week') {
  const buckets = new Map();
  for (const d of series) {
    const dt = new Date(d.time * 1000);
    let key;
    if (period === 'week') {
      const onejan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((dt - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
      key = `${dt.getUTCFullYear()}-W${week}`;
    } else {
      key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
    }
    const prevVol = buckets.has(key) ? buckets.get(key).volume : 0;
    buckets.set(key, { time: d.time, close: d.close, volume: prevVol + (d.volume || 0) });
  }
  return Array.from(buckets.values());
}

/** Fibonacci retracement levels between a swing low and swing high. */
export function fibLevels(low, high) {
  if (low == null || high == null || high <= low) return null;
  const range = high - low;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const levels = {};
  for (const r of ratios) levels[r] = high - range * r; // retracement from the high
  return levels;
}

/** Classic pivot points from a completed session's high/low/close. */
export function pivotPoints(high, low, close) {
  if ([high, low, close].some((v) => v == null)) return null;
  const p = (high + low + close) / 3;
  return {
    p,
    r1: 2 * p - low,
    s1: 2 * p - high,
    r2: p + (high - low),
    s2: p - (high - low),
  };
}

/**
 * Relative strength of a stock vs a benchmark index over `period` trading days.
 * Both inputs are ascending {time, close} series aligned by timestamp.
 * Returns return comparison + whether the RS line is rising.
 */
export function relativeStrength(stock, index, period = 63) {
  if (!stock?.length || !index?.length) return null;
  const idx = new Map(index.map((d) => [d.time, d.close]));
  const pairs = [];
  for (const d of stock) if (idx.has(d.time)) pairs.push({ s: d.close, i: idx.get(d.time) });
  if (pairs.length < period + 1) return null;
  const a = pairs[pairs.length - 1 - period];
  const b = pairs[pairs.length - 1];
  if (a.s === 0 || a.i === 0) return null;
  const stockReturn = ((b.s - a.s) / a.s) * 100;
  const indexReturn = ((b.i - a.i) / a.i) * 100;
  return {
    stockReturn,
    indexReturn,
    outperformance: stockReturn - indexReturn,
    rsRising: b.s / b.i > a.s / a.i,
    period,
  };
}
