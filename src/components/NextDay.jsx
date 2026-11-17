import React from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { plainExplain } from '../lib/aiEngine.js';
import { TradeLevels } from './Opportunities.jsx';
import { Empty } from './common.jsx';
import { fmtPct, fmtNum, changeClass } from '../utils/format.js';

/**
 * Next-Day Watchlist — an end-of-day scan.
 * Finds stocks that TODAY: closed strong (near the day's high), traded on
 * above-average volume, are up on the day, and have a constructive chart
 * (Stage 2, bullish, conviction). These are candidates to WATCH and, if they
 * confirm on tomorrow's open, buy — with a plan already prepared.
 *
 * Honest: based on today's data only. A gap, news, or a weak open can change
 * everything — always confirm on the open. Not a prediction, not a guarantee.
 */
export default function NextDay({ onSelect }) {
  const { nextDay, runNextDayScan, equityRows } = useMarket();
  const { list, scanning, progress, scannedAt } = nextDay;
  const scannedTime = scannedAt ? new Date(scannedAt).toLocaleString('en-PK', { hour12: true }) : null;

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🌙 Next-Day Watchlist — candidates to watch tomorrow</h2>
          <p className="opps__sub">Stocks that closed strong on above-average volume today and have a constructive chart (Stage 2, bullish). Best run after the close. Watch these tomorrow; buy only if they confirm on the open. Based on today's data — not a prediction or a guarantee.</p>
        </div>
        <button className="btn-primary" onClick={runNextDayScan} disabled={scanning || !equityRows.length}>
          {scanning ? `Scanning close… ${progress}%` : scannedAt ? '↻ Rescan' : "Scan Today's Close"}
        </button>
      </div>

      {(scannedTime || scanning) && (
        <div className="opps__stamp">
          {scanning ? `Analysing today's close… ${progress}%` : `Based on data as of ${scannedTime} · ${list.length} candidates · confirm on tomorrow's open`}
        </div>
      )}
      {scanning && <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }} /></div>}

      {!list.length && !scanning && (
        <Empty>{scannedAt ? 'No strong next-day candidates from today\'s session — nothing closed strong enough on volume with a clean setup. Patience is a position.' : "Click “Scan Today's Close” to build tomorrow's watchlist."}</Empty>
      )}

      <div className="opp-grid">
        {list.map((x) => {
          const explain = plainExplain(x.a);
          return (
            <div key={x.symbol} className="opp-card" onClick={() => onSelect(x.symbol)}>
              <div className="opp-card__top">
                <div className="opp-card__sym"><b>{x.symbol}</b><span className="muted ellipsis">{x.name || ''}</span></div>
                <div className="opp-score" title="Next-day score (0–100)">{x.score}</div>
              </div>
              <div className="opp-card__meta">
                <span className={`tier tier--${x.a.traderCallTone}`}>{x.a.traderCall}</span>
                <span className={`chg chg--${changeClass(x.changePct)}`}>{fmtPct(x.changePct)} today</span>
              </div>
              <div className="opp-chips">
                <span className="opp-chip">Closed {x.closeStrength}% up the range</span>
                <span className="opp-chip">Vol {fmtNum(x.relVol)}× avg</span>
                <span className="opp-chip">{x.a.stage?.label}</span>
                {x.tape && (
                  <span className={`opp-chip ${x.tape.bias === 'buy' ? 'chip--buy' : x.tape.bias === 'sell' ? 'chip--sell' : ''}`}>
                    {x.tape.bias === 'buy' ? `🟢 Accumulation ${x.tape.buyPct}%` : x.tape.bias === 'sell' ? `🔴 Distribution ${x.tape.buyPct}%` : '◻ Mixed tape'}
                  </span>
                )}
              </div>
              <div className="opp-card__headline">{explain.headline}</div>
              {explain.why.length > 0 && (
                <div className="opp-sec">
                  <div className="opp-sec__h pos">Why watch it</div>
                  <ul>{explain.why.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              {x.flags.length > 0 && (
                <div className="opp-sec">
                  <div className="opp-sec__h warn">⚠ Caution</div>
                  <ul>{x.flags.map((f, i) => <li key={i} className="neg">{f}</li>)}</ul>
                </div>
              )}
              {x.a.levels && <TradeLevels levels={x.a.levels} actionable={false} />}
              <div className="opp-action">
                Open plan: buy <b>only if</b> it opens flat-to-up and trades back into/above the buy range in the first 30–60 min (confirmation). <b>Skip</b> if it gaps down, opens below the stop, or fades on the open. Never chase a gap-up.
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
