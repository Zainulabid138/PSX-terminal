import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { Empty } from './common.jsx';
import { fmtPrice, fmtVolume, fmtPct, shariahStatus } from '../utils/format.js';
import { getMarketStatus } from '../utils/marketStatus.js';

/**
 * Rupee Movers — a LIVE watch-list of stocks that have risen by at least a
 * chosen rupee amount (default +Rs 2) in the current session. Reads straight
 * from the live market-watch snapshot, so it refreshes every poll during
 * trading hours. It also tracks movement since the moment you start watching
 * ("live since HH:MM"), so you can catch a stock jumping +Rs 2 in real time.
 *
 * HONEST BY DESIGN: an absolute rupee move means very different things at
 * different prices, so both the rupee change AND the % change are shown, and
 * this is framed as a WATCH list — not an automatic buy. Click any row to run
 * the full analysis before acting.
 */
const hhmm = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }) : '');
const PRICE_BANDS = [[null, 'All'], [3000, '≤ Rs 3000'], [1000, '≤ Rs 1000'], [500, '≤ Rs 500']];

export default function RupeeMovers({ onSelect }) {
  const { equityRows } = useMarket();
  const [thresh, setThresh] = useState(2);
  const [onlyShariah, setOnlyShariah] = useState(false);
  const [maxPrice, setMaxPrice] = useState(null); // price band; null = all
  const baselineRef = useRef(new Map()); // symbol -> price when watching started
  const [baseAt, setBaseAt] = useState(null);
  const status = getMarketStatus();

  const snapBaseline = () => {
    const m = new Map();
    equityRows.forEach((r) => m.set(r.symbol, r.current));
    baselineRef.current = m;
    setBaseAt(Date.now());
  };

  // Capture the baseline once, the first time live rows arrive.
  useEffect(() => {
    if (!baseAt && equityRows.length) snapBaseline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equityRows.length, baseAt]);

  const movers = useMemo(() => {
    const t = Number(thresh);
    if (!(t > 0)) return [];
    let list = equityRows
      .filter((r) => r.current != null && r.change != null && r.change >= t)
      .map((r) => {
        const base = baselineRef.current.get(r.symbol);
        const liveDelta = base != null ? r.current - base : null;
        return { ...r, liveDelta, sh: shariahStatus(r.listedIn) };
      });
    if (onlyShariah) list = list.filter((r) => r.sh.compliant);
    if (maxPrice != null) list = list.filter((r) => r.current <= maxPrice);
    return list.sort((a, b) => b.change - a.change);
  }, [equityRows, thresh, onlyShariah, maxPrice, baseAt]);

  const jumpers = movers.filter((r) => r.liveDelta != null && r.liveDelta >= Number(thresh));

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">💹 Rupee Movers — up ≥ Rs {Number(thresh) || 0} today</h2>
          <p className="opps__sub">Live list of stocks that have gained at least your chosen rupee amount this session. Refreshes automatically during market hours. A watch-list to catch movers — not an automatic buy. Click any stock to confirm with full analysis.</p>
        </div>
        <div className="rm-controls">
          <label>Min rise (Rs)
            <input type="number" step="0.5" min="0.5" value={thresh} onChange={(e) => setThresh(e.target.value)} />
          </label>
          <label className="rm-check"><input type="checkbox" checked={onlyShariah} onChange={(e) => setOnlyShariah(e.target.checked)} /> Shariah only ☪</label>
          <button className="link-btn" onClick={snapBaseline} title="Zero the live column to track moves from right now">↺ Watch from now</button>
        </div>
      </div>

      <div className="rm-bands">
        <span className="rm-bands__lbl">Price:</span>
        {PRICE_BANDS.map(([v, label]) => (
          <button key={label} className={maxPrice === v ? 'active' : ''} onClick={() => setMaxPrice(v)}>{label}</button>
        ))}
      </div>

      <div className="regime regime--warn">
        <b>Read this first — a rupee move ≠ a buy</b>
        <span>+Rs 2 on a Rs 20 stock is +10% (a huge, maybe already-overheated move); on a Rs 500 stock it is +0.4% (noise). Always read the <b>% column</b> next to the rupee change, check volume, and open the stock’s analysis before acting. This list only tells you <i>what moved</i>, not <i>what to buy</i>.</span>
      </div>

      <div className="opps__stamp">
        {status.open ? '🟢 Market open — updating live' : '🔴 Market closed — showing the last session’s moves'}
        {baseAt ? ` · watching since ${hhmm(baseAt)}` : ''}
        {` · ${movers.length} up ≥ Rs ${Number(thresh) || 0}`}
        {jumpers.length ? ` · ${jumpers.length} jumped ≥ Rs ${Number(thresh) || 0} since you started` : ''}
      </div>

      {!movers.length && <Empty>No stock is up by Rs {Number(thresh) || 0}+ right now. Lower the threshold, or wait for the market to move.</Empty>}

      {movers.length > 0 && (
        <div className="rm-table">
          <div className="rm-row rm-row--head">
            <span>Symbol</span><span className="rm-r">Price</span><span className="rm-r">+Rs today</span><span className="rm-r">%</span>
            <span className="rm-r">Live since watch</span><span className="rm-r">Volume</span>
          </div>
          {movers.map((r) => (
            <div key={r.symbol} className={`rm-row ${r.liveDelta >= Number(thresh) ? 'rm-row--jump' : ''}`} onClick={() => onSelect(r.symbol)}>
              <span className="rm-sym">
                <b>{r.symbol}</b>
                {r.sh.known && r.sh.compliant && <span className="shariah-badge shariah-badge--yes">☪</span>}
                <span className="muted ellipsis rm-name">{r.name || ''}</span>
              </span>
              <span className="rm-r">{fmtPrice(r.current)}</span>
              <span className="rm-r pos bold">+{fmtPrice(r.change)}</span>
              <span className={`rm-r ${r.changePct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(r.changePct)}</span>
              <span className={`rm-r ${r.liveDelta == null ? 'muted' : r.liveDelta > 0 ? 'pos' : r.liveDelta < 0 ? 'neg' : 'muted'}`}>
                {r.liveDelta == null ? '—' : `${r.liveDelta >= 0 ? '+' : ''}${fmtPrice(r.liveDelta)}`}
              </span>
              <span className="rm-r muted">{fmtVolume(r.volume)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sizer__note">“+Rs today” is the gain vs the previous close (from PSX). “Live since watch” is the change since you opened this tab or pressed “Watch from now” — use it to spot a stock rising ~Rs {Number(thresh) || 0} in real time. Green “jump” highlight = it has risen your threshold since you started watching. Verify every idea with the stock’s full analysis; a rise alone is not a signal.</div>
    </div>
  );
}
