import React, { useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { Empty } from './common.jsx';
import { fmtPrice, fmtVolume, fmtPct, shariahStatus } from '../utils/format.js';

/**
 * Penny Stocks — an explorer for low-priced PSX shares, built to EDUCATE and
 * warn, not to hype. Low price is not "cheap"; most penny names are volatile,
 * thinly traded, and prone to pump-and-dump. The single most important number
 * here is LIQUIDITY (rupee value traded) — if you can't get out, the price on
 * screen is meaningless. Everything is from the live snapshot; nothing invented.
 */
const rsShort = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return 'Rs ' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return 'Rs ' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return 'Rs ' + (n / 1e3).toFixed(0) + 'K';
  return 'Rs ' + Math.round(n);
};

// Honest liquidity read from today's rupee turnover (price × volume).
function liquidity(turnover) {
  if (turnover == null) return { tone: 'neutral', label: '—' };
  if (turnover < 1e6) return { tone: 'sell', label: '⚠ Illiquid — hard to exit' };
  if (turnover < 5e6) return { tone: 'neutral', label: 'Thin — trade small' };
  return { tone: 'buy', label: '✓ Tradeable liquidity' };
}

const PRICE_TIERS = [5, 10, 20];
const SORTS = [
  { id: 'liquidity', label: 'Most liquid' },
  { id: 'gainers', label: "Today's gainers" },
  { id: 'price', label: 'Lowest price' },
];

export default function PennyStocks({ onSelect }) {
  const { equityRows } = useMarket();
  const [maxPrice, setMaxPrice] = useState(10);
  const [sort, setSort] = useState('liquidity');
  const [onlyLiquid, setOnlyLiquid] = useState(false);
  const [onlyShariah, setOnlyShariah] = useState(false);

  const rows = useMemo(() => {
    let list = equityRows
      .filter((r) => r.current != null && r.current > 0 && r.current <= maxPrice)
      .map((r) => {
        const turnover = r.volume != null ? r.current * r.volume : null;
        return { ...r, turnover, liq: liquidity(turnover), sh: shariahStatus(r.listedIn) };
      });
    if (onlyLiquid) list = list.filter((r) => r.turnover != null && r.turnover >= 5e6);
    if (onlyShariah) list = list.filter((r) => r.sh.compliant);
    list.sort((a, b) => {
      if (sort === 'gainers') return (b.changePct ?? -999) - (a.changePct ?? -999);
      if (sort === 'price') return a.current - b.current;
      return (b.turnover ?? 0) - (a.turnover ?? 0);
    });
    return list;
  }, [equityRows, maxPrice, sort, onlyLiquid, onlyShariah]);

  const liquidCount = rows.filter((r) => r.turnover >= 5e6).length;

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🪙 Penny Stocks — under Rs {maxPrice}</h2>
          <p className="opps__sub">Explore low-priced PSX shares with the one number that matters most for them — liquidity (rupee value traded today). Sorted so the actually-tradeable names come first. Click any stock for full analysis before you even think about buying.</p>
        </div>
        <div className="rm-controls">
          <div className="ps-tiers">
            {PRICE_TIERS.map((p) => <button key={p} className={maxPrice === p ? 'active' : ''} onClick={() => setMaxPrice(p)}>≤ Rs {p}</button>)}
          </div>
          <label className="rm-check"><input type="checkbox" checked={onlyLiquid} onChange={(e) => setOnlyLiquid(e.target.checked)} /> Liquid only</label>
          <label className="rm-check"><input type="checkbox" checked={onlyShariah} onChange={(e) => setOnlyShariah(e.target.checked)} /> Shariah only ☪</label>
        </div>
      </div>

      <div className="regime regime--warn">
        <b>⚠ Before you touch penny stocks — understand this</b>
        <span>Low price is <b>not</b> "cheap" — a Rs 3 share is not "about to become Rs 30". Most penny names are volatile, thinly traded, and easy to manipulate (pump-and-dump). Rules that keep you safe: (1) <b>Liquidity first</b> — if the “⚠ Illiquid” flag shows, you may not be able to sell; skip it. (2) <b>Tiny size only</b> — money you can fully afford to lose. (3) <b>A hard stop is mandatory</b> — these fall as fast as they rise. (4) A green day is not a signal — <b>open the analysis</b> and check trend, stage and volume first.</span>
      </div>

      <div className="opps__stamp">
        Showing {rows.length} shares under Rs {maxPrice} · {liquidCount} with tradeable liquidity (≥ Rs 5M traded) · sorted by {SORTS.find((s) => s.id === sort).label.toLowerCase()}
      </div>
      <div className="ps-sorts">
        {SORTS.map((s) => <button key={s.id} className={sort === s.id ? 'active' : ''} onClick={() => setSort(s.id)}>{s.label}</button>)}
      </div>

      {!rows.length && <Empty>No shares match under Rs {maxPrice} with these filters. Raise the price tier or clear a filter.</Empty>}

      {rows.length > 0 && (
        <div className="rm-table">
          <div className="rm-row ps-row rm-row--head">
            <span>Symbol</span><span className="rm-r">Price</span><span className="rm-r">%</span>
            <span className="rm-r">Volume</span><span className="rm-r">Traded (Rs)</span><span>Liquidity</span>
          </div>
          {rows.map((r) => (
            <div key={r.symbol} className="rm-row ps-row" onClick={() => onSelect(r.symbol)}>
              <span className="rm-sym">
                <b>{r.symbol}</b>
                {r.sh.known && r.sh.compliant && <span className="shariah-badge shariah-badge--yes">☪</span>}
                <span className="muted ellipsis rm-name">{r.name || ''}</span>
              </span>
              <span className="rm-r">{fmtPrice(r.current)}</span>
              <span className={`rm-r ${r.changePct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(r.changePct)}</span>
              <span className="rm-r muted">{fmtVolume(r.volume)}</span>
              <span className="rm-r">{rsShort(r.turnover)}</span>
              <span className={`ps-liq ps-liq--${r.liq.tone}`}>{r.liq.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sizer__note">“Traded (Rs)” = today’s price × volume — the real money that changed hands. Under ~Rs 1M means you could get stuck holding it. Penny stocks can be a small, disciplined part of a plan, but they are the fastest way to lose capital when treated as lottery tickets. Nothing here is a buy recommendation — it is a filtered, honest view so you can look and learn.</div>
    </div>
  );
}
