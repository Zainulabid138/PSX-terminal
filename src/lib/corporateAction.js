/**
 * corporateAction.js
 * ------------------
 * Reads a stock's REAL recent PSX filings (announcement titles) and flags
 * corporate actions that a purely price/trend-based buy signal cannot see —
 * above all a RIGHTS ISSUE (new shares that dilute holders and usually drag the
 * price toward the discounted rights price). This is why a technically-valid
 * "buy the dip" can still be a trap: the chart looks fine, but the company is
 * about to dilute. We never invent events — we only match the official titles.
 */

const RULES = [
  { re: /right\s*shares|rights?\s*issue|issue of right|letter of right|renounceable|further issue of capital|offer (document )?for right/i,
    severity: 'high', type: 'Rights Issue',
    note: 'Company is issuing new (rights) shares. This DILUTES existing holders and the price often drifts toward the discounted rights price — heavy selling around rights issues is common. A buy signal here is high-risk; usually best to avoid until it is over.' },
  { re: /de-?list|delist/i, severity: 'high', type: 'De-listing',
    note: 'De-listing process in progress — do not treat this as a normal trade.' },
  { re: /suspension|suspend(ed)?\s*(from\s*)?trading|trading.*suspend/i, severity: 'high', type: 'Trading Suspension',
    note: 'Risk of trading suspension — you may be unable to exit. Avoid.' },
  { re: /winding[-\s]?up|liquidation|insolven/i, severity: 'high', type: 'Winding Up / Liquidation',
    note: 'Winding up / liquidation risk — avoid.' },
  { re: /\bdefault(er|ed)?\b|non-?compliance.*delist/i, severity: 'high', type: 'Default Notice',
    note: 'Default / serious compliance notice — high risk.' },
  { re: /merger|amalgamation|scheme of arrangement|acquisition of/i, severity: 'medium', type: 'Merger / Scheme',
    note: 'A merger / scheme of arrangement is underway — the share can move on deal terms rather than fundamentals. Extra uncertainty; read the filing.' },
  { re: /reduction of capital|capital reduction|buy-?back/i, severity: 'medium', type: 'Capital Change',
    note: 'A capital reduction / buy-back is underway — read the terms before trading.' },
  { re: /bonus\s*(shares|issue)/i, severity: 'info', type: 'Bonus Shares',
    note: 'Bonus shares announced — the price adjusts DOWN on the ex-date (it is not free profit).' },
  { re: /share split|stock split|sub-?division|face value/i, severity: 'info', type: 'Split / Face-value',
    note: 'A split / face-value change adjusts the price mechanically — not a real gain or loss.' },
];

const ORDER = { high: 0, medium: 1, info: 2 };

/**
 * @param {{items?: Array<{title?:string,date?:string}>}} announcements
 * @returns {{hits: Array<{severity,type,note,title,date}>, worst: 'high'|'medium'|'info'|null}}
 */
export function detectCorporateAction(announcements) {
  const items = (announcements && announcements.items) || [];
  const hits = [];
  const seen = new Set();
  for (const it of items) {
    const title = it && it.title ? it.title : '';
    if (!title) continue;
    for (const rule of RULES) {
      if (rule.re.test(title)) {
        if (!seen.has(rule.type)) { // keep the most recent per type (items are newest-first)
          seen.add(rule.type);
          hits.push({ severity: rule.severity, type: rule.type, note: rule.note, title, date: it.date || null });
        }
        break;
      }
    }
  }
  hits.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return { hits, worst: hits[0] ? hits[0].severity : null };
}

/**
 * Today's tape as a demand check on a buy signal. Distribution (big sellers in
 * control) contradicting a buy signal is a real red flag.
 * @param {{bias?:string, buyPct?:number}} tape
 */
export function tapeWarning(tape) {
  if (!tape) return null;
  if (tape.bias === 'sell') return `Today’s tape shows DISTRIBUTION — large sellers in control (buy pressure ${tape.buyPct}%). Big players are net selling into this move; a buy signal that disagrees with the tape is a warning sign.`;
  if (tape.buyPct != null && tape.buyPct < 45) return `Today’s order flow leans to sellers (buy pressure ${tape.buyPct}%) — weak demand. Be cautious.`;
  return null;
}
