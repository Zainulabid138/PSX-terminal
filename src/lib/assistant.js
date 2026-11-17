/**
 * assistant.js
 * ------------
 * A transparent, local (no external LLM) chat assistant that guides the user
 * per share. It answers strictly from REAL analysis (the same institutional
 * engine + veteran-trader strategy layer used everywhere else), never invents
 * data, and always explains its reasoning. Understands English and common
 * Roman-Urdu phrasing.
 *
 * Intents:
 *   - Analyze / should I buy <SYMBOL> / <SYMBOL> ka kya haal / kahan lein
 *   - Best / top / strong shares to buy (conviction-ranked mini scan)
 *   - Find breakout / oversold / overbought / momentum / high-volume stocks
 *   - Explain <indicator / term>
 */

const GLOSSARY = {
  rsi: 'RSI (Relative Strength Index) — momentum 0–100 over 14 periods. >70 overbought, <30 oversold. A gauge, not a guarantee of reversal.',
  macd: 'MACD — difference of 12- & 26-period EMAs with a 9-period signal line. MACD above signal = strengthening upside momentum; below = weakening.',
  ema: 'EMA (Exponential Moving Average) — average that weights recent prices more. EMA20 > EMA50 is a common bullish trend signal.',
  bollinger: 'Bollinger Bands — a 20-period average with ±2 standard-deviation bands. Price at the upper band is stretched up; lower band stretched down.',
  obv: 'OBV (On-Balance Volume) — adds volume on up days, subtracts on down days. Rising OBV = accumulation; falling = distribution.',
  vwap: 'VWAP — volume-weighted average price of the session. Above VWAP = intraday strength; below = weakness.',
  stochastic: 'Stochastic RSI — the stochastic oscillator applied to RSI (0–100). Extreme lows/highs flag oversold/overbought momentum.',
  atr: 'ATR (Average True Range) — volatility from high-low-close. NOTE: the PSX EOD source has no historical high/low, so ATR is "unavailable"; a close-return volatility measure is used for stops instead.',
  stage: 'Stage Analysis (Weinstein) — Stage 1 base, Stage 2 advancing (buy zone), Stage 3 topping, Stage 4 declining (avoid). We only look for longs in Stage 2.',
  conviction: 'Conviction (0–100) — combines market regime + stock stage + setup quality + the evidence into one ranking. Not a prediction; a way to compare setups.',
  regime: 'Market regime — the broad KSE-100 trend. Risk-On (uptrend) favours longs; Risk-Off (downtrend) means stand aside / preserve capital.',
  rr: 'Risk:Reward — reward to the first target divided by the risk to the stop. We require at least 2:1 for a high-quality long setup.',
};

function findSymbol(text, knownSymbols) {
  const upper = ` ${text.toUpperCase()} `;
  for (const s of knownSymbols) {
    if (new RegExp(`[^A-Z0-9]${s}[^A-Z0-9]`).test(upper)) return s;
  }
  return null;
}

const has = (t, re) => re.test(t);

// Follow-up phrasing that refers to the previously discussed stock ("this / yeh / it").
const FOLLOWUP = /\b(this|that|it|yeh|ye|isko|ise|isay|iska|is stock|is share|usko|us ?ko)\b/;
// Direct "should I buy / lelun / kharidun" style questions.
const BUYQ = /should i buy|would i buy|buy this|worth buying|is it (good|worth)|acha hai|le ?l(u|oo)n|lelun|lena chahi|khar[ie]d|is it a buy|buy kar/;
// Bare focused follow-ups.
const BARE = /^(buy|sell|stop|stop ?loss|target|targets?|entry|kahan lein|kahan le|kya karun|kya karoon)\??$/;
// Questions about a specific level of the current stock.
const FOCUS = /\b(stop ?loss|stop|targets?|entry|buy ?range|risk ?reward|r:r|kahan|kitne|kitna)\b/;

/**
 * Answer a question.
 * @param {string} text
 * @param {object} ctx - { rows, knownSymbols, getAnalysis(symbol), lastSymbol }
 */
export async function answer(text, ctx) {
  const q = text.trim();
  const lower = q.toLowerCase();
  if (!q) return { kind: 'text', text: 'Ask me about any PSX stock — e.g. "Should I buy HUBC?", "OGDC ka kya haal hai", "Where to buy MARI", or "best shares to buy today". I analyze real data only and explain the reasoning.' };

  const explainish = has(lower, /explain|what is|matlab|kya h(ai|ota)/);
  // Explain an indicator / term (only when a known term is present).
  if (explainish) {
    for (const key of Object.keys(GLOSSARY)) if (lower.includes(key)) return { kind: 'text', text: GLOSSARY[key] };
    // otherwise fall through — it may be a follow-up like "what is the stop".
  }

  // Best / top / strong picks to buy (conviction-ranked)
  if (has(lower, /best|top pick|top share|strong (share|stock)|kya l(e|ai)|kya khar|achi shar|behtar shar|buy today|aaj kya|kaunsi? shar/)
      && !findSymbol(q, ctx.knownSymbols)) {
    return await topPicks(ctx);
  }

  // Screeners
  if (has(lower, /breakout/)) return await screen(ctx, 'breakout', 'Stocks breaking above their recent range with a bullish tilt');
  if (has(lower, /oversold/)) return await screen(ctx, 'oversold', 'Oversold stocks (RSI ≤ 35) — potential bounce candidates');
  if (has(lower, /overbought/)) return await screen(ctx, 'overbought', 'Overbought stocks (RSI ≥ 70) — stretched to the upside');
  if (has(lower, /momentum/)) return await screen(ctx, 'momentum', 'Strongest positive-momentum stocks');
  if (has(lower, /high volume|most active|volume/)) return await screen(ctx, 'volume', 'Stocks trading well above average volume');

  // Specific symbol guidance — explicit symbol, OR a follow-up about the last one.
  let sym = findSymbol(q, ctx.knownSymbols);
  const isFollowup = !sym && ctx.lastSymbol && (FOLLOWUP.test(lower) || BUYQ.test(lower) || BARE.test(lower) || FOCUS.test(lower));
  if (isFollowup) sym = ctx.lastSymbol;

  if (sym) {
    const a = await ctx.getAnalysis(sym);
    if (!a) return { kind: 'text', text: `Data unavailable from source for ${sym}.` };
    if (!a.ok) return { kind: 'text', text: `${sym}: ${a.message}${a.detail ? ` — ${a.detail}` : ''}` };
    // For a direct yes/no buy question, lead with a plain verdict.
    const prefix = (BUYQ.test(lower) || BARE.test(lower)) ? `Short answer for ${sym}: ${directVerdict(a)}\n\n` : '';
    return { kind: 'analysis', symbol: sym, text: prefix + guideForSymbol(sym, a), analysis: a };
  }

  // If it looked like an explain request but no term matched, offer the menu.
  if (explainish) return { kind: 'text', text: 'I can explain: RSI, MACD, EMA, Bollinger, OBV, VWAP, Stochastic, ATR, Stage, Conviction, Regime, R:R. Which one? (Or ask about a stock, e.g. "what is the stop for OGDC".)' };

  return {
    kind: 'text',
    text: 'I could not find a PSX symbol in that. Name a stock (e.g. "Should I buy HUBC"), or ask a follow-up like "would I buy this" right after analyzing one. You can also try "best shares to buy" or "explain MACD".',
  };
}

/** One-line plain verdict for "should I buy this?" style questions. */
function directVerdict(a) {
  const call = a.traderCall || a.finalRecommendation || '';
  if (a.traderCallTone === 'sell') return `No — ${call}. This is not a long; preserve capital.`;
  if (/A-grade/.test(call)) return 'Yes — an A-grade long setup. Buy inside the range below and honour the stop.';
  if (/Accumulate/.test(call)) return 'You can accumulate — but only on dips inside the buy range below; do not chase.';
  if (/Watch/.test(call)) return 'Not yet — wait for the trigger. Buy only if price reaches the buy range below.';
  return 'No clear edge right now — better to wait than to force a trade.';
}

/** Full trader-style guidance for one share, using regime + stage + setup + levels. */
function guideForSymbol(sym, a) {
  const L = [];
  L.push(`${sym} — ${a.traderCall || a.finalRecommendation}   (Conviction ${a.conviction ?? '—'}/100)`);
  if (a.marketRegime) L.push(`Market: ${a.marketRegime.state}  ·  ${a.stage?.label || ''}  ·  Setup: ${a.setupType || '—'}`);
  L.push(`Bullish ${a.bullishProbability}% / Bearish ${a.bearishProbability}%  ·  Confidence ${a.confidence}%  ·  Risk ${a.riskLevel}`);
  L.push(`Trend D/W/M: ${a.trend.daily} / ${a.trend.weekly} / ${a.trend.monthly}  ·  ${a.relativeStrength.label}`);
  L.push('');

  // The plan — the part the user most wants: where to buy, stop, targets.
  if (a.levels) {
    const p = a.levels;
    const status = a.setupValid && a.stage?.stage === 2 ? 'Actionable now' : 'Watch — act only inside the buy range';
    L.push(`📋 Plan (${status}):`);
    L.push(`• Buy range: ${p.buyZone[0]} – ${p.buyZone[1]}  (${p.basis})`);
    L.push(`• Stop loss: ${p.stopLoss}  (${p.stopBasis})`);
    L.push(`• Target 1: ${p.targets[0].price}  (${p.targets[0].source})`);
    L.push(`• Target 2: ${p.targets[1].price}  (${p.targets[1].source})`);
    L.push(`• Target 3: ${p.targets[2].price}  (${p.targets[2].source})`);
    L.push(`• Risk:Reward: ${p.riskReward} : 1`);
  } else {
    L.push(`⛔ ${a.noLevelsReason || 'No long trade plan right now.'}`);
  }
  L.push('');

  if (a.reasons?.length) { L.push('Reasons for:'); a.reasons.slice(0, 4).forEach((r) => L.push(`• ${r}`)); }
  if (a.reasonsAgainst?.length) { L.push('Reasons against:'); a.reasonsAgainst.slice(0, 3).forEach((r) => L.push(`• ${r}`)); }
  L.push('');
  L.push(`Invalidation: ${a.invalidationLevel}`);
  L.push(a.alternative);
  L.push('');
  L.push('Evidence-based, probability-driven guidance — not financial advice or a guarantee. Always honour your stop and size positions so a loss is acceptable.');
  return L.join('\n');
}

/** Conviction-ranked mini scan of liquid names → best long candidates. */
async function topPicks(ctx) {
  const candidates = [...ctx.rows]
    .filter((r) => r.current != null && !r.isDebt && (r.volume || 0) > 0)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 40);

  const found = [];
  for (const r of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const a = await ctx.getAnalysis(r.symbol);
    if (!a || !a.ok) continue;
    if (a.traderCallTone === 'buy' && a.stage?.stage === 2 && a.conviction >= 60 && a.levels) {
      found.push({
        symbol: r.symbol,
        detail: `${a.traderCall} · conv ${a.conviction} · buy ${a.levels.buyZone[0]}–${a.levels.buyZone[1]}, stop ${a.levels.stopLoss}`,
        conviction: a.conviction,
      });
    }
  }
  found.sort((a, b) => b.conviction - a.conviction);
  const note = 'Ranked by conviction from the 40 most-liquid names (bounded for speed). Stage-2 long candidates only.';
  if (!found.length) return { kind: 'list', text: `No high-conviction long setups right now. ${note} Standing aside is a valid, disciplined outcome.`, list: [] };
  return { kind: 'list', text: `Best long candidates right now. ${note}`, list: found.slice(0, 10) };
}

/** Screeners for common questions. Bounded candidate set; never silently truncates. */
async function screen(ctx, type, title) {
  const rows = ctx.rows.filter((r) => r.current != null && !r.isDebt);

  if (type === 'volume') {
    const ranked = [...rows].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 15);
    return { kind: 'list', text: title, list: ranked.map((r) => ({ symbol: r.symbol, detail: `Vol ${fmt(r.volume)} · ${signPct(r.changePct)}` })) };
  }

  const candidates = [...rows]
    .sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0) || (b.volume || 0) - (a.volume || 0))
    .slice(0, 40);

  const results = [];
  for (const r of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const a = await ctx.getAnalysis(r.symbol);
    if (!a || !a.ok) continue;
    const m = a.metrics;
    if (type === 'breakout' && a.reasons.some((x) => /breakout/i.test(x)) && a.bullishProbability >= 55) results.push({ symbol: r.symbol, detail: `Bull ${a.bullishProbability}% · conv ${a.conviction}`, prob: a.conviction });
    else if (type === 'oversold' && m.rsi != null && m.rsi <= 35) results.push({ symbol: r.symbol, detail: `RSI ${m.rsi.toFixed(1)} · Bull ${a.bullishProbability}%`, prob: 100 - m.rsi });
    else if (type === 'overbought' && m.rsi != null && m.rsi >= 70) results.push({ symbol: r.symbol, detail: `RSI ${m.rsi.toFixed(1)} · Bull ${a.bullishProbability}%`, prob: m.rsi });
    else if (type === 'momentum' && m.roc10 != null && m.roc10 > 3 && a.bullishProbability >= 55) results.push({ symbol: r.symbol, detail: `ROC ${m.roc10.toFixed(1)}% · conv ${a.conviction}`, prob: m.roc10 });
  }
  results.sort((a, b) => b.prob - a.prob);
  const note = `Scanned the ${candidates.length} most active / most-moved names (bounded for performance).`;
  if (!results.length) return { kind: 'list', text: `${title}. None found. ${note}`, list: [] };
  return { kind: 'list', text: `${title}. ${note}`, list: results.slice(0, 15) };
}

function fmt(n) { if (n == null) return '—'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
function signPct(n) { if (n == null) return '—'; return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

export { GLOSSARY };
