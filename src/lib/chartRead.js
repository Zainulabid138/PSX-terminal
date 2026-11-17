/**
 * chartRead.js — turns the analysis into a plain-language "what the chart is
 * saying" narrative, like a patient tutor reading the chart with you. It only
 * describes what the REAL data shows (trend, structure, MAs, range position,
 * support/resistance, momentum, volume) — no predictions.
 */

const n = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp));

export function readChart(a) {
  if (!a || !a.ok) return { headline: 'Chart', points: [], bottomLine: a?.message || 'Insufficient data.', tone: 'neutral' };
  const m = a.metrics || {};
  const p = a.price;
  const points = [];

  // 1) Trend across timeframes
  points.push({ k: 'Trend', v: `Daily ${a.trend.daily}, weekly ${a.trend.weekly}, monthly ${a.trend.monthly}. ${a.trend.summary}` });

  // 2) Market structure (Wyckoff-style phase)
  points.push({ k: 'Structure', v: `${a.marketStructure.label}. ${a.marketStructure.reason}` });

  // 3) Price vs moving averages
  const ma = [];
  if (m.ema20 != null && m.ema50 != null) ma.push(`${p > m.ema20 ? 'above' : 'below'} EMA20 (${n(m.ema20)}) and ${p > m.ema50 ? 'above' : 'below'} EMA50 (${n(m.ema50)})`);
  if (m.ema200 != null) ma.push(`${p > m.ema200 ? 'above' : 'below'} the 200-day (${n(m.ema200)}) — long-term ${p > m.ema200 ? 'up' : 'down'}`);
  if (ma.length) points.push({ k: 'Moving averages', v: `Price is ${ma.join(', ')}.` });

  // 4) Position within the 52-week range
  if (m.hi52 != null && m.lo52 != null && m.hi52 > m.lo52) {
    const pos = ((p - m.lo52) / (m.hi52 - m.lo52)) * 100;
    const where = pos >= 75 ? 'the TOP part (near its highs)' : pos >= 45 ? 'the MIDDLE' : 'the LOWER part (near its lows)';
    points.push({ k: 'Range', v: `Price sits in ${where} of its 52-week range (${pos.toFixed(0)}% up from the low ${n(m.lo52)}; high ${n(m.hi52)}).` });
  }

  // 5) Support & resistance
  points.push({ k: 'Support / Resistance', v: `Nearest support ~${m.support != null ? n(m.support) : '—'}, nearest resistance ~${m.resistance != null ? n(m.resistance) : '—'}. Price often reacts at these levels.` });

  // 6) Momentum
  points.push({ k: 'Momentum', v: a.momentum.summary });

  // 7) Volume / tape
  if (a.tape) points.push({ k: 'Volume / big trades', v: a.tape.verdict });
  else points.push({ k: 'Volume', v: a.volume.summary });

  // Bottom line
  const tone = a.bullishProbability >= 58 ? 'bullish' : a.bullishProbability <= 42 ? 'bearish' : 'neutral';
  let bottomLine;
  const sup = m.support != null ? n(m.support) : 'support';
  const res = m.resistance != null ? n(m.resistance) : 'resistance';
  if (tone === 'bullish') bottomLine = `The chart leans BULLISH (${a.bullishProbability}% up). It reacts up as long as it holds above ${sup}; a decisive break over ${res} opens more upside. A daily close below ${sup} would weaken the picture.`;
  else if (tone === 'bearish') bottomLine = `The chart leans BEARISH (${a.bearishProbability}% down). Pressure stays down below ${res}; strength only returns on a close back above ${res}. Support to watch: ${sup}.`;
  else bottomLine = `The chart is MIXED / sideways — no clear edge. It needs a decisive break beyond support (${sup}) or resistance (${res}) to pick a direction. Best to wait.`;

  return { headline: a.trend.summary, points, bottomLine, tone };
}
