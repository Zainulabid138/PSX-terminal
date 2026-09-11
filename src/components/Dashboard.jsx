import React, { useEffect, useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { StatCard, Empty } from './common.jsx';
import { fmtPrice, fmtVolume, fmtPct, changeClass } from '../utils/format.js';
import Heatmap from './Heatmap.jsx';

const INDICES = [['KSE100', 'KSE-100'], ['KMI30', 'KMI-30 · Islamic'], ['ALLSHR', 'All Share']];
const idxDate = (t) => (t ? new Date(t * 1000).toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '');
const bigNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Live index board — the current PSX index level, change vs last close, and the last data date. */
function IndexBoard() {
  const { getIndexQuote, hasBridge } = useMarket();
  const [q, setQ] = useState({});

  useEffect(() => {
    if (!hasBridge) return;
    let alive = true;
    (async () => {
      for (const [sym] of INDICES) {
        const s = await getIndexQuote(sym).catch(() => null);
        if (alive && s) setQ((o) => ({ ...o, [sym]: s }));
      }
    })();
    return () => { alive = false; };
  }, [getIndexQuote, hasBridge]);

  const asOf = q.KSE100 ? idxDate(q.KSE100.date) : null;
  return (
    <div className="index-board">
      <div className="index-board__row">
        {INDICES.map(([sym, label]) => {
          const s = q[sym];
          const up = s && s.change != null && s.change >= 0;
          return (
            <div key={sym} className={`index-card ${s ? (up ? 'index-card--up' : 'index-card--down') : ''}`}>
              <div className="index-card__label">{label}</div>
              <div className="index-card__val">{s ? bigNum(s.value) : '…'}</div>
              <div className={`index-card__chg ${s ? (up ? 'pos' : 'neg') : 'muted'}`}>
                {s && s.change != null ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${bigNum(s.change)} (${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%)` : ''}
              </div>
            </div>
          );
        })}
      </div>
      {asOf && <div className="index-board__asof">Last data point: <b>{asOf}</b> · {q.KSE100.change >= 0 ? 'market closed up' : 'market closed down'} on the day (end-of-day close from PSX)</div>}
    </div>
  );
}

/** Small ranked list (gainers / losers / most active). */
function MiniList({ title, rows, valueKey, fmt, onSelect }) {
  return (
    <div className="card mini-list">
      <div className="card__head"><span>{title}</span></div>
      <div className="mini-list__body">
        {rows.length ? rows.map((r) => (
          <div key={r.symbol} className="mini-row" onClick={() => onSelect(r.symbol)}>
            <span className="bold">{r.symbol}</span>
            <span className="muted ellipsis">{r.name || ''}</span>
            <span className={`mini-val ${valueKey === 'changePct' ? changeClass(r.changePct) : ''}`}>{fmt(r[valueKey])}</span>
          </div>
        )) : <Empty>No data.</Empty>}
      </div>
    </div>
  );
}

export default function Dashboard({ onSelect }) {
  const { equityRows, fetchedAt } = useMarket();

  const stats = useMemo(() => {
    const total = equityRows.length;
    const advancers = equityRows.filter((r) => (r.changePct || 0) > 0).length;
    const decliners = equityRows.filter((r) => (r.changePct || 0) < 0).length;
    const unchanged = total - advancers - decliners;
    const totalVol = equityRows.reduce((a, r) => a + (r.volume || 0), 0);

    const gainers = [...equityRows].filter((r) => r.changePct != null).sort((a, b) => b.changePct - a.changePct).slice(0, 8);
    const losers = [...equityRows].filter((r) => r.changePct != null).sort((a, b) => a.changePct - b.changePct).slice(0, 8);
    const active = [...equityRows].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 8);
    return { total, advancers, decliners, unchanged, totalVol, gainers, losers, active };
  }, [equityRows]);

  if (!equityRows.length) return <Empty>Waiting for live market data from the PSX source…</Empty>;

  return (
    <div className="dashboard">
      <IndexBoard />
      <div className="stat-row">
        <StatCard label="Listed Symbols (equity)" value={stats.total} sub="from PSX market-watch" />
        <StatCard label="Advancing" value={stats.advancers} tone="pos" sub={`${stats.unchanged} unchanged`} />
        <StatCard label="Declining" value={stats.decliners} tone="neg" />
        <StatCard label="Total Volume" value={fmtVolume(stats.totalVol)} sub="all equities today" />
      </div>

      <div className="dash-grid">
        <MiniList title="Top Gainers" rows={stats.gainers} valueKey="changePct" fmt={fmtPct} onSelect={onSelect} />
        <MiniList title="Top Losers" rows={stats.losers} valueKey="changePct" fmt={fmtPct} onSelect={onSelect} />
        <MiniList title="Most Active" rows={stats.active} valueKey="volume" fmt={fmtVolume} onSelect={onSelect} />
      </div>

      <div className="card">
        <div className="card__head"><span>Sector Heatmap (volume-weighted % change)</span></div>
        <Heatmap onSelect={onSelect} />
      </div>
    </div>
  );
}
