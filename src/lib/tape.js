/**
 * tape.js — "tape reading" / time-&-sales analysis from intraday ticks.
 * --------------------------------------------------------------------
 * An experienced trader watches the TAPE (time & sales) for LARGE trades — the
 * footprints of big participants. This module takes the real intraday tick
 * series ([{time, price, volume}]) and:
 *   - finds LARGE prints (single trades far above the stock's typical size),
 *   - classifies each as aggressive BUY or SELL using the up/down-tick rule,
 *   - measures overall buy vs sell pressure,
 *   - returns a plain verdict: large buyers vs large sellers in control.
 *
 * HONEST LIMITATIONS (shown in the UI, never hidden):
 *   - PSX trades are ANONYMOUS. We see trade SIZE, not who traded. "Big trade"
 *     ≈ likely an institution/large player, but is NOT certain.
 *   - Buy/Sell is INFERRED with the classic up-tick/down-tick rule (a trade
 *     above the last price = buyer-initiated, below = seller-initiated). The
 *     source does not tag trades, so this is an approximation, not exact.
 */

/** Median of a numeric array. */
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {Array} ticks ascending [{time, price, volume}]
 * @param {object} opts { bigMult, floor }
 */
export function analyzeTape(ticks, opts = {}) {
  if (!ticks || ticks.length < 8) return null;
  const clean = ticks.filter((t) => t.price != null && t.volume != null && t.volume > 0);
  if (clean.length < 8) return null;

  const med = median(clean.map((t) => t.volume));
  const bigMult = opts.bigMult || 8;
  const floor = opts.floor || 5000; // absolute minimum shares to be a "large" print
  const threshold = Math.max(med * bigMult, floor);

  let buyVol = 0; let sellVol = 0;
  let lastDir = null;
  let lastPrice = clean[0].price;
  const big = [];
  let biggest = null;

  for (const t of clean) {
    let dir;
    if (t.price > lastPrice) dir = 'buy';
    else if (t.price < lastPrice) dir = 'sell';
    else dir = lastDir; // unchanged price → carry the last known direction
    if (dir) lastDir = dir;
    lastPrice = t.price;

    if (dir === 'buy') buyVol += t.volume;
    else if (dir === 'sell') sellVol += t.volume;

    if (t.volume >= threshold) {
      const entry = { time: t.time, price: t.price, volume: t.volume, dir: dir || 'neutral' };
      big.push(entry);
      if (!biggest || t.volume > biggest.volume) biggest = entry;
    }
  }

  const total = buyVol + sellVol || 1;
  const buyPct = Math.round((buyVol / total) * 100);
  const bigBuy = big.filter((b) => b.dir === 'buy').reduce((a, b) => a + b.volume, 0);
  const bigSell = big.filter((b) => b.dir === 'sell').reduce((a, b) => a + b.volume, 0);

  let verdict; let bias;
  if (bigBuy > bigSell * 1.5 && buyPct >= 55) { verdict = 'Large buyers in control — aggressive buying on the tape.'; bias = 'buy'; }
  else if (bigSell > bigBuy * 1.5 && buyPct <= 45) { verdict = 'Large sellers in control — distribution (big selling) on the tape.'; bias = 'sell'; }
  else { verdict = 'Mixed — no clear large-player dominance right now.'; bias = 'neutral'; }

  return {
    medianTrade: Math.round(med),
    threshold: Math.round(threshold),
    bigCount: big.length,
    biggest,
    bigBuy,
    bigSell,
    buyPct,
    verdict,
    bias,
    recent: big.slice(-10).reverse(), // most recent large prints first
  };
}
