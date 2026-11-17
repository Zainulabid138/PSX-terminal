import React, { useEffect, useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { TradeLevels } from './Opportunities.jsx';
import { Empty } from './common.jsx';
import { fmtPct, changeClass } from '../utils/format.js';

const regimeTone = (s) => (s === 'Risk-On' ? 'pos' : s === 'Risk-Off' ? 'neg' : 'warn');

/**
 * Buy Signals — the "act now" screen. It flags stocks in a long-term uptrend
 * whose pullback has just turned back up near the EMA20 (a dip entry, not
 * chasing, not a falling knife). Two groups: YOUR watchlist and NEW market-wide
 * finds. Watchlist turns also fire a desktop alert automatically. Real data,
 * probability-based — always use the stop; not a guarantee.
 */
export default function BuySignals({ onSelect }) {
  const { buySignals, runBuySignalScan, watchlist, equityRows, getRegime } = useMarket();
  const { watch, fresh, scanning, progress, scannedAt } = buySignals;
  const scannedTime = scannedAt ? new Date(scannedAt).toLocaleString('en-PK', { hour12: true }) : null;
  const [regime, setRegime] = useState(null);
  useEffect(() => { getRegime().then(setRegime); }, [getRegime]);

  // Live market breadth — the real reason there may be no buy signals.
  const breadth = useMemo(() => {
    const up = equityRows.filter((r) => (r.changePct || 0) > 0).length;
    const down = equityRows.filter((r) => (r.changePct || 0) < 0).length;
    const total = up + down;
    return { up, down, total, downPct: total ? Math.round((down / total) * 100) : 0, upPct: total ? Math.round((up / total) * 100) : 0 };
  }, [equityRows]);

  const emptyReason = () => {
    const b = breadth;
    if (b.total < 20) return 'Market data still loading — try Refresh in a moment.';
    if (b.downPct >= 60) return `📉 The market is broadly RED today — about ${b.downPct}% of stocks are down${regime?.state === 'Risk-Off' ? ', and the KSE-100 is in a Risk-Off downtrend' : ''}. "Dip turned up" buy signals only appear when a stock STOPS falling and turns back up — so on a down day like today there are almost none. This is exactly right: the app will not hand you a falling knife. Wait for the market to stabilise.`;
    if (b.downPct >= 48) return `The market is mixed today (~${b.downPct}% of stocks down). No stock is showing a clean uptrend-pullback that has turned back up yet. Patience — a forced entry is a bad entry.`;
    return `The market is fairly green today (~${b.upPct}% up), but no stock is at a clean dip-turn entry right now — most are either extended (chasing) or not pulling back. A buy signal needs an uptrend stock whose dip has just turned up near its EMA20.`;
  };

  const Card = ({ x }) => (
    <div className="opp-card" onClick={() => onSelect(x.symbol)}>
      <div className="opp-card__top">
        <div className="opp-card__sym"><b>{x.symbol}</b><span className="muted ellipsis">{x.name || ''}</span></div>
        <div className="opp-score">{x.score}</div>
      </div>
      <div className="opp-card__meta">
        <span className={`tier ${x.risky ? 'tier--warn' : 'tier--buy'}`}>{x.risky ? '⚠ BUY signal — check warning' : '📈 BUY — dip turned up'}</span>
        <span className={`chg chg--${changeClass(x.changePct)}`}>{fmtPct(x.changePct)}</span>
      </div>
      <div className="opp-chips">
        <span className="opp-chip">{x.a.stage?.label}</span>
        <span className="opp-chip">{x.a.bullishProbability}% bullish · {x.a.confidence}% conf</span>
      </div>
      {x.warnings?.filter((w) => w.severity === 'high').map((w, i) => (
        <div key={i} className="bs-flag bs-flag--high">🚨 <b>{w.type}</b> — {w.text.replace(`${w.type} — `, '')}</div>
      ))}
      {x.warnings?.filter((w) => w.severity === 'medium').map((w, i) => (
        <div key={i} className="bs-flag bs-flag--med">⚠ <b>{w.type}</b> — {w.text.replace(`${w.type} — `, '')}</div>
      ))}
      <div className="opp-sec">
        <div className="opp-sec__h pos">Why it's a buy now</div>
        <ul>{x.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
      {x.warnings?.filter((w) => w.severity === 'info').map((w, i) => (
        <div key={i} className="bs-flag bs-flag--info">ℹ {w.type} — {w.text.replace(`${w.type} — `, '')}</div>
      ))}
      {x.caution && <div className="levels-none">⚠ {x.caution}</div>}
      {x.a.levels && <TradeLevels levels={x.a.levels} actionable />}
      <div className="opp-action">Buy inside the range, set the stop, and take profit at the targets. Size it so a stop-out is only 1–2% of your account (use Position Size).</div>
    </div>
  );

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">📈 Buy Signals — dip turned up in an uptrend</h2>
          <p className="opps__sub">Stocks in a long-term uptrend whose pullback has just resumed upward near the EMA20 — a dip entry, not chasing, not a falling knife. Your watchlist turns also alert you automatically. Probability-based; always use the stop.</p>
        </div>
        <button className="btn-primary" onClick={runBuySignalScan} disabled={scanning || !equityRows.length}>
          {scanning ? `Scanning… ${progress}%` : scannedAt ? '↻ Refresh' : 'Scan Buy Signals'}
        </button>
      </div>

      {/* Market condition banner — always shows the context */}
      {breadth.total >= 20 && (
        <div className={`regime regime--${breadth.downPct >= 60 ? 'neg' : breadth.downPct >= 48 ? 'warn' : 'pos'}`}>
          <b>Market today: {breadth.upPct}% up / {breadth.downPct}% down{regime ? ` · KSE-100 ${regime.state}` : ''}</b>
          <span>{breadth.downPct >= 60 ? 'Broadly red — a down day. Buy-the-dip turns are rare when most stocks are falling.' : breadth.downPct >= 48 ? 'Mixed market — be selective.' : 'Broadly green — look for uptrend dips that have turned up.'}</span>
        </div>
      )}

      {(scannedTime || scanning) && (
        <div className="opps__stamp">{scanning ? `Scanning watchlist + market… ${progress}%` : `As of ${scannedTime} · ${watch.length} in your watchlist · ${fresh.length} new`}</div>
      )}
      {scanning && <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }} /></div>}

      {!scanning && scannedAt && !watch.length && !fresh.length && (
        <div className="bs-empty">
          <div className="bs-empty__title">No buy signals right now — and here's why 👇</div>
          <p>{emptyReason()}</p>
          <p className="muted small">Buy signals appear only when an uptrend stock's dip <b>turns back up</b> (flat-to-green near its EMA20) — never while it's still falling. On red days, "no signal" is the correct, disciplined answer.</p>
        </div>
      )}
      {!scannedAt && !scanning && <Empty>Press “Scan Buy Signals”. It checks your watchlist and the market for uptrend dips that just turned up.</Empty>}

      <section>
        <h3 className="opps__group">★ My Watchlist ({watch.length}) {watchlist.length === 0 && <span className="muted small">— add stocks with ☆ Watch to track them here</span>}</h3>
        {watch.length ? <div className="opp-grid">{watch.map((x) => <Card key={x.symbol} x={x} />)}</div> : <Empty>No buy signals in your watchlist right now.</Empty>}
      </section>

      {fresh.length > 0 && (
        <section>
          <h3 className="opps__group">✨ New — found in the market ({fresh.length})</h3>
          <div className="opp-grid">{fresh.map((x) => <Card key={x.symbol} x={x} />)}</div>
        </section>
      )}
    </div>
  );
}
