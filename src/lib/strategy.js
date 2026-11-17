/**
 * strategy.js — the "veteran trader" decision layer on top of the analysis.
 * ------------------------------------------------------------------------
 * A disciplined swing/position trader does not act on indicators alone. They
 * filter top-down:
 *
 *   1) MARKET REGIME  — Is the broad market (KSE-100) in an uptrend? In a
 *      downtrend ("Risk-Off") most long setups fail; capital preservation wins.
 *   2) STAGE ANALYSIS — Weinstein's 4 stages. Only Stage 2 (advancing/markup)
 *      is a place to buy. Stage 4 (declining) is to be avoided. Stage 1 (base)
 *      and Stage 3 (top) are watch-only.
 *   3) SETUP QUALITY  — Name the actual textbook setup (pullback-in-uptrend,
 *      breakout-with-volume, oversold-bounce…). No setup => no trade.
 *   4) CONVICTION     — Combine the above with the engine's evidence into a
 *      single 0–100 conviction and a plain trader's call.
 *
 * Nothing here predicts the future or guarantees profit. It encodes a
 * rules-based process so the trader understands WHY a pick is (or isn't) a buy.
 */

import { sma, slope } from './indicators.js';
import { opportunityScore } from './aiEngine.js';

/** Broad-market regime from the KSE-100 daily closes. */
export function marketRegime(indexCloses) {
  if (!indexCloses || indexCloses.length < 200) {
    return { state: 'Unknown', bias: 0, detail: 'Insufficient KSE-100 history to judge the market regime.' };
  }
  const s50 = sma(indexCloses, 50);
  const s200 = sma(indexCloses, 200);
  const m50 = s50[s50.length - 1];
  const m200 = s200[s200.length - 1];
  const price = indexCloses[indexCloses.length - 1];
  const slope50 = slope(s50.filter((v) => v != null).slice(-20)) || 0;
  const above200 = price > m200;
  const golden = m50 > m200;
  if (above200 && golden && slope50 > 0) {
    return { state: 'Risk-On', bias: 1, detail: 'KSE-100 is above a rising 200-day average with a golden-cross structure — broad uptrend. Favourable for longs.' };
  }
  if (!above200 && !golden) {
    return { state: 'Risk-Off', bias: -1, detail: 'KSE-100 is below its 200-day average with a death-cross structure — broad downtrend. Longs are higher-risk; preserve capital.' };
  }
  return { state: 'Neutral', bias: 0, detail: 'KSE-100 trend is mixed. Be selective — trade only the strongest leaders.' };
}

/** Weinstein-style stage of a single stock from its daily closes. */
export function stageAnalysis(closes) {
  const period = 150; // ~30 weeks
  if (closes.length < period + 20) {
    return { stage: 0, label: 'Stage —', advice: 'Insufficient history (~30 weeks) for stage analysis.' };
  }
  const maArr = sma(closes, period);
  const ma = maArr[maArr.length - 1];
  const maSlope = slope(maArr.filter((v) => v != null).slice(-20)) || 0;
  const price = closes[closes.length - 1];
  const flat = Math.abs(maSlope) / (price || 1) < 0.0006;
  const above = price > ma;
  if (above && maSlope > 0 && !flat) return { stage: 2, label: 'Stage 2 — Advancing (Markup)', advice: 'Uptrend phase — the only stage to look for fresh longs.' };
  if (!above && maSlope < 0 && !flat) return { stage: 4, label: 'Stage 4 — Declining (Markdown)', advice: 'Downtrend — avoid longs; protect capital.' };
  if (flat && above) return { stage: 3, label: 'Stage 3 — Topping', advice: 'Momentum fading near highs — tighten stops, avoid new longs.' };
  return { stage: 1, label: 'Stage 1 — Basing', advice: 'Building a base — wait for a Stage 2 breakout before buying.' };
}

/** Identify the textbook setup (if any) from the engine's metrics. */
export function classifySetup({ closes, price, ema50, ema200, rsi, relVol, breakoutUp, trendUp }) {
  if (!closes || closes.length < 60) return { type: 'Insufficient data', quality: 0, note: '' };
  const recentHigh = Math.max(...closes.slice(-20));
  const pullbackPct = recentHigh > 0 ? ((recentHigh - price) / recentHigh) * 100 : 0;

  if (breakoutUp && relVol != null && relVol >= 1.2) {
    return { type: 'Breakout with volume', quality: 90, note: 'Closed above its recent range on above-average volume — a momentum entry.' };
  }
  if (trendUp && ema50 != null && price >= ema50 && rsi != null && rsi >= 40 && rsi <= 58 && pullbackPct >= 2 && pullbackPct <= 10) {
    return { type: 'Pullback in uptrend', quality: 88, note: 'A healthy dip to support inside an uptrend — the most favourable risk/reward entry.' };
  }
  if (ema200 != null && price > ema200 && rsi != null && rsi <= 35) {
    return { type: 'Oversold bounce (uptrend)', quality: 68, note: 'Stretched to the downside but within a long-term uptrend — a mean-reversion bounce.' };
  }
  if (trendUp && rsi != null && rsi > 58 && pullbackPct < 2) {
    return { type: 'Momentum continuation (extended)', quality: 60, note: 'Strong trend but no pullback — chasing here is poor risk; wait for a dip.' };
  }
  return { type: 'No clean setup', quality: 30, note: 'No textbook entry pattern is present right now.' };
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Investment-horizon planning: match a stock (and market stance) to the time
// frame the user wants to invest for. Short horizons lean on daily/weekly
// trend + Stage 2; long horizons require a durable long-term uptrend (above the
// 200-day average, golden cross, leadership). Stage 4 downtrends are excluded.
// ---------------------------------------------------------------------------

export const HORIZON_META = {
  '1M': { label: '1 Month', sub: 'short-term swing', hold: 'days to a few weeks', exit: 'Exit on a close below your stop / EMA20.', basis: 'daily uptrend + Stage 2 + momentum' },
  '3M': { label: '3 Months', sub: 'position trade', hold: '1–3 months', exit: 'Exit if the weekly trend breaks (close below EMA50).', basis: 'weekly + daily uptrend aligned' },
  '6M': { label: '6 Months', sub: 'medium–long', hold: '3–6 months', exit: 'Trail up; exit on a close below the 200-day average.', basis: 'above 200-day MA + weekly/monthly up' },
  '1Y': { label: '1 Year', sub: 'long-term', hold: '6–12 months', exit: 'Hold while above the 200-day average; review each quarter.', basis: 'long-term uptrend + golden cross + market leadership' },
};

export function horizonFit(a, horizon) {
  if (!a || !a.ok || a.stage?.stage === 4 || a.bullishProbability < 55) return { ok: false, score: 0, why: [] };
  const m = a.metrics || {};
  const price = a.price;
  const daily = a.trend.daily === 'Bullish';
  const weekly = a.trend.weekly === 'Bullish';
  const monthly = a.trend.monthly === 'Bullish';
  const aboveEMA200 = m.ema200 != null && price > m.ema200;
  const golden = m.sma50 != null && m.sma200 != null && m.sma50 > m.sma200;
  const rsOut = /Outperforming/.test(a.relativeStrength?.label || '');
  const why = [];
  let ok = false;
  if (horizon === '1M') { ok = daily && a.stage?.stage === 2; if (daily) why.push('Daily uptrend'); if (a.stage?.stage === 2) why.push('Stage 2 (markup)'); }
  else if (horizon === '3M') { ok = weekly && daily; if (weekly) why.push('Weekly uptrend'); if (daily) why.push('Daily aligned up'); }
  else if (horizon === '6M') { ok = aboveEMA200 && (weekly || monthly); if (aboveEMA200) why.push('Above 200-day (long-term up)'); if (weekly) why.push('Weekly uptrend'); }
  else { ok = aboveEMA200 && golden && (monthly || weekly); if (aboveEMA200) why.push('Above 200-day average'); if (golden) why.push('Golden cross (SMA50 > SMA200)'); if (monthly) why.push('Monthly uptrend'); }
  if (rsOut) why.push('Leader — beating the KSE-100');
  let score = a.conviction * 0.45 + a.bullishProbability * 0.25 + (rsOut ? 10 : 0) + (aboveEMA200 ? 8 : 0) + (golden ? 6 : 0) + (monthly ? 6 : 0);
  score = Math.round(Math.max(0, Math.min(100, score)));
  return { ok, score, why };
}

/**
 * Buy-the-dip TURN signal — the exact moment to act: a stock in a long-term
 * uptrend whose pullback has RESUMED upward (momentum turned back up) while it
 * is still near its EMA20 (a dip entry, not chasing) and not overbought.
 * This is "buy when the dip stops and turns", not "catch a falling knife".
 */
export function buyTurnSignal(a) {
  if (!a || !a.ok || a.stage?.stage === 4 || a.bullishProbability < 58) return { ok: false, reasons: [] };
  const m = a.metrics || {};
  const price = a.price;
  const uptrend = m.ema200 != null && price > m.ema200; // long-term up
  const stage2 = a.stage?.stage === 2;
  const macdUp = m.macd != null && m.macdSignal != null && m.macd > m.macdSignal;
  const rsiOk = m.rsi != null && m.rsi >= 48 && m.rsi <= 66; // recovering, not overbought
  const notExtended = m.ema20 != null && price <= m.ema20 * 1.04; // near EMA20 — a dip, not stretched
  // The dip must have actually STOPPED falling — do NOT call a buy on a sharp
  // down day (that is still a falling knife, not a turn).
  const today = m.todayChangePct;
  const turnedUp = today == null || today >= -0.5; // flat-to-green = stabilised/turning
  // Quality gates: the trade must have a worthwhile reward-to-risk AND enough
  // liquidity to actually enter/exit. A "turn" alone is not enough.
  const rr = a.levels?.riskReward;
  const goodRR = rr == null || rr >= 1.5;
  const liquid = m.avgVol20 == null || m.avgVol20 >= 50000;
  const reasons = [];
  const ok = uptrend && macdUp && rsiOk && notExtended && turnedUp && goodRR && liquid;
  if (uptrend) reasons.push('Long-term uptrend intact (above 200-day)');
  if (today != null && today > 0.5) reasons.push(`Turning up today (+${today.toFixed(1)}%) after the dip`);
  else reasons.push('Pullback has stabilised near EMA20 (uptrend intact)');
  if (macdUp) reasons.push('Momentum positive (MACD above its signal)');
  if (rsiOk) reasons.push(`RSI healthy (${m.rsi != null ? m.rsi.toFixed(0) : '—'})`);
  if (notExtended) reasons.push('Near EMA20 — a dip entry, not chasing');
  if (/Outperforming/.test(a.relativeStrength?.label || '')) reasons.push('Leader — beating the KSE-100');
  const cautions = [];
  if (a.stage?.stage === 3) cautions.push('Late-stage uptrend (Stage 3 — topping): the run is mature, so this is higher-risk than an early-uptrend dip. Use a tighter stop and smaller size.');
  if (rr != null && rr < 2) cautions.push(`Reward-to-risk to the first target is only ${rr}:1 (below the ideal 2:1) — the upside is modest versus the risk.`);
  if (m.avgVol20 != null && m.avgVol20 < 150000) cautions.push(`Thinly traded (20-day avg ${Math.round(m.avgVol20).toLocaleString()} shares) — expect slippage; keep size small.`);
  return { ok, reasons, caution: cautions.join(' ') || null, strength: a.conviction };
}

/**
 * Portfolio holding advice — given the live analysis + your average cost, what
 * to do with a position you already hold: Hold / Add-on-dips / Trim / Reduce-Exit,
 * with a suggested stop and the reason. Honest and risk-first.
 */
export function holdingStrategy(a, avgCost, price) {
  const plPct = avgCost > 0 ? ((price - avgCost) / avgCost) * 100 : 0;
  if (!a || !a.ok) return { action: '—', tone: 'neutral', reason: 'Insufficient data from source.', stop: null, plPct };
  const m = a.metrics || {};
  const stop = a.levels?.stopLoss ?? (m.support != null ? Math.round(m.support * 0.99 * 100) / 100 : Math.round(price * 0.92 * 100) / 100);
  const st = a.stage?.stage;

  if (st === 4 || a.bullishProbability < 40) {
    return { action: 'REDUCE / EXIT', tone: 'sell', stop, reason: `Stage-4 / bearish downtrend (${a.bullishProbability}% bullish). Odds favour more downside than a quick recovery. Cut it, or hold ONLY with a hard stop (~${stop}) and exit on any bounce. Do not average down.` };
  }
  if (st === 2 && a.traderCallTone === 'buy') {
    const t = a.levels?.targets?.[0]?.price;
    return { action: 'HOLD / add on dips', tone: 'buy', stop, reason: `Stage-2 uptrend (${a.bullishProbability}% bullish). Ride it — trail your stop up (~${stop})${t ? `, book partial near ${t}` : ''}. Add only on dips to support, not by chasing.` };
  }
  if (st === 3) {
    return { action: 'HOLD — trail stop, no add', tone: 'neutral', stop, reason: `Stage-3 (topping) — mature uptrend, higher risk. Hold with a tighter trailing stop (~${stop}); do NOT add here; book partial into strength.` };
  }
  return { action: 'HOLD — watch', tone: 'neutral', stop, reason: `Mixed / no clear edge (${a.bullishProbability}% bullish). Hold with a stop (~${stop}); reduce if it closes below support.` };
}

/** Plain market-strategy stance for the chosen horizon, from the KSE-100 regime. */
export function marketStance(regime, horizon) {
  const long = horizon === '6M' || horizon === '1Y';
  if (!regime || regime.state === 'Unknown') return 'Market trend unclear — be selective and keep more cash.';
  if (regime.bias > 0) {
    return long
      ? 'Risk-On uptrend — favourable to build and hold long-term positions. Staying mostly invested (~70–80%) is reasonable while the index trend holds; add on dips.'
      : 'Risk-On — good backdrop for active swing trades. Trade the leaders and keep a cash buffer.';
  }
  if (regime.bias < 0) {
    return 'Risk-Off downtrend — defensive. Keep mostly cash (~70%+), avoid fresh longs, and wait for the KSE-100 to reclaim its trend before committing.';
  }
  return 'Neutral / mixed market — be selective. About half invested in only the strongest leaders; keep the rest in cash.';
}

/**
 * Setup-aware trade levels — ALWAYS produced so the user knows exactly where to
 * buy, where the stop is, and where the targets are.
 *
 *  - Pullback / oversold / non-Stage-2 setups -> buy zone sits near SUPPORT
 *    (you wait for the dip), giving a tighter stop and better reward/risk.
 *  - Breakout / momentum / Stage-2 validated -> buy zone is at/just above the
 *    current price (you act with the breakout).
 *
 * Stop is placed below the buy zone (structurally below support where possible).
 * Targets are real resistance levels (swing, pivots, Fibonacci, 52w) at least
 * 1R away, ordered and de-duplicated, padded with risk multiples. R:R is to TP1.
 */
export function computeTradeLevels(a) {
  const price = a.price;
  if (price == null) return null;
  const m = a.metrics || {};
  const support = a.support;
  const resistance = a.resistance;
  const volFrac = m.volatilityPct != null ? m.volatilityPct / 100 : 0.03;
  const stopDist = Math.max(price * volFrac * 1.5, price * 0.02);

  // Real resistance levels above price (each tagged with its source from the
  // stock's actual history) — these are the primary targets.
  const resCandidates = [
    resistance != null ? { value: resistance, source: 'swing resistance' } : null,
    m.pivots?.r1 != null ? { value: m.pivots.r1, source: 'pivot R1' } : null,
    m.pivots?.r2 != null ? { value: m.pivots.r2, source: 'pivot R2' } : null,
    m.hi52 != null ? { value: m.hi52, source: '52-week high' } : null,
    m.fib?.[0.236] != null ? { value: m.fib[0.236], source: 'Fib 23.6%' } : null,
  ].filter((c) => c && c.value > price);

  const setupType = a.setupType || '';
  const waitForDip = /Pullback|Oversold|extended/i.test(setupType) || (a.stage && a.stage.stage !== 2);

  let buyLow; let buyHigh; let basis;
  if (waitForDip && support != null && support < price) {
    buyLow = support; buyHigh = round2(support * 1.012); basis = 'Buy the dip into support';
  } else if (/Breakout/i.test(setupType)) {
    buyLow = round2(price * 0.998); buyHigh = round2(price * 1.01); basis = 'Buy with the breakout / at market';
  } else if (waitForDip) {
    buyLow = round2(price * 0.97); buyHigh = round2(price * 0.995); basis = 'Wait for a minor dip';
  } else {
    buyLow = round2(price * 0.995); buyHigh = round2(price * 1.005); basis = 'Buy near current price';
  }
  const entry = (buyLow + buyHigh) / 2;

  let stop = buyLow - stopDist;
  let stopBasis = 'volatility-based (below buy zone)';
  if (support != null && support < buyLow && buyLow - support <= stopDist * 2) { stop = support * 0.99; stopBasis = 'just below swing support'; }
  const risk = entry - stop;
  if (risk <= 0) return null;

  // Targets: real resistance levels first (≥1R away), then risk-based projections.
  const candidates = [
    ...resCandidates.filter((c) => c.value >= entry + risk),
    { value: entry + risk * 2, source: '2R projection' },
    { value: entry + risk * 3, source: '3R projection' },
    { value: entry + risk * 4.5, source: '4.5R projection' },
  ].sort((x, y) => x.value - y.value);

  const targets = [];
  for (const c of candidates) {
    if (targets.every((t) => Math.abs(t.price - c.value) / entry > 0.006)) targets.push({ price: round2(c.value), source: c.source });
    if (targets.length === 3) break;
  }
  const riskReward = round2((targets[0].price - entry) / risk);

  return { buyZone: [round2(buyLow), round2(buyHigh)], stopLoss: round2(stop), stopBasis, targets, riskReward, basis };
}

/**
 * Combine regime + stage + setup + the engine's evidence into a single
 * conviction (0–100) and a plain trader's call.
 */
export function applyStrategy(a, closes, regime) {
  const stage = stageAnalysis(closes);
  const m = a.metrics || {};
  const trendUp = a.trend?.daily === 'Bullish';
  const breakoutUp = !!a.confirmations?.breakout && a.bullishProbability >= 50;
  const setup = classifySetup({
    closes, price: a.price, ema50: m.ema50, ema200: m.ema200, rsi: m.rsi, relVol: m.volRatio, breakoutUp, trendUp,
  });

  let c = opportunityScore(a);
  if (regime.bias > 0) c += 6; else if (regime.bias < 0) c -= 25;
  if (stage.stage === 2) c += 8; else if (stage.stage === 4) c -= 30; else if (stage.stage === 3) c -= 8; else if (stage.stage === 1) c -= 4;
  c += (setup.quality - 50) * 0.3;
  const conviction = Math.round(Math.max(0, Math.min(100, c)));

  const notes = [];
  notes.push(`Market regime: ${regime.state}. ${regime.detail}`);
  notes.push(`${stage.label}. ${stage.advice}`);
  if (setup.note) notes.push(`Setup — ${setup.type}: ${setup.note}`);

  let traderCall = 'Pass — no edge';
  let traderCallTone = 'neutral';
  if (stage.stage === 4 || regime.bias < 0 && conviction < 62) {
    traderCall = stage.stage === 4 ? 'Avoid — downtrend (Stage 4)' : 'Stand aside — Risk-Off market';
    traderCallTone = 'sell';
  } else if (stage.stage === 2 && a.setupValid && conviction >= 75) {
    traderCall = 'Buy — A-grade setup';
    traderCallTone = 'buy';
  } else if (stage.stage === 2 && conviction >= 65) {
    traderCall = 'Accumulate on strength / dips';
    traderCallTone = 'buy';
  } else if (conviction >= 60) {
    traderCall = 'Watch — wait for the trigger';
    traderCallTone = 'neutral';
  }

  // A long trade plan is only produced for genuine LONG candidates. For
  // bearish / Stage-4 / "avoid" names we do NOT show a buy plan — presenting
  // one would contradict the recommendation and could mislead the user.
  const longWorthy = a.bullishProbability >= 50 && stage.stage !== 4 && traderCallTone !== 'sell';
  const levels = longWorthy ? computeTradeLevels({ ...a, setupType: setup.type, stage }) : null;
  const noLevelsReason = longWorthy ? null
    : (stage.stage === 4 ? 'No long trade plan — this is a Stage 4 downtrend. Capital preservation; avoid longs.'
      : a.bullishProbability < 50 ? 'No long trade plan — the balance of evidence is bearish. Stand aside.'
        : 'No long trade plan — not a long candidate right now.');

  return {
    marketRegime: regime,
    stage,
    setupType: setup.type,
    setupNote: setup.note,
    conviction,
    traderCall,
    traderCallTone,
    traderNotes: notes,
    levels,
    noLevelsReason,
  };
}
