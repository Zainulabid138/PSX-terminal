import React from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { getMarketStatus, pktTimeString } from '../utils/marketStatus.js';
import { fmtPrice, fmtVolume, fmtPct, changeClass } from '../utils/format.js';
import { downloadCSV } from '../utils/csv.js';
import { Empty } from './common.jsx';

function exportRadar(log) {
  downloadCSV('psx-radar-alerts.csv', log.map((e) => ({
    time: new Date(e.at).toLocaleString('en-PK'), symbol: e.symbol, price: e.price,
    intervalMovePct: e.dPct?.toFixed(2), volSurgeX: e.surge?.toFixed(1), dayChangePct: e.changePct?.toFixed(2),
    buyPct: e.buyPct ?? '', biggestTrade: e.biggest ?? '',
  })));
}

/**
 * Live Momentum Radar — intraday spike scanner (the "20 → 20.50 with volume" idea).
 * Reads the live market snapshot every refresh and flags stocks that are rising
 * NOW on a burst of volume at/near a new intraday high, with a desktop + sound
 * alert. Shows a scalp-style entry / tight stop / quick target for each.
 *
 * Honest framing (shown in the UI): near-real-time (a few seconds), the app only
 * ALERTS — you place the order yourself — and quick "1-rupee" scalps are high-risk
 * because of latency, spread and sudden reversals.
 */
const sgn = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');

/** Plain-language explanation of why a radar alert fired, from its stored data. */
function alertWhy(e) {
  const tape = e.buyPct != null
    ? ` Tape confirmed LARGE BUYERS in control (${e.buyPct}% buy pressure${e.biggest ? `, biggest single trade ${e.biggest.toLocaleString()} sh @ ${e.biggestPrice}` : ''}).`
    : '';
  return `Why: price ticked ${sgn(e.dPct)} in a ~10-sec interval on ${e.surge.toFixed(1)}× its normal volume, at a new intraday high.${tape} It was ${sgn(e.changePct)} on the day. Strong momentum + big buying — still not a guarantee; use a tight stop and take profit quickly.`;
}

/** Group the persistent radar log by calendar day (newest day first). */
function groupByDay(log) {
  const groups = new Map();
  for (const e of log) {
    const key = new Date(e.at).toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return Array.from(groups.entries()); // insertion order = newest first (log is prepended)
}

export default function LiveRadar({ onSelect }) {
  const { radar, radarLog, radarMode, setRadarMode, watchlist } = useMarket();
  const status = getMarketStatus();
  const { list, updatedAt, warming } = radar;
  const history = groupByDay(radarLog || []);

  return (
    <div className="radar">
      <div className="radar__head">
        <div>
          <h2 className="opps__title">⚡ Live Momentum Radar</h2>
          <p className="opps__sub">Catches stocks rising right now on a sudden volume burst at a new intraday high — and alerts you (desktop + sound). Near-real-time decision support, not an order system. Quick scalps carry real latency/spread/reversal risk.</p>
        </div>
        <div className="radar-head-right">
          <div className="seg">
            <button className={radarMode === 'all' ? 'active' : ''} onClick={() => setRadarMode('all')}>All Market</button>
            <button className={radarMode === 'watchlist' ? 'active' : ''} onClick={() => setRadarMode('watchlist')}>My Watchlist</button>
          </div>
          <div className="clock">
            <span className={`status-dot status-dot--${status.open ? 'open' : 'closed'}`} />
            <span className="status-label">{status.label}</span>
            <span className="muted">{pktTimeString()}</span>
          </div>
        </div>
      </div>

      {radarMode === 'watchlist' && (
        <div className="opps__stamp">
          Radar scope: <b>My Watchlist</b> ({watchlist.length} symbol{watchlist.length !== 1 ? 's' : ''}).{watchlist.length === 0 ? ' Add stocks from any detail page (☆ Watch) to track them here.' : ' Only these are scanned for spikes.'}
        </div>
      )}

      {!status.open && (
        <div className="regime regime--warn">
          <b>Market is closed</b>
          <span>The radar runs live only during PSX hours (09:30–15:30 PKT, Mon–Fri). It will start automatically when the market opens.</span>
        </div>
      )}
      {status.open && warming && (
        <div className="regime regime--warn">
          <b>Warming up…</b>
          <span>Collecting a few live snapshots to learn each stock's normal volume pace. Spikes will appear within ~30–40 seconds.</span>
        </div>
      )}

      {updatedAt && <div className="opps__stamp">Live · updated {new Date(updatedAt).toLocaleTimeString('en-PK', { hour12: true })} · scanning every refresh</div>}

      {status.open && !warming && !list.length && (
        <Empty>No momentum spikes right now. The radar is watching — an alert will fire the moment a stock jumps on volume.</Empty>
      )}

      {list.length > 0 && (
        <div className="radar-list">
          {list.map((h) => {
            const stop = Math.round(h.price * 0.985 * 100) / 100;
            const t1 = Math.round(h.price * 1.01 * 100) / 100;
            const tapeBias = h.tape ? h.tape.bias : 'pending';
            return (
              <div key={h.symbol} className={`radar-row radar-row--${tapeBias}`} onClick={() => onSelect(h.symbol)}>
                <div className="radar-row__main">
                  <div className="radar-row__sym"><b>{h.symbol}</b><span className="muted ellipsis">{h.name || ''}</span></div>
                  <div className="radar-badges">
                    {h.tape ? (
                      h.tape.bias === 'buy' ? <span className="rb rb--strong">🟢 LARGE BUYING · {h.tape.buyPct}%</span>
                        : h.tape.bias === 'sell' ? <span className="rb rb--sell">🔴 LARGE SELLING — avoid</span>
                          : <span className="rb rb--mixed">◻ Mixed tape</span>
                    ) : <span className="rb rb--mixed">reading tape…</span>}
                    <span className="rb rb--up">▲ +{h.dPct.toFixed(2)}% now</span>
                    <span className="rb rb--vol">vol {h.surge.toFixed(1)}×</span>
                    <span className={`rb chg--${changeClass(h.changePct)}`}>{fmtPct(h.changePct)} today</span>
                  </div>
                </div>
                <div className="radar-row__plan">
                  <div className="lv lv--buy"><span>Price now</span><b>{fmtPrice(h.price)}</b></div>
                  <div className="lv"><span>Interval vol</span><b>{fmtVolume(h.vDelta)}</b></div>
                  <div className="lv lv--tp"><span>Quick target (+1%)</span><b>{t1}</b></div>
                  <div className="lv lv--stop"><span>Tight stop (−1.5%)</span><b>{stop}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="radar-note">
        How it works: each refresh is compared to the previous one. A stock is flagged when — at the same moment — its price is rising, the volume traded in that interval is ≥ 3× its own recent pace, and it is at/near a new intraday high. This surfaces momentum; it does not predict that the move will continue. Always use the stop and take profits quickly — momentum can reverse in seconds.
      </div>

      {/* Persistent alert history — saved, day-wise, last 4 days only */}
      <div className="card">
        <div className="card__head">
          <span>Alert History (saved · last 4 days)</span>
          {radarLog.length > 0 && <button className="link-btn" onClick={() => exportRadar(radarLog)}>Export CSV</button>}
        </div>
        {!history.length && <Empty>No radar alerts recorded yet. They will be saved here — grouped by day — as they fire during market hours.</Empty>}
        {history.map(([day, entries]) => (
          <div key={day} className="hist-day">
            <div className="hist-day__head">{day} <span className="muted">· {entries.length} alert{entries.length > 1 ? 's' : ''}</span></div>
            {entries.map((e, i) => (
              <div key={i} className="hist-entry">
                <div className="hist-row" onClick={() => onSelect(e.symbol)}>
                  <span className="muted hist-time">{new Date(e.at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                  <b className="hist-sym">{e.symbol}</b>
                  <span className="hist-px">@ {fmtPrice(e.price)}</span>
                  <span className="rb rb--up">▲ +{e.dPct.toFixed(2)}%</span>
                  <span className="rb rb--vol">vol {e.surge.toFixed(1)}×</span>
                  <span className={`chg--${changeClass(e.changePct)}`}>{fmtPct(e.changePct)} day</span>
                  <span className="hist-open">open →</span>
                </div>
                <div className="hist-why">{alertWhy(e)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
