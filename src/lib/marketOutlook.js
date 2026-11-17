/**
 * marketOutlook.js
 * ----------------
 * A professional, forward read of the WHOLE market (KSE-100), built from the
 * same engine output used for stocks (`analyze()` run on the index) plus live
 * breadth and the Risk-On/Off regime. It answers, honestly: is the market down
 * or up now, how far could it fall (supports), and what has to happen — and
 * roughly when — for it to turn up (reclaim levels). It never fakes an exact
 * date: direction is conditional and probability-based, with timeframes stated
 * as "days / weeks" tied to levels, the way a real strategist talks.
 *
 * @param a       analyze() result for KSE-100 (a.metrics, a.stage, a.trend, ...)
 * @param regime  marketRegime() → { state: 'Risk-On'|'Risk-Off'|..., detail }
 * @param breadth { up, down, downPct, upPct }
 * @param quote   getIndexQuote('KSE100') → { value, change, changePct, date }
 */
const n0 = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-PK'));
const n2 = (x) => (x == null ? '—' : Number(x).toLocaleString('en-PK', { maximumFractionDigits: 2 }));

export function marketOutlook(a, regime, breadth, quote) {
  if (!a || !a.ok) return null;
  const m = a.metrics || {};
  const price = (quote && quote.value != null) ? quote.value : a.price;
  const { ema20, ema50, ema200, support, resistance, hi52, lo52, rsi } = m;
  const st = a.stage?.stage;
  const bull = a.bullishProbability != null ? a.bullishProbability : 50;
  const bear = a.bearishProbability != null ? a.bearishProbability : 100 - bull;
  const aboveLong = ema200 != null && price > ema200;
  const aboveMid = ema50 != null && price > ema50;
  const rOff = regime?.state === 'Risk-Off';
  const rOn = regime?.state === 'Risk-On';

  // --- Phase / bias ---
  let phase; let bias; let tone; let headline;
  if (st === 4 || (!aboveMid && ema50 != null && ema200 != null && ema50 < ema200)) {
    phase = 'Downtrend (Markdown)'; bias = 'DOWN'; tone = 'sell';
    headline = 'Market is in a down-phase — protect capital, this is not the time to buy aggressively.';
  } else if (st === 3) {
    phase = 'Topping (late uptrend)'; bias = 'CAUTION'; tone = 'neutral';
    headline = 'Up-trend is mature/topping — the easy upside is gone; tighten risk, don’t chase.';
  } else if (st === 2 || (aboveMid && aboveLong)) {
    phase = 'Uptrend (Markup)'; bias = 'UP'; tone = 'buy';
    headline = 'Market is in an up-phase — buy leaders on dips, ride the trend with a stop.';
  } else {
    phase = 'Basing / sideways'; bias = 'NEUTRAL'; tone = 'neutral';
    headline = 'Market is basing / range-bound — wait for a decisive break before committing.';
  }

  // --- Downside path (how far it could fall) ---
  const downLevels = [];
  if (support != null && support < price) downLevels.push({ label: 'Immediate support', value: support });
  if (ema50 != null && ema50 < price) downLevels.push({ label: '50-day average', value: ema50 });
  if (ema200 != null && ema200 < price) downLevels.push({ label: '200-day average (major)', value: ema200 });
  if (lo52 != null) downLevels.push({ label: '52-week low', value: lo52 });
  downLevels.sort((x, y) => y.value - x.value); // nearest first

  // --- Upside triggers (what must be reclaimed to turn up) ---
  const upLevels = [];
  if (resistance != null && resistance > price) upLevels.push({ label: 'Immediate resistance', value: resistance });
  if (ema20 != null && ema20 > price) upLevels.push({ label: '20-day average', value: ema20 });
  if (ema50 != null && ema50 > price) upLevels.push({ label: '50-day average', value: ema50 });
  if (ema200 != null && ema200 > price) upLevels.push({ label: '200-day average', value: ema200 });
  if (hi52 != null && hi52 > price) upLevels.push({ label: '52-week high', value: hi52 });
  upLevels.sort((x, y) => x.value - y.value); // nearest first

  // --- Forward view (honest, conditional, with a rough timeframe) ---
  let forward; let timeframe; let whatToDo;
  const reclaim = ema20 != null ? n0(ema20) : (resistance != null ? n0(resistance) : 'the 20-day');
  const firstSupport = downLevels[0] ? n0(downLevels[0].value) : (support != null ? n0(support) : 'nearby support');
  if (bias === 'DOWN') {
    forward = `The bias stays DOWN while the index trades below its 50-day (${n0(ema50)}). A bounce is possible from ${firstSupport}, but a real turn-up is only confirmed when it RECLAIMS and holds above ~${reclaim} on improving breadth. Until then, rallies tend to fail.`;
    timeframe = 'A durable bottom usually takes time to form — think weeks of basing, not days. Watch the reclaim level, not the calendar.';
    whatToDo = 'Reduce / hold cash. Don’t buy the falling market. Keep a watchlist of leaders for when it turns.';
  } else if (bias === 'UP') {
    forward = `Up-trend is intact while the index holds above its 50-day (${n0(ema50)}). Dips toward ${firstSupport} / the 20-day are buy areas. A close below ${n0(ema50)} would be the first warning the trend is weakening.`;
    timeframe = 'Trend can persist for weeks while structure holds — manage with a trailing stop, don’t predict a top.';
    whatToDo = 'Buy quality leaders on dips, trail stops, book into strength. Stay with the trend.';
  } else if (bias === 'CAUTION') {
    forward = `The up-trend is late. Momentum is fading near highs. A break below the 50-day (${n0(ema50)}) would signal the top is likely in; holding above it keeps the trend alive but thin.`;
    timeframe = 'Tops form over days-to-weeks — tighten up now rather than waiting for the break.';
    whatToDo = 'Book partial profits, tighten stops, stop adding new risk.';
  } else {
    forward = `Range-bound. A decisive break above ${upLevels[0] ? n0(upLevels[0].value) : reclaim} opens the up-side; a break below ${firstSupport} opens the down-side. Trading the middle is low-odds.`;
    timeframe = 'Bases resolve in days-to-weeks — wait for the break, then act.';
    whatToDo = 'Be patient — let the market pick a direction before committing size.';
  }

  // --- Breadth + regime context lines ---
  const context = [];
  if (breadth && (breadth.up + breadth.down) > 0) {
    context.push(`Breadth today: ${breadth.upPct != null ? breadth.upPct : Math.round((breadth.up / (breadth.up + breadth.down)) * 100)}% of stocks up / ${breadth.downPct != null ? breadth.downPct : Math.round((breadth.down / (breadth.up + breadth.down)) * 100)}% down — ${breadth.downPct >= 58 ? 'broadly weak (sellers in control)' : breadth.upPct >= 58 ? 'broadly strong (buyers in control)' : 'mixed'}.`);
  }
  if (regime?.state) context.push(`Regime: ${regime.state}${regime.detail ? ` — ${regime.detail}` : ''}.`);
  if (rsi != null) context.push(`Index momentum: RSI ${Math.round(rsi)} (${rsi >= 70 ? 'overbought' : rsi <= 35 ? 'oversold — bounce possible' : 'neutral'}).`);

  // --- Next session (kal) — the if-then the user watches at the open ---
  const immS = downLevels[0] ? downLevels[0].value : (support != null ? support : null);
  const nextS = downLevels[1] ? downLevels[1].value : (ema50 != null && ema50 < price ? ema50 : null);
  const immR = upLevels[0] ? upLevels[0].value : (resistance != null ? resistance : null);
  const nextR = upLevels[1] ? upLevels[1].value : (hi52 != null && hi52 > price ? hi52 : null);
  const breadthUp = breadth && breadth.upPct >= 55;
  const breadthDown = breadth && breadth.downPct >= 55;
  let leanText; let leanTone;
  if (breadthDown || bias === 'DOWN') { leanText = 'Leaning DOWN — be defensive at the open'; leanTone = 'sell'; }
  else if (breadthUp && bias !== 'DOWN') { leanText = `Mild UP lean — but only if ${n0(immS)} holds`; leanTone = 'buy'; }
  else { leanText = 'Neutral — let the level break decide'; leanTone = 'neutral'; }
  const nextSession = {
    leanText, leanTone,
    upTrigger: immR != null ? `Holds ${n0(immS)} & breaks above ${n0(immR)}` : 'Breaks above resistance on volume',
    upTarget: nextR != null ? n0(nextR) : (hi52 != null ? n0(hi52) : '—'),
    downTrigger: immS != null ? `Breaks below ${n0(immS)}` : 'Breaks below support',
    downTarget: nextS != null ? n0(nextS) : (ema50 != null ? n0(ema50) : '—'),
    watchSupport: immS, watchResist: immR,
    action: bias === 'DOWN' ? 'Hold cash / don’t buy weakness. Only act if it reclaims the resistance.'
      : bias === 'CAUTION' ? 'No chasing. Trade only strong leaders on a confirmed break; keep stops tight.'
      : bias === 'UP' ? 'Buy leaders on a dip that holds support; trail your stop.'
      : 'Wait for the break — don’t trade the middle.',
  };

  return {
    phase, bias, tone, headline,
    value: price, change: quote?.change, changePct: quote?.changePct, asOf: quote?.date,
    bull, bear,
    levels: { ema20, ema50, ema200, support, resistance, hi52, lo52 },
    downLevels, upLevels, nextSession,
    forward, timeframe, whatToDo, context,
    caveat: 'This is a probability-based read of the trend and key levels — NOT a prediction of an exact date or level. Markets surprise; use it to size risk and plan, with a stop, not as a certainty.',
  };
}
