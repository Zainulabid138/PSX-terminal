import React, { useMemo } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { fmtPct } from '../utils/format.js';
import { Empty } from './common.jsx';

/** Maps a % change to a green/red intensity colour. */
function heatColor(pct) {
  if (pct == null) return 'rgba(120,130,150,0.15)';
  const clamped = Math.max(-5, Math.min(5, pct));
  const intensity = Math.min(1, Math.abs(clamped) / 5);
  if (clamped >= 0) return `rgba(33,208,122,${0.12 + intensity * 0.7})`;
  return `rgba(255,90,95,${0.12 + intensity * 0.7})`;
}

/** A small, recognisable icon per PSX sector (matched by keyword). */
function sectorIcon(name = '') {
  const n = name.toUpperCase();
  const map = [
    ['MODARABA', '💰'], ['INV. BANK', '📈'], ['INVESTMENT', '📈'], ['SECURIT', '📈'],
    ['REAL ESTATE', '🏢'], ['PROPERTY', '🏢'], ['TRANSPORT', '🚆'],
    ['TEXTILE', '🧵'], ['APPAREL', '👕'], ['LEATHER', '👞'],
    ['OIL & GAS MARKET', '⛽'], ['OIL & GAS EXPLOR', '🛢️'], ['REFINER', '🛢️'], ['OIL & GAS', '🛢️'],
    ['TECHNOLOGY', '💻'], ['COMMUNICATION', '📡'],
    ['INSURANCE', '🛡️'], ['POWER', '⚡'], ['FERTILIZER', '🌾'],
    ['AUTOMOBILE ASSEMBLER', '🚗'], ['AUTOMOBILE PART', '🔧'], ['AUTOMOBILE', '🚗'],
    ['PAPER', '📄'], ['BOARD', '📦'], ['MUTUAL FUND', '📊'],
    ['CEMENT', '🏗️'], ['BANK', '🏦'], ['PHARMA', '💊'], ['FOOD', '🍞'], ['SUGAR', '🍬'],
    ['CHEMICAL', '⚗️'], ['ENGINEERING', '⚙️'], ['STEEL', '🔩'], ['GLASS', '🪟'],
    ['TOBACCO', '🚬'], ['CABLE', '🔌'], ['JUTE', '🪢'], ['WOOLLEN', '🧶'],
    ['MISCELLANEOUS', '🧩'], ['FUND', '📊'],
  ];
  for (const [k, icon] of map) if (n.includes(k)) return icon;
  return '🏷️';
}

/**
 * Sector heatmap. Each sector is ranked and coloured by the volume-weighted
 * average % change of its constituents (real data). Header shows an icon, rank,
 * the sector move, and a breadth bar (share of names advancing vs declining).
 * Tiles show the top constituents by volume with a direction arrow.
 */
export default function Heatmap({ onSelect }) {
  const { equityRows } = useMarket();

  const sectors = useMemo(() => {
    const map = new Map();
    for (const r of equityRows) {
      if (!r.sectorName || r.changePct == null) continue;
      if (!map.has(r.sectorName)) map.set(r.sectorName, { name: r.sectorName, stocks: [], wsum: 0, vol: 0, adv: 0, dec: 0 });
      const s = map.get(r.sectorName);
      s.stocks.push(r);
      const w = r.volume || 1;
      s.wsum += r.changePct * w;
      s.vol += w;
      if (r.changePct > 0) s.adv += 1; else if (r.changePct < 0) s.dec += 1;
    }
    return Array.from(map.values())
      .map((s) => ({ ...s, avg: s.vol ? s.wsum / s.vol : 0 }))
      .sort((a, b) => b.avg - a.avg);
  }, [equityRows]);

  if (!sectors.length) return <Empty>No sector data available yet.</Empty>;

  return (
    <div className="heat">
      <div className="heat-legend">
        <span className="muted">Weak</span>
        <span className="heat-legend__bar" />
        <span className="muted">Strong</span>
        <span className="heat-legend__sep" />
        <span className="muted small">Header = sector move (volume-weighted) · bar = % of names advancing · tile = stock</span>
      </div>

      <div className="heatmap">
        {sectors.map((s, idx) => {
          const total = s.adv + s.dec || 1;
          const advPct = (s.adv / total) * 100;
          return (
            <div key={s.name} className="heat-sector">
              <div className="heat-sector__head" style={{ background: heatColor(s.avg) }}>
                <span className="heat-rank">{idx + 1}</span>
                <span className="heat-ico">{sectorIcon(s.name)}</span>
                <span className="heat-name ellipsis" title={s.name}>{s.name}</span>
                <b className="heat-move">{s.avg >= 0 ? '▲' : '▼'} {fmtPct(s.avg)}</b>
              </div>
              <div className="heat-breadth" title={`${s.adv} up · ${s.dec} down`}>
                <div className="heat-breadth__adv" style={{ width: `${advPct}%` }} />
                <span className="heat-breadth__txt">{s.adv}▲ / {s.dec}▼</span>
              </div>
              <div className="heat-tiles">
                {s.stocks
                  .slice()
                  .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                  .slice(0, 12)
                  .map((r) => (
                    <div
                      key={r.symbol}
                      className="heat-tile"
                      style={{ background: heatColor(r.changePct) }}
                      title={`${r.symbol}  ${fmtPct(r.changePct)}`}
                      onClick={() => onSelect(r.symbol)}
                    >
                      <span className="heat-tile__sym">{r.symbol}</span>
                      <small>{r.changePct >= 0 ? '▲' : '▼'} {fmtPct(r.changePct, false)}</small>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
