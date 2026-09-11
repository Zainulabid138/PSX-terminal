import React, { useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { fmtPrice, fmtVolume, fmtPct, changeClass } from '../utils/format.js';
import { Empty } from './common.jsx';

const COLUMNS = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'name', label: 'Company', align: 'left' },
  { key: 'sectorName', label: 'Sector', align: 'left' },
  { key: 'current', label: 'Price', align: 'right' },
  { key: 'open', label: 'Open', align: 'right' },
  { key: 'high', label: 'High', align: 'right' },
  { key: 'low', label: 'Low', align: 'right' },
  { key: 'changePct', label: 'Change %', align: 'right' },
  { key: 'volume', label: 'Volume', align: 'right' },
];

export default function MarketTable({ onSelect, query }) {
  const { equityRows } = useMarket();
  const [sortKey, setSortKey] = useState('volume');
  const [sortDir, setSortDir] = useState('desc');
  const [sector, setSector] = useState('All');

  const sectors = useMemo(() => {
    const set = new Set();
    equityRows.forEach((r) => r.sectorName && set.add(r.sectorName));
    return ['All', ...Array.from(set).sort()];
  }, [equityRows]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toUpperCase();
    let list = equityRows;
    if (sector !== 'All') list = list.filter((r) => r.sectorName === sector);
    if (q) list = list.filter((r) => r.symbol.includes(q) || (r.name || '').toUpperCase().includes(q));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [equityRows, sector, query, sortKey, sortDir]);

  const setSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'symbol' || key === 'name' ? 'asc' : 'desc'); }
  };

  return (
    <div className="market-table">
      <div className="table-toolbar">
        <div className="filter-group">
          <label>Sector</label>
          <select value={sector} onChange={(e) => setSector(e.target.value)}>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="muted">{filtered.length} symbols</div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.align} onClick={() => setSort(c.key)}>
                  {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.symbol} onClick={() => onSelect(r.symbol)}>
                <td className="left bold">{r.symbol}</td>
                <td className="left muted ellipsis">{r.name || '—'}</td>
                <td className="left muted ellipsis">{r.sectorName || '—'}</td>
                <td className="right">{fmtPrice(r.current)}</td>
                <td className="right">{fmtPrice(r.open)}</td>
                <td className="right">{fmtPrice(r.high)}</td>
                <td className="right">{fmtPrice(r.low)}</td>
                <td className={`right ${changeClass(r.changePct)}`}>{fmtPct(r.changePct)}</td>
                <td className="right">{fmtVolume(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <Empty>No symbols match the current filter.</Empty>}
      </div>
    </div>
  );
}
