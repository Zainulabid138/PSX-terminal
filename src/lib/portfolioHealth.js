/**
 * portfolioHealth.js
 * ------------------
 * A veteran-trader read of a whole portfolio's STRUCTURE (not just P/L):
 * concentration, downtrend exposure, and inverted allocation (big money on
 * weak setups). Returns a 0-100 structural-health score, plain-language issues,
 * and a priority-ordered action list. Everything is derived from the live
 * per-holding analysis — probability-based, honest, not financial advice.
 *
 * Input `rows`: the computed holding rows from the Portfolio view, each with
 * { symbol, qty, avgCost, invested, value, pl, plPct, adv:{tone, action, stop} }.
 * tone: 'buy' = Stage-2/healthy · 'sell' = Stage-4/bearish · 'neutral' = mixed.
 */
export function portfolioHealth(rows) {
  const priced = (rows || []).filter((r) => r.value != null && r.value > 0);
  if (!priced.length) return null;

  const totalValue = priced.reduce((s, r) => s + r.value, 0);
  const totalInvested = priced.reduce((s, r) => s + r.invested, 0);
  const totalPL = totalValue - totalInvested;
  const plPct = totalInvested ? (totalPL / totalInvested) * 100 : 0;

  const withW = priced.map((r) => ({ ...r, w: totalValue ? (r.value / totalValue) * 100 : 0 }));
  const byVal = [...withW].sort((a, b) => b.value - a.value);
  const maxW = byVal[0]?.w ?? 0;
  const top2 = (byVal[0]?.w ?? 0) + (byVal[1]?.w ?? 0);
  const downtrendPct = (withW.filter((r) => r.adv.tone === 'sell').reduce((s, r) => s + r.value, 0) / totalValue) * 100;
  const healthyPct = (withW.filter((r) => r.adv.tone === 'buy').reduce((s, r) => s + r.value, 0) / totalValue) * 100;

  const biggestSell = byVal.find((r) => r.adv.tone === 'sell');
  const biggestBuy = byVal.find((r) => r.adv.tone === 'buy');
  const inverted = biggestSell && (!biggestBuy || biggestSell.w > biggestBuy.w) && priced.length > 1;

  const issues = [];
  let score = 100;

  // 1) Concentration — any single name too large, or top-two dominating.
  const over = withW.filter((r) => r.w > 20).sort((a, b) => b.w - a.w);
  if (maxW > 30) score -= 25; else if (maxW > 20) score -= 12;
  if (top2 > 70) score -= 15; else if (top2 > 55) score -= 8;
  if (over.length) {
    issues.push({
      level: maxW > 30 ? 'severe' : 'warn',
      title: 'Concentration risk',
      detail: `${over.map((r) => `${r.symbol} ${r.w.toFixed(0)}%`).join(', ')} over 20% of the book${top2 > 55 ? `; top two = ${top2.toFixed(0)}%` : ''}. One bad move in a big name hits the whole account. Keep any single stock under ~15–20%.`,
    });
  }

  // 2) Downtrend exposure — value parked in Stage-4/bearish names.
  if (downtrendPct > 40) score -= 25; else if (downtrendPct > 20) score -= 12;
  if (downtrendPct > 20) {
    const names = withW.filter((r) => r.adv.tone === 'sell').sort((a, b) => b.value - a.value).map((r) => r.symbol);
    issues.push({
      level: downtrendPct > 40 ? 'severe' : 'warn',
      title: 'Downtrend exposure',
      detail: `${downtrendPct.toFixed(0)}% of value in Stage-4 / bearish stocks (${names.join(', ')}). These drag hardest and turn a small loss into a big one. Protect with hard stops or reduce.`,
    });
  }

  // 3) Inverted allocation — biggest money on the weakest setup.
  if (inverted) {
    score -= 12;
    issues.push({
      level: 'warn',
      title: 'Inverted allocation',
      detail: `Your biggest money is on a weak setup (${biggestSell.symbol} ${biggestSell.w.toFixed(0)}%, downtrend)${biggestBuy ? `, while your healthiest uptrend (${biggestBuy.symbol}) is only ${biggestBuy.w.toFixed(0)}%` : ''}. Pros size winners up and losers to zero — not the reverse.`,
    });
  }

  // 4) Bleeding losers still held (sell-toned and down > 5%).
  const bleeders = withW.filter((r) => r.adv.tone === 'sell' && r.plPct != null && r.plPct < -5);
  score -= Math.min(15, bleeders.length * 6);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 75 ? { g: 'Strong', tone: 'buy' }
    : score >= 60 ? { g: 'Solid', tone: 'buy' }
    : score >= 45 ? { g: 'Needs work', tone: 'neutral' }
    : score >= 30 ? { g: 'Risky', tone: 'sell' }
    : { g: 'Fragile', tone: 'sell' };

  // Priority-ordered actions.
  const actions = [];
  for (const r of byVal.filter((x) => x.adv.tone === 'sell')) {
    actions.push({ sym: r.symbol, action: 'Reduce / exit', why: `${r.w.toFixed(0)}% of book, Stage-4 / bearish${r.adv.stop != null ? ` — hard stop ~${r.adv.stop}` : ''}. Exit on any bounce; don't average down.` });
  }
  for (const r of over.filter((x) => x.adv.tone !== 'sell')) {
    actions.push({ sym: r.symbol, action: 'Trim toward ~20%', why: `${r.w.toFixed(0)}% is too big for one name — not because it's bad, the size is the risk. Booking some cuts single-stock risk.` });
  }
  if (healthyPct < 25) {
    actions.push({ sym: '', action: 'Redeploy into Stage-2 leaders', why: `Only ${healthyPct.toFixed(0)}% of the book is in healthy uptrends. Move freed cash into Stage-2 setups (Buy Signals / Top Picks), 1–2% risk each.` });
  }
  if (!issues.length && !actions.length) {
    actions.push({ sym: '', action: 'Hold & manage', why: 'No structural red flags. Trail stops on winners, keep single names under ~20%, and cut anything that turns Stage-4.' });
  }

  return { score, grade, plPct, totalValue, totalPL, downtrendPct, healthyPct, maxW, top2, issues, actions };
}
