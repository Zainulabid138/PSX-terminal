import React from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { fmtPrice, fmtVolume, fmtPct, changeClass } from '../utils/format.js';
import { Empty } from './common.jsx';

export default function Watchlist({ onSelect }) {
  const { watchlist, equityRows, toggleWatch } = useMarket();
  const rows = watchlist
    .map((sym) => equityRows.find((r) => r.symbol === sym) || { symbol: sym })
    .filter(Boolean);

  if (!watchlist.length) {
    return <Empty>Your watchlist is empty. Open any stock and click ☆ Watch to add it.</Empty>;
  }

  return (
    <div className="market-table">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="left">Symbol</th>
              <th className="left">Company</th>
              <th className="right">Price</th>
              <th className="right">Change %</th>
              <th className="right">Volume</th>
              <th className="right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="left bold" onClick={() => onSelect(r.symbol)}>{r.symbol}</td>
                <td className="left muted ellipsis" onClick={() => onSelect(r.symbol)}>{r.name || '—'}</td>
                <td className="right" onClick={() => onSelect(r.symbol)}>{fmtPrice(r.current)}</td>
                <td className={`right ${changeClass(r.changePct)}`} onClick={() => onSelect(r.symbol)}>{fmtPct(r.changePct)}</td>
                <td className="right" onClick={() => onSelect(r.symbol)}>{fmtVolume(r.volume)}</td>
                <td className="right"><button className="link-btn" onClick={() => toggleWatch(r.symbol)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
