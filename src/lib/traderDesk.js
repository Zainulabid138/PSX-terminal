/**
 * traderDesk.js
 * -------------
 * The "sit across from a trader" layer. Instead of reporting today's move, it
 * synthesises everything the engine already computed (stage, trend, momentum,
 * structure, relative strength, levels, market regime, tape) into a FORWARD,
 * conditional opinion — the way a real trader talks: a lean, a thesis, an if-A-
 * then-B bull/bear path, a concrete plan with a trigger and an invalidation, and
 * an HONEST confidence ("this is my lean, ~X%, not a certainty; the stop is
 * where I admit I'm wrong"). It predicts nothing — it takes a side with a plan
 * and states the odds, which is exactly what a disciplined trader does.
 */
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
const px = (x) => (x == null ? '—' : r2(x));

export function traderDesk(a, regime) {
  if (!a || !a.ok) return null;
  const m = a.metrics || {};
  const price = a.price;
  const st = a.stage?.stage;
  const bull = a.bullishProbability != null ? a.bullishProbability : 50;
  const bear = a.bearishProbability != null ? a.bearishProbability : 100 - bull;
  const { ema20, ema50, ema200, support, resistance, lo52, hi52 } = m;
  const stop = a.levels?.stopLoss ?? support ?? (ema50 != null ? r2(ema50 * 0.97) : null);
  const t1 = a.levels?.targets?.[0]?.price ?? resistance;
  const t2 = a.levels?.targets?.[1]?.price;
  const buyLo = a.levels?.buyZone?.[0];
  const buyHi = a.levels?.buyZone?.[1];
  const rel = /Outperforming/.test(a.relativeStrength?.label || '') ? ' and a relative-strength leader (beating the KSE-100)' : /Underperforming/.test(a.relativeStrength?.label || '') ? ', though it is lagging the KSE-100' : '';
  const extended = ema20 != null && price > ema20 * 1.06;
  const riskOff = regime?.state === 'Risk-Off';
  const distribution = a.tape?.bias === 'sell';

  let lean, tone, badge, headline, thesis, plan = {};

  if (st === 4) {
    lean = 'avoid'; tone = 'sell'; badge = 'AVOID — downtrend';
    headline = "It's in a down-trend — I'm not a buyer here; bounces are for selling, not chasing.";
    thesis = `This is a Stage-4 down-trend (only ${bull}% bullish), price sitting below its key moving averages${rel}. In a down-trend, rallies tend to fail and "cheap" gets cheaper. A trader stays out of the long side until it stops falling, builds a base, and reclaims its 200-day line (${px(ema200)}). Until then, capital is better used elsewhere.`;
    plan = { trigger: `Only worth watching if it bases and reclaims ${px(ema200)} (200-day) on volume`, invalidation: 'N/A — no long position to hold', target: '—', timeframe: 'Stand aside for now' };
  } else if (st === 3) {
    lean = 'reduce'; tone = 'neutral'; badge = 'PROTECT — late stage';
    headline = "Mature up-trend — I'd protect gains and tighten stops, not open a fresh position.";
    thesis = `The run is late (Stage 3 — topping). The trend is still up but momentum is thinning and the easy money is gone${rel}. If you already hold it, ride it with a trailing stop and book into strength. I would not start a new position this late; losing ${px(ema50)} (50-day) would be the tell that the top is in.`;
    plan = { trigger: 'No fresh buys — hold existing only, with a trailing stop', invalidation: `A close below ${px(ema50)} (50-day)`, target: `Book into strength near ${px(resistance ?? t1)}`, timeframe: 'Manage, don’t add' };
  } else if (st === 2 && extended) {
    lean = 'wait'; tone = 'neutral'; badge = 'WAIT — don’t chase';
    headline = 'A genuine up-trend leader — but stretched right now. I wait for a dip rather than chase.';
    thesis = `This is a Stage-2 up-trend${rel}, which is exactly what a trend-follower wants to own. But price is running well above its 20-day line (${px(ema20)}), so buying here is chasing — you'd be handing the stop a lot of room. The patient play is to let it pull back toward ${px(ema20)} / the buy zone and enter there, where risk is small and defined.`;
    plan = { trigger: `Buy a pullback into ${px(buyLo)}–${px(buyHi)} (near EMA20 ${px(ema20)}) as it turns back up`, invalidation: `A close below ${px(stop)}`, target: `${px(t1)}${t2 ? ` then ${px(t2)}` : ''}`, timeframe: 'Swing (days–weeks)' };
  } else if (st === 2) {
    lean = 'long'; tone = 'buy'; badge = 'LEAN LONG — buy the dip';
    headline = 'Stage-2 up-trend pulling into support — my lean is long, with a defined risk.';
    thesis = `This is an established up-trend${rel}, now pulling back into support around ${px(ema20)} — the spot where trend-followers add. My lean is long: as long as it holds ${px(stop)}, the path of least resistance is up toward ${px(t1)}. Buy it as the dip turns up, not while it's still falling, and let the stop do its job if I'm wrong.`;
    plan = { trigger: `Buy ${px(buyLo)}–${px(buyHi)} as it stabilises / turns up`, invalidation: `A close below ${px(stop)}`, target: `${px(t1)}${t2 ? ` then ${px(t2)}` : ''}`, timeframe: 'Swing (days–weeks)' };
  } else { // Stage 1 or unknown
    lean = 'wait'; tone = 'neutral'; badge = 'WATCH — needs a breakout';
    headline = "It's building a base — I want a breakout before I commit real money.";
    thesis = `It's basing (Stage 1), coiling around its moving averages${rel}. Bases resolve either way, so a trader doesn't guess — you wait for a breakout above ${px(resistance)} on strong volume to confirm a new up-trend, then buy the confirmation. Only the aggressive take a small starter here, with a stop under ${px(support ?? stop)}.`;
    plan = { trigger: `A breakout and hold above ${px(resistance)} on above-average volume`, invalidation: `A break below ${px(support ?? stop)}`, target: `${px(t1)}`, timeframe: 'Be patient — let it prove itself' };
  }

  // Forward, conditional scenarios — the "if A then B" a trader actually thinks in.
  const obj = t1 ?? resistance ?? hi52;
  const showHi = hi52 != null && obj != null && hi52 > obj * 1.01;
  const bullPath = { prob: bull, text: `If it holds ${px(support ?? stop)} and pushes through ${px(resistance ?? ema20)}, the next objective is ~${px(obj)}${showHi ? `, then the 52-week high ${px(hi52)}` : ''}.` };
  const bearPath = { prob: bear, text: `If it loses ${px(support ?? stop)} on a closing basis, expect a slide toward ${px(lo52 != null ? Math.max(lo52, (stop ?? lo52) * 0.94) : stop)}${lo52 != null ? ` and, if that breaks, the 52-week low ${px(lo52)}` : ''}.` };

  // Honest overlays — the context that changes how hard I'd press.
  const overlays = [];
  if (riskOff && (lean === 'long' || lean === 'wait')) overlays.push('The broad market is Risk-Off right now, so even a good setup deserves smaller size and a quicker finger on the stop.');
  else if (regime?.state === 'Risk-On' && lean === 'long') overlays.push('The broad market is Risk-On, which is a tailwind for a long here.');
  if (distribution) overlays.push(`Today's tape shows large sellers in control (buy pressure ${a.tape.buyPct}%) — I'd want that to cool off before pressing a long.`);

  const conviction = a.confidence != null ? a.confidence : a.conviction;
  const caveat = `This is my lean from the weight of evidence — about ${conviction}% confidence, NOT a certainty. Even a good trader is wrong plenty; that's why the plan has an invalidation (${px(stop)}). If it hits that, I'm wrong and I step aside — no hoping. Size every trade so a stop-out costs only 1–2% of your account.`;

  return { lean, tone, badge, headline, thesis, bullPath, bearPath, overlays, plan, conviction, caveat };
}
