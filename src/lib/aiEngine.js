/**
 * aiEngine.js — Institutional-grade, evidence-based analysis engine.
 * ------------------------------------------------------------------
 * Behaves like a disciplined institutional analyst, NOT a signal-selling system.
 *
 * Hard principles enforced in code:
 *   - Never guess, never fabricate, never invent indicators, never fake confidence.
 *   - Never force a Buy/Sell. If evidence conflicts or is weak -> "Watch"/"Hold"/no trade.
 *   - A trade is only "high quality" if ALL entry gates pass (trend + momentum +
 *     volume confirmed, Risk/Reward >= 2:1, logical stop & entry, no major conflict).
 *     Otherwise: "No High-Quality Trade Setup Available."
 *   - Confidence is CAPPED by the number of independent confirmations
 *     (<=60 weak, 70 average, 80 strong, 90 exceptional). The >=95 tier requires
 *     ADX confirmation among others; ADX needs historical high/low data that the
 *     PSX EOD source does NOT provide, so the engine HONESTLY can never reach
 *     >=95% — and says so. This is intended, disciplined behaviour.
 *   - No emotional or forbidden language ("guaranteed", "100%", "sure profit").
 *
 * Faithful inputs from the PSX source: daily close + volume history, today's
 * snapshot OHLC, intraday VWAP, the KSE-100 series (for relative strength), and
 * live sector aggregates. Indicators requiring historical high/low (ADX, ATR,
 * CCI, Keltner, CMF, MFI, A/D, Volume Profile) are reported as unavailable.
 */

import {
  ema, sma, rsi, macd, bollinger, obv, roc, stochRSI,
  returnVolatility, last, averageVolume, highLow, slope,
  resample, fibLevels, pivotPoints, relativeStrength,
} from './indicators.js';
import {
  supportResistance, trendStructure, breakout, doubleTopBottom, gap,
  todayCandlePatterns, triangle, trapSignals,
} from './patterns.js';

const MIN_BARS = 60;

function toProbability(score) {
  return Math.round((1 / (1 + Math.exp(-score / 3))) * 100);
}
function round(n) { return Math.round(n * 100) / 100; }

/** Trend label for a timeframe from its own close series. */
function timeframeTrend(closes) {
  if (closes.length < 10) return { dir: 'unknown', label: 'Insufficient data' };
  if (closes.length < 30) {
    const s = slope(closes.slice(-10));
    return { dir: s > 0 ? 'up' : s < 0 ? 'down' : 'flat', label: s > 0 ? 'Up' : s < 0 ? 'Down' : 'Flat' };
  }
  const eS = last(ema(closes, 10));
  const eL = last(ema(closes, 30));
  if (eS == null || eL == null) return { dir: 'unknown', label: 'Insufficient data' };
  const dir = eS > eL ? 'up' : eS < eL ? 'down' : 'flat';
  return { dir, label: dir === 'up' ? 'Bullish' : dir === 'down' ? 'Bearish' : 'Flat' };
}

/**
 * Main analysis entry point.
 * @param {object} input
 *   - snapshot: live market-watch row
 *   - eod: ascending [{time, close, volume}]
 *   - intradayVwap: number | null
 *   - indexSeries: ascending [{time, close}] for KSE-100 (relative strength) | null
 *   - sectorStrength: { name, avgChange, breadth, count } | null
 */
export function analyze({ snapshot, eod, intradayVwap = null, indexSeries = null, sectorStrength = null }) {
  const closes = (eod || []).map((d) => d.close).filter((v) => v != null);
  const volumes = (eod || []).map((d) => d.volume);

  if (closes.length < MIN_BARS) {
    return {
      ok: false, status: 'insufficient',
      message: 'No High-Quality Trade Setup Available.',
      detail: `Insufficient data to calculate — need ≥${MIN_BARS} daily closes; source returned ${closes.length}.`,
    };
  }

  const price = snapshot?.current ?? closes[closes.length - 1];

  // ---- Indicators (faithful) ----
  const ema9 = last(ema(closes, 9));
  const ema20 = last(ema(closes, 20));
  const ema50arr = ema(closes, 50);
  const ema50 = last(ema50arr);
  const ema100 = closes.length >= 100 ? last(ema(closes, 100)) : null;
  const ema200 = closes.length >= 200 ? last(ema(closes, 200)) : null;
  const sma50 = last(sma(closes, 50));
  const sma200 = closes.length >= 200 ? last(sma(closes, 200)) : null;
  const ema50slope = slope(ema50arr.filter((v) => v != null).slice(-20)) || 0;

  const rsiVal = last(rsi(closes, 14));
  const macdObj = macd(closes);
  const macdLine = last(macdObj.macd);
  const macdSignal = last(macdObj.signal);
  const srsi = stochRSI(closes);
  const stochRsiK = last(srsi.k);
  const roc10 = last(roc(closes, 10));

  const bb = bollinger(closes, 20, 2);
  const bbU = last(bb.upper); const bbL = last(bb.lower); const bbM = last(bb.middle);
  const bbWidthPct = bbU != null && bbL != null && bbM ? ((bbU - bbL) / bbM) * 100 : null;

  const obvArr = obv(closes, volumes);
  const obvSlope = obvArr.length > 6 ? last(obvArr) - obvArr[obvArr.length - 6] : 0;

  const volNow = snapshot?.volume ?? volumes[volumes.length - 1];
  const avgVol20 = averageVolume(volumes, 20);
  const volRatio = avgVol20 ? volNow / avgVol20 : null;
  const volatilityPct = returnVolatility(closes, 14);
  const { high: hi52, low: lo52 } = highLow(closes, 252);

  // ---- Multi-timeframe trend ----
  const weeklyCloses = resample(eod, 'week').map((d) => d.close);
  const monthlyCloses = resample(eod, 'month').map((d) => d.close);
  const dailyTrend = (ema20 != null && ema50 != null)
    ? { dir: ema20 > ema50 ? 'up' : 'down', label: ema20 > ema50 ? 'Bullish' : 'Bearish' }
    : { dir: 'unknown', label: 'Insufficient data' };
  const weeklyTrend = timeframeTrend(weeklyCloses);
  const monthlyTrend = timeframeTrend(monthlyCloses);

  // ---- Price action ----
  const sr = supportResistance(closes, 3);
  const struct = trendStructure(closes, 3);
  const brk = breakout(closes, 20);
  const dtb = doubleTopBottom(closes, 3);
  const tri = triangle(closes, 3);
  const gp = gap(snapshot?.open, snapshot?.ldcp);
  const candle = todayCandlePatterns({ open: snapshot?.open, high: snapshot?.high, low: snapshot?.low, close: snapshot?.current });
  const traps = trapSignals({ high: snapshot?.high, low: snapshot?.low, close: snapshot?.current, resistance: sr.resistance, support: sr.support, breakoutInfo: brk, volRatio });

  // ---- Support/Resistance levels (static + dynamic + fib + pivots) ----
  const fib = fibLevels(lo52, hi52);
  const pivots = pivotPoints(snapshot?.high, snapshot?.low, snapshot?.current);

  // ---- Relative strength vs KSE-100 ----
  const rs = indexSeries ? relativeStrength(eod, indexSeries, 63) : null;

  // ---- Market structure classification ----
  const marketStructure = classifyStructure({ price, ema50, ema200, ema50slope, struct, obvSlope });

  // ---- Weighted signals ----
  const signals = [];
  const add = (dir, weight, reason) => signals.push({ dir, weight, reason });

  if (ema20 != null && ema50 != null) {
    if (ema20 > ema50) add(+1, 1.4, `EMA20 (${ema20.toFixed(2)}) above EMA50 (${ema50.toFixed(2)}) — bullish trend.`);
    else add(-1, 1.4, `EMA20 (${ema20.toFixed(2)}) below EMA50 (${ema50.toFixed(2)}) — bearish trend.`);
  }
  if (ema200 != null) {
    if (price > ema200) add(+1, 1.2, `Price above EMA200 (${ema200.toFixed(2)}) — long-term uptrend.`);
    else add(-1, 1.2, `Price below EMA200 (${ema200.toFixed(2)}) — long-term downtrend.`);
  }
  if (sma50 != null && sma200 != null) {
    if (sma50 > sma200) add(+0.6, 0.8, 'SMA50 above SMA200 (golden-cross structure).');
    else add(-0.6, 0.8, 'SMA50 below SMA200 (death-cross structure).');
  }
  if (weeklyTrend.dir === 'up') add(+0.8, 1.0, 'Weekly trend bullish (multi-timeframe alignment).');
  else if (weeklyTrend.dir === 'down') add(-0.8, 1.0, 'Weekly trend bearish (multi-timeframe alignment).');

  if (macdLine != null && macdSignal != null) {
    if (macdLine > macdSignal) add(+1, 1.3, `MACD line (${macdLine.toFixed(3)}) above signal (${macdSignal.toFixed(3)}).`);
    else add(-1, 1.3, `MACD line (${macdLine.toFixed(3)}) below signal (${macdSignal.toFixed(3)}).`);
  }
  if (rsiVal != null) {
    if (rsiVal >= 70) add(-0.8, 1.0, `RSI = ${rsiVal.toFixed(1)} (overbought — pullback risk).`);
    else if (rsiVal <= 30) add(+0.8, 1.0, `RSI = ${rsiVal.toFixed(1)} (oversold — bounce potential).`);
    else if (rsiVal > 55) add(+0.5, 0.8, `RSI = ${rsiVal.toFixed(1)} (positive momentum).`);
    else if (rsiVal < 45) add(-0.5, 0.8, `RSI = ${rsiVal.toFixed(1)} (weak momentum).`);
  }
  if (stochRsiK != null) {
    if (stochRsiK <= 20) add(+0.4, 0.6, `Stochastic RSI %K = ${stochRsiK.toFixed(0)} (oversold).`);
    else if (stochRsiK >= 80) add(-0.4, 0.6, `Stochastic RSI %K = ${stochRsiK.toFixed(0)} (overbought).`);
  }
  if (roc10 != null) {
    if (roc10 > 3) add(+1, 0.9, `10-day ROC = +${roc10.toFixed(1)}%.`);
    else if (roc10 < -3) add(-1, 0.9, `10-day ROC = ${roc10.toFixed(1)}%.`);
  }
  if (volRatio != null) {
    if (volRatio >= 1.5) add(+0.7, 1.1, `Relative volume ${volRatio.toFixed(2)}x the 20-day average — strong participation.`);
    else if (volRatio < 0.6) add(-0.3, 0.6, `Relative volume ${volRatio.toFixed(2)}x average — weak participation.`);
  }
  if (obvSlope > 0) add(+0.6, 0.8, 'OBV rising — net accumulation.');
  else if (obvSlope < 0) add(-0.6, 0.8, 'OBV falling — net distribution.');

  if (bbU != null && bbL != null) {
    if (price > bbU) add(-0.4, 0.6, 'Price above upper Bollinger band — stretched.');
    else if (price < bbL) add(+0.4, 0.6, 'Price below lower Bollinger band — stretched to downside.');
  }
  if (brk) {
    if (brk.type === 'breakout') add(+1.2, 1.3, brk.reason);
    else add(-1.2, 1.3, brk.reason);
  }
  if (tri) {
    if (tri.bias === 'bullish') add(+0.6, 0.8, `${tri.type} forming (bullish bias).`);
    else if (tri.bias === 'bearish') add(-0.6, 0.8, `${tri.type} forming (bearish bias).`);
  }
  if (struct.trend === 'uptrend') add(+0.8, 1.0, struct.reason);
  else if (struct.trend === 'downtrend') add(-0.8, 1.0, struct.reason);
  for (const p of dtb) add(p.bias === 'bullish' ? +0.7 : -0.7, 0.9, `${p.type} near ${p.level.toFixed(2)}.`);
  if (gp) add(gp.type === 'Gap Up' ? +0.5 : -0.5, 0.7, `${gp.type}: opened ${gp.pct.toFixed(1)}% vs previous close.`);
  for (const c of candle) {
    if (c.bias === 'bullish') add(+0.4, 0.6, `${c.name} candle today (bullish bias).`);
    else if (c.bias === 'bearish') add(-0.4, 0.6, `${c.name} candle today (bearish bias).`);
  }
  for (const t of traps) {
    if (t.bias === 'bullish') add(+0.6, 0.9, t.reason);
    else if (t.bias === 'bearish') add(-0.6, 0.9, t.reason);
    else add(0, 0, t.reason); // informational risk (false breakout)
  }
  // Relative strength signal
  if (rs) {
    if (rs.outperformance > 1) add(+0.7, 1.0, `Outperforming KSE-100 by ${rs.outperformance.toFixed(1)}% over ${rs.period}d.`);
    else if (rs.outperformance < -1) add(-0.7, 1.0, `Underperforming KSE-100 by ${Math.abs(rs.outperformance).toFixed(1)}% over ${rs.period}d.`);
  }
  // Sector strength signal
  if (sectorStrength) {
    if (sectorStrength.avgChange > 0.3) add(+0.5, 0.8, `Sector "${sectorStrength.name}" strong today (${sectorStrength.avgChange.toFixed(2)}%, ${sectorStrength.breadth.toFixed(0)}% advancing).`);
    else if (sectorStrength.avgChange < -0.3) add(-0.5, 0.8, `Sector "${sectorStrength.name}" weak today (${sectorStrength.avgChange.toFixed(2)}%).`);
  }

  // ---- Aggregate probability ----
  const bullish = signals.filter((s) => s.dir > 0);
  const bearish = signals.filter((s) => s.dir < 0);
  const netScore = signals.reduce((a, s) => a + s.dir * s.weight, 0);
  const bullWeight = bullish.reduce((a, s) => a + s.weight, 0);
  const bearWeight = bearish.reduce((a, s) => a + s.weight, 0);
  const totalWeight = bullWeight + bearWeight;
  const agreement = totalWeight > 0 ? Math.abs(bullWeight - bearWeight) / totalWeight : 0;

  const bullishProbability = toProbability(netScore);
  const bearishProbability = 100 - bullishProbability;
  const direction = bullishProbability >= 55 ? 'long' : bullishProbability <= 45 ? 'short' : 'neutral';

  // ---- Confirmations (relative to direction) ----
  const wantUp = direction === 'long';
  const conf = {
    trendDaily: dailyTrend.dir === (wantUp ? 'up' : 'down'),
    trendWeekly: weeklyTrend.dir === (wantUp ? 'up' : 'down'),
    macd: macdLine != null && macdSignal != null && (wantUp ? macdLine > macdSignal : macdLine < macdSignal),
    rsi: rsiVal != null && (wantUp ? rsiVal >= 50 && rsiVal < 75 : rsiVal <= 50 && rsiVal > 25),
    adx: false, // ADX requires historical high/low data not provided by the source
    volume: (volRatio != null && volRatio >= 1.2) || (wantUp ? obvSlope > 0 : obvSlope < 0),
    breakout: !!brk && (wantUp ? brk.type === 'breakout' : brk.type === 'breakdown'),
    sector: !!sectorStrength && (wantUp ? sectorStrength.avgChange > 0 : sectorStrength.avgChange < 0),
    rs: !!rs && (wantUp ? rs.outperformance > 0 : rs.outperformance < 0),
  };
  const confirmKeys = ['trendDaily', 'trendWeekly', 'macd', 'rsi', 'volume', 'breakout', 'sector', 'rs'];
  const confirmedCount = direction === 'neutral' ? 0 : confirmKeys.filter((k) => conf[k]).length;

  // Major conflict: opposing weights nearly balanced, or a trap opposing direction.
  const opposingTrap = traps.some((t) => (wantUp && t.bias === 'bearish') || (!wantUp && t.bias === 'bullish'));
  const conflict = (bullWeight > 0 && bearWeight > 0 && agreement < 0.25) || opposingTrap || direction === 'neutral';

  // ---- Confidence (hard-capped) ----
  let confidence = confirmedCount >= 7 ? 90 : confirmedCount >= 5 ? 80 : confirmedCount >= 3 ? 70 : 60;
  if (conflict) confidence = Math.min(confidence, 55);
  if (direction === 'neutral') confidence = Math.min(confidence, 50);
  const confidenceTier = confidence >= 90 ? 'Exceptional' : confidence >= 80 ? 'Strong' : confidence >= 70 ? 'Average' : confidence >= 60 ? 'Weak' : 'Very weak / no edge';

  // ---- Support / resistance for plan ----
  const resistanceLevels = collectLevels('up', price, [sr.resistance, hi52, pivots?.r1, pivots?.r2, fib && fib[0.236], fib && fib[0]]);
  const supportLevels = collectLevels('down', price, [sr.support, lo52, pivots?.s1, pivots?.s2, ema50, ema200]);

  // ---- Trade plan & Risk/Reward ----
  const plan = buildPlan({ direction, price, sr, ema50, ema200, volatilityPct, resistanceLevels, supportLevels });

  // ---- Risk analysis ----
  const { riskLevel, risks } = assessRisk({ volatilityPct, avgVol20, traps, gp, brk, volRatio, rs });

  // ---- Entry validation gates ----
  const gates = {
    trendConfirmed: conf.trendDaily,
    momentumConfirmed: conf.macd && conf.rsi,
    volumeConfirmed: conf.volume,
    rrAtLeast2: plan && plan.riskReward != null && plan.riskReward >= 2,
    logicalStop: plan && plan.stopLoss != null && (direction === 'long' ? plan.stopLoss < price : plan.stopLoss > price),
    noMajorConflict: !conflict,
    directional: direction !== 'neutral',
  };
  const setupValid = Object.values(gates).every(Boolean);
  const setup = setupValid
    ? (direction === 'long' ? 'High-Quality Long Setup' : 'High-Quality Short Setup')
    : 'No High-Quality Trade Setup Available.';

  // ---- Trade Quality Score (0-100) ----
  const mtfAligned = dailyTrend.dir === weeklyTrend.dir && dailyTrend.dir !== 'unknown';
  let tradeQuality = 0;
  tradeQuality += (confirmedCount / 8) * 45;
  tradeQuality += (Math.min(plan?.riskReward || 0, 3) / 3) * 20;
  tradeQuality += mtfAligned ? 15 : 0;
  tradeQuality += conflict ? 0 : 10;
  tradeQuality += conf.volume ? 5 : 0;
  tradeQuality += conf.rs ? 3 : 0;
  tradeQuality += conf.sector ? 2 : 0;
  tradeQuality = Math.round(Math.max(0, Math.min(100, tradeQuality)));

  // ---- Final recommendation ----
  const finalRecommendation = decideRecommendation({ setupValid, direction, confidence, bullishProbability, conflict });

  // ---- Reasons / against / invalidation / alternative ----
  const reasons = (direction === 'short' ? bearish : bullish).map((s) => s.reason);
  const reasonsAgainst = (direction === 'short' ? bullish : bearish).map((s) => s.reason);
  if (!gates.rrAtLeast2 && plan) reasonsAgainst.push(`Risk/Reward to first target is ${plan.riskReward ?? '—'} (< 2:1 required for a high-quality setup).`);
  if (!conf.adx) reasonsAgainst.push('ADX trend-strength cannot be confirmed (requires historical high/low data not provided by the source).');

  const invalidationLevel = plan?.stopLoss != null
    ? `${direction === 'short' ? 'Daily close above' : 'Daily close below'} ${plan.stopLoss} invalidates this view.`
    : 'No structural invalidation level — setup not actionable.';

  const alternative = buildAlternative({ direction, sr, conflict });

  // Detected chart / price-action patterns (for the Chart Analyzer view).
  const patterns = [];
  patterns.push({
    name: struct.trend === 'uptrend' ? 'Higher highs & higher lows' : struct.trend === 'downtrend' ? 'Lower highs & lower lows' : 'Sideways / range structure',
    bias: struct.trend === 'uptrend' ? 'bullish' : struct.trend === 'downtrend' ? 'bearish' : 'neutral',
    detail: struct.reason,
  });
  if (brk) patterns.push({ name: brk.type === 'breakout' ? 'Breakout' : 'Breakdown', bias: brk.type === 'breakout' ? 'bullish' : 'bearish', detail: brk.reason });
  if (tri) patterns.push({ name: tri.type, bias: tri.bias, detail: 'Converging trendlines from recent swings.' });
  for (const p of dtb) patterns.push({ name: p.type, bias: p.bias, detail: `Twin turning points near ${p.level.toFixed(2)}.` });
  if (gp) patterns.push({ name: gp.type, bias: gp.type === 'Gap Up' ? 'bullish' : 'bearish', detail: `Opened ${gp.pct.toFixed(1)}% vs previous close.` });
  for (const c of candle) patterns.push({ name: `${c.name} candle`, bias: c.bias, detail: "Today's candle shape." });
  for (const t of traps) patterns.push({ name: t.type, bias: t.bias, detail: t.reason });

  return {
    ok: true, status: 'ok',
    symbol: snapshot?.symbol,
    price,
    patterns,
    trend: { daily: dailyTrend.label, weekly: weeklyTrend.label, monthly: monthlyTrend.label, summary: trendSummary(dailyTrend, weeklyTrend, monthlyTrend) },
    marketStructure,
    sectorStrength: sectorStrength
      ? { label: sectorLabel(sectorStrength.avgChange), detail: `${sectorStrength.name}: ${sectorStrength.avgChange.toFixed(2)}% today, ${sectorStrength.breadth.toFixed(0)}% of ${sectorStrength.count} names advancing.` }
      : { label: 'Unavailable', detail: 'Sector aggregate unavailable from source.' },
    relativeStrength: rs
      ? { label: rs.outperformance >= 0 ? 'Outperforming KSE-100' : 'Underperforming KSE-100', detail: `Stock ${rs.stockReturn.toFixed(1)}% vs KSE-100 ${rs.indexReturn.toFixed(1)}% over ${rs.period}d (${rs.outperformance >= 0 ? '+' : ''}${rs.outperformance.toFixed(1)}%). RS line ${rs.rsRising ? 'rising' : 'falling'}.` }
      : { label: 'Unavailable', detail: 'KSE-100 comparison unavailable from source.' },
    momentum: { summary: momentumSummary({ rsiVal, macdLine, macdSignal, roc10 }), rsi: rsiVal, stochRsiK, macd: macdLine, macdSignal, roc10 },
    volume: { summary: volRatio != null ? `Relative volume ${volRatio.toFixed(2)}x 20-day average; OBV ${obvSlope > 0 ? 'rising' : obvSlope < 0 ? 'falling' : 'flat'}.` : 'Insufficient data to calculate.', relVol: volRatio, obvRising: obvSlope > 0 },
    support: supportLevels[0] ?? null,
    resistance: resistanceLevels[0] ?? null,
    riskLevel,
    risks,
    plan,
    bullishProbability,
    bearishProbability,
    confidence,
    confidenceTier,
    tradeQuality,
    setup,
    setupValid,
    gates,
    confirmations: conf,
    confirmedCount,
    conflict,
    reasons,
    reasonsAgainst,
    alternative,
    invalidationLevel,
    finalRecommendation,
    metrics: {
      ema9, ema20, ema50, ema100, ema200, sma50, sma200,
      rsi: rsiVal, stochRsiK, macd: macdLine, macdSignal,
      bbUpper: bbU, bbLower: bbL, bbMid: bbM, bbWidthPct, roc10,
      obvSlope, volNow, avgVol20, volRatio, volatilityPct,
      hi52, lo52, vwap: intradayVwap,
      vol60: returnVolatility(closes, 60),
      todayChangePct: snapshot?.changePct ?? null,
      support: supportLevels[0] ?? null, resistance: resistanceLevels[0] ?? null,
      fib, pivots,
    },
    unavailable: [
      'ADX, ATR, CCI, Keltner Channels — require historical high/low (true range) data not provided by the PSX EOD source.',
      'CMF, Money Flow Index, Accumulation/Distribution, Volume Profile — require historical high/low data.',
      'Multi-candle candlestick patterns (engulfing, morning/evening star, three soldiers/crows) and Head-and-Shoulders / Cup-and-Handle — require historical OHLC candle data.',
      'Market capitalisation (shares outstanding), and bid/ask spread depth — not provided by the source.',
      'The ≥95% confidence tier is unreachable: it requires ADX confirmation, which the source cannot supply. Maximum honest confidence is 90% (Exceptional).',
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyStructure({ price, ema50, ema200, ema50slope, struct, obvSlope }) {
  const ref = price || 1;
  const flat = Math.abs(ema50slope) / ref < 0.0008;
  if (ema50 != null && ema200 != null && !flat) {
    if (price > ema50 && ema50 > ema200 && ema50slope > 0) return { label: 'Markup (uptrend)', reason: 'Price above a rising EMA50, itself above EMA200.' };
    if (price < ema50 && ema50 < ema200 && ema50slope < 0) return { label: 'Markdown (downtrend)', reason: 'Price below a falling EMA50, itself below EMA200.' };
  }
  if (flat) {
    if (obvSlope > 0) return { label: 'Accumulation', reason: 'Sideways price with rising OBV — net buying into a range.' };
    if (obvSlope < 0) return { label: 'Distribution', reason: 'Sideways price with falling OBV — net selling into a range.' };
    return { label: 'Range Bound', reason: 'Flat moving averages with no clear volume bias.' };
  }
  if (struct.trend === 'uptrend') return { label: 'Trending Up', reason: struct.reason };
  if (struct.trend === 'downtrend') return { label: 'Trending Down', reason: struct.reason };
  return { label: 'Range Bound', reason: struct.reason };
}

/** Collect, filter and order candidate price levels in a direction. */
function collectLevels(dir, price, candidates) {
  const sign = dir === 'up' ? 1 : -1;
  const pts = candidates
    .filter((v) => v != null && sign * (v - price) > 0)
    .sort((a, b) => sign * (a - b));
  const out = [];
  for (const v of pts) if (out.every((u) => Math.abs(u - v) / price > 0.005)) out.push(round(v));
  return out;
}

function buildPlan({ direction, price, sr, ema50, ema200, volatilityPct, resistanceLevels, supportLevels }) {
  if (direction === 'neutral' || price == null) {
    return { note: 'No directional edge — no trade plan generated. Monitoring only.', riskReward: null, stopLoss: null, targets: [] };
  }
  const volFrac = volatilityPct != null ? volatilityPct / 100 : 0.03;
  const stopDist = Math.max(price * volFrac * 1.5, price * 0.02);

  if (direction === 'long') {
    let stop = price - stopDist;
    const structuralStop = supportLevels.find((s) => s < price && price - s <= stopDist * 2.5);
    if (structuralStop != null) stop = structuralStop;
    const risk = price - stop;
    const targets = pickTargets('long', price, risk, resistanceLevels);
    const rr = targets.length ? round((targets[0] - price) / Math.max(risk, 1e-6)) : null;
    return { side: 'Long', entryZone: [round(price * 0.995), round(price * 1.005)], stopLoss: round(stop), targets, riskReward: rr, note: 'Invalidate if price closes below the stop.' };
  }
  let stop = price + stopDist;
  const structuralStop = resistanceLevels.find((r) => r > price && r - price <= stopDist * 2.5);
  if (structuralStop != null) stop = structuralStop;
  const risk = stop - price;
  const targets = pickTargets('short', price, risk, supportLevels);
  const rr = targets.length ? round((price - targets[0]) / Math.max(risk, 1e-6)) : null;
  return { side: 'Short / Exit', entryZone: [round(price * 0.995), round(price * 1.005)], stopLoss: round(stop), targets, riskReward: rr, note: 'Invalidate if price closes above the stop.' };
}

/** Pick 3 ordered, structural-first targets at least 1R away; pad with R-multiples. */
function pickTargets(dir, price, R, structural) {
  const sign = dir === 'long' ? 1 : -1;
  const raw = [...structural, price + sign * R * 2, price + sign * R * 3, price + sign * R * 4.5];
  const pts = raw.filter((v) => v != null && sign * (v - price) >= R).sort((a, b) => sign * (a - b));
  const out = [];
  for (const v of pts) { if (out.every((u) => Math.abs(u - v) / price > 0.005)) out.push(round(v)); if (out.length === 3) break; }
  let mult = 2;
  while (out.length < 3) { out.push(round(price + sign * R * mult)); mult += 1.5; }
  return out.slice(0, 3);
}

function assessRisk({ volatilityPct, avgVol20, traps, gp, brk, volRatio, rs }) {
  const risks = [];
  let score = 0;
  if (volatilityPct != null) {
    if (volatilityPct >= 4) { risks.push(`High volatility: 14-day return σ ≈ ${volatilityPct.toFixed(1)}% (wider stops, larger swings).`); score += 2; }
    else if (volatilityPct <= 1.8) { risks.push(`Low volatility: 14-day return σ ≈ ${volatilityPct.toFixed(1)}%.`); }
  }
  if (avgVol20 != null && avgVol20 < 50000) { risks.push(`Low liquidity: 20-day average volume ≈ ${Math.round(avgVol20).toLocaleString()} shares (slippage / fill risk).`); score += 2; }
  if (gp) { risks.push(`Gap risk: recent ${gp.type} of ${gp.pct.toFixed(1)}% — gaps can fill.`); score += 1; }
  for (const t of traps) { risks.push(`${t.type}: ${t.reason}`); score += 1; }
  if (brk && volRatio != null && volRatio < 1) { risks.push('False-breakout probability elevated (breakout on below-average volume).'); score += 1; }
  if (rs && rs.outperformance < -3) { risks.push(`Relative weakness vs KSE-100 (${rs.outperformance.toFixed(1)}% underperformance).`); score += 1; }
  risks.push('Bid/ask spread & order-book depth: data unavailable from source.');
  const riskLevel = score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';
  return { riskLevel, risks };
}

function decideRecommendation({ setupValid, direction, confidence, bullishProbability, conflict }) {
  if (setupValid && direction === 'long') return confidence >= 80 ? 'Strong Buy' : 'Buy';
  if (setupValid && direction === 'short') return confidence >= 80 ? 'Strong Sell' : 'Avoid';
  if (conflict) return 'Watch';
  if (direction === 'long' && bullishProbability >= 58) return 'Watch';
  if (direction === 'short' && bullishProbability <= 42) return 'Avoid';
  return 'Hold';
}

function trendSummary(d, w, m) {
  const labels = [d.label, w.label, m.label];
  const ups = labels.filter((l) => l === 'Bullish' || l === 'Up').length;
  const downs = labels.filter((l) => l === 'Bearish' || l === 'Down').length;
  if (ups >= 2 && downs === 0) return 'Aligned bullish across timeframes.';
  if (downs >= 2 && ups === 0) return 'Aligned bearish across timeframes.';
  return 'Mixed across timeframes — no clean multi-timeframe alignment.';
}
function momentumSummary({ rsiVal, macdLine, macdSignal, roc10 }) {
  const parts = [];
  if (rsiVal != null) parts.push(`RSI ${rsiVal.toFixed(0)}`);
  if (macdLine != null && macdSignal != null) parts.push(`MACD ${macdLine > macdSignal ? 'bullish' : 'bearish'}`);
  if (roc10 != null) parts.push(`ROC ${roc10 >= 0 ? '+' : ''}${roc10.toFixed(1)}%`);
  return parts.length ? parts.join(', ') + '.' : 'Insufficient data to calculate.';
}
function sectorLabel(avg) { return avg > 0.3 ? 'Strong' : avg < -0.3 ? 'Weak' : 'Neutral'; }

/**
 * A 0–100 "opportunity" score for ranking forward-looking long candidates.
 * Blends trade quality, bullish probability, confidence; rewards a validated
 * setup and relative strength; penalises conflict. NOT a prediction — a ranking.
 */
export function opportunityScore(a) {
  if (!a || !a.ok) return 0;
  let s = a.tradeQuality * 0.5 + a.bullishProbability * 0.3 + a.confidence * 0.2;
  if (a.setupValid && /Buy/.test(a.finalRecommendation)) s += 15;
  if (/Outperforming/.test(a.relativeStrength?.label || '')) s += 5;
  if (a.conflict) s -= 15;
  if (a.bullishProbability < 50) s -= 20;
  return Math.round(Math.max(0, Math.min(100, s)));
}

/**
 * Turn a full analysis into a plain-language explanation a beginner can follow:
 * tier, a one-line headline, simple "why it looks good", "what to watch", and a
 * concrete "what to do" line. Honest and probability-based — never a promise.
 */
export function plainExplain(a) {
  if (!a || !a.ok) return { tier: 'No data', tierTone: 'neutral', headline: 'Insufficient data to calculate.', why: [], watch: [], action: 'Not enough history from source to assess.' };

  const why = [];
  if ((a.trend.daily === 'Bullish') && (a.trend.weekly === 'Bullish')) why.push('Uptrend on both the daily and weekly charts.');
  else if (a.trend.daily === 'Bullish') why.push('Uptrend on the daily chart.');
  if (/Outperforming/.test(a.relativeStrength.label)) why.push('Stronger than the KSE-100 index (relative strength).');
  if (a.confirmations.macd) why.push('Momentum is positive (MACD above its signal).');
  if (a.confirmations.rsi) why.push('RSI momentum supports the move.');
  if (a.confirmations.volume) why.push('Backed by above-average buying volume.');
  if (a.confirmations.breakout) why.push('Has broken above recent resistance.');
  if (a.confirmations.sector) why.push('Its sector is strong today.');
  if (/Markup/.test(a.marketStructure.label)) why.push('Price is in a clear up-phase (markup).');

  const watch = [];
  if (!a.gates.rrAtLeast2) watch.push('Reward-to-risk to the next resistance is under 2:1 — a dip would give a better entry.');
  if (/Underperforming/.test(a.relativeStrength.label)) watch.push('Lagging the KSE-100 index.');
  if (a.riskLevel === 'High') watch.push('Higher volatility — use a smaller position size.');
  if (a.conflict) watch.push('Some signals disagree — wait for confirmation.');
  (a.risks || []).filter((r) => /Trap|False-breakout|Low liquidity|Gap risk/i.test(r)).slice(0, 1).forEach((r) => watch.push(r));

  let tier = '🟡 Building'; let tierTone = 'neutral';
  if (a.setupValid && /Buy/.test(a.finalRecommendation)) { tier = '✅ High-Quality Setup'; tierTone = 'buy'; }
  else if (a.bullishProbability >= 62 && a.confidence >= 70) { tier = '👀 Strong — Watch'; tierTone = 'buy'; }

  let action;
  if (a.setupValid && a.stage?.stage === 2) {
    action = 'Actionable now — use the Buy Range, Stop and Targets below. Size the position so the stop is an acceptable loss.';
  } else {
    action = 'Watch only — act only if price reaches the Buy Range below (wait for the dip or a confirmed breakout on strong volume). Do not chase.';
  }

  return {
    tier, tierTone,
    headline: `${a.bullishProbability}% bullish · ${a.confidence}% confidence · ${a.riskLevel} risk`,
    why: why.slice(0, 4),
    watch: watch.slice(0, 3),
    action,
  };
}

function buildAlternative({ direction, sr, conflict }) {
  if (conflict) return 'Alternative scenario: signals conflict. A decisive close beyond the nearest support or resistance on above-average volume is needed before this becomes actionable.';
  if (direction === 'long') {
    const lvl = sr.support != null ? sr.support.toFixed(2) : 'nearest support';
    return `Alternative scenario: a daily close below ${lvl} on rising volume invalidates the bullish thesis and opens downside risk.`;
  }
  if (direction === 'short') {
    const lvl = sr.resistance != null ? sr.resistance.toFixed(2) : 'nearest resistance';
    return `Alternative scenario: a daily close above ${lvl} on strong volume invalidates the bearish thesis and a recovery becomes likely.`;
  }
  return 'Alternative scenario: a decisive break of the current range resolves direction.';
}
