import React from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { plainExplain } from '../lib/aiEngine.js';
import { Empty } from './common.jsx';
import { fmtPct, changeClass } from '../utils/format.js';

/**
 * Opportunities / Top Picks — a veteran trader's shortlist.
 * Process (top-down, like a 50-year pro): market regime -> stage -> setup ->
 * conviction. Results live in MarketContext so they PERSIST across tab switches;
 * the user re-runs only by pressing Refresh. Honest and probability-based.
 */
const regimeTone = (state) => (state === 'Risk-On' ? 'pos' : state === 'Risk-Off' ? 'neg' : 'warn');

export default function Opportunities({ onSelect }) {
  const { opportunities, runOpportunityScan, equityRows } = useMarket();
  const { list, scanning, progress, regime, scannedAt } = opportunities;

  const ready = list.filter((x) => x.a.setupValid && x.a.stage?.stage === 2);
  const radar = list.filter((x) => !(x.a.setupValid && x.a.stage?.stage === 2));
  const scannedTime = scannedAt ? new Date(scannedAt).toLocaleString('en-PK', { hour12: true }) : null;

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">Top Picks — a disciplined trader's shortlist</h2>
          <p className="opps__sub">Filtered top-down: market regime → stock stage → setup → conviction. Ranked by conviction, with plain-language reasoning. Probability-based decision support — not a guarantee and not financial advice.</p>
        </div>
        <button className="btn-primary" onClick={runOpportunityScan} disabled={scanning || !equityRows.length}>
          {scanning ? `Scanning… ${progress}%` : scannedAt ? '↻ Refresh Picks' : 'Find Picks (top 60 liquid)'}
        </button>
      </div>

      {regime && (
        <div className={`regime regime--${regimeTone(regime.state)}`}>
          <b>Market regime: {regime.state}</b>
          <span>{regime.detail}</span>
        </div>
      )}

      {(scannedTime || scanning) && (
        <div className="opps__stamp">
          {scanning ? `Scanning the market… ${progress}%` : `Analysis as of ${scannedTime} · ${list.length} picks · click “Refresh Picks” to re-run`}
        </div>
      )}
      {scanning && <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }} /></div>}

      {!list.length && !scanning && (
        <Empty>{scannedAt ? 'No clean long opportunities right now — the market is not offering an edge that meets the rules. Standing aside is a valid, disciplined decision.' : 'Click “Find Picks” to scan the market. Results stay saved when you switch tabs.'}</Empty>
      )}

      {ready.length > 0 && (
        <section>
          <h3 className="opps__group">✅ A-grade — Stage 2 uptrend, all gates passed ({ready.length})</h3>
          <div className="opp-grid">{ready.map((x) => <OppCard key={x.symbol} item={x} onSelect={onSelect} />)}</div>
        </section>
      )}
      {radar.length > 0 && (
        <section>
          <h3 className="opps__group">👀 On the radar — strong, but wait for the right trigger ({radar.length})</h3>
          <div className="opp-grid">{radar.map((x) => <OppCard key={x.symbol} item={x} onSelect={onSelect} />)}</div>
        </section>
      )}
    </div>
  );
}

function OppCard({ item, onSelect }) {
  const { symbol, name, changePct, a, warnings, risky } = item;
  const explain = plainExplain(a);
  return (
    <div className={`opp-card ${risky ? 'opp-card--risky' : ''}`} onClick={() => onSelect(symbol)}>
      <div className="opp-card__top">
        <div className="opp-card__sym">
          <b>{symbol}</b>
          <span className="muted ellipsis">{name || ''}</span>
        </div>
        <div className="opp-score" title="Conviction (0–100): regime + stage + setup + evidence">{a.conviction}</div>
      </div>

      <div className="opp-card__meta">
        <span className={`tier ${risky ? 'tier--warn' : `tier--${a.traderCallTone}`}`}>{risky ? '⚠ Flagged — check warning' : a.traderCall}</span>
        <span className={`chg chg--${changeClass(changePct)}`}>{fmtPct(changePct)}</span>
      </div>
      {(warnings || []).filter((w) => w.severity === 'high').map((w, i) => (
        <div key={i} className="bs-flag bs-flag--high">🚨 <b>{w.type}</b> — {w.text.replace(`${w.type} — `, '')}</div>
      ))}
      {(warnings || []).filter((w) => w.severity === 'medium').map((w, i) => (
        <div key={i} className="bs-flag bs-flag--med">⚠ <b>{w.type}</b> — {w.text.replace(`${w.type} — `, '')}</div>
      ))}
      <div className="opp-chips">
        <span className="opp-chip">{a.stage?.label || 'Stage —'}</span>
        <span className="opp-chip">{a.setupType}</span>
      </div>
      <div className="opp-card__headline">{explain.headline}</div>

      {explain.why.length > 0 && (
        <div className="opp-sec">
          <div className="opp-sec__h pos">Why it looks good</div>
          <ul>{explain.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {explain.watch.length > 0 && (
        <div className="opp-sec">
          <div className="opp-sec__h warn">What to watch</div>
          <ul>{explain.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {a.levels && <TradeLevels levels={a.levels} actionable={a.setupValid && a.stage?.stage === 2} />}
      <div className="opp-action">{explain.action}</div>
    </div>
  );
}

/** Concrete trade levels: buy range, stop, targets, R:R. Used on cards & detail. */
export function TradeLevels({ levels, actionable }) {
  return (
    <div className="levels">
      <div className="levels__status">
        {actionable ? '🟢 Actionable now' : '🟡 Wait for entry — act only inside the buy range'} · <span className="muted">{levels.basis}</span>
      </div>
      <div className="levels__grid">
        <div className="lv lv--buy"><span>Buy Range</span><b>{levels.buyZone[0]} – {levels.buyZone[1]}</b><i>{levels.basis}</i></div>
        <div className="lv lv--stop"><span>Stop Loss</span><b>{levels.stopLoss}</b><i>{levels.stopBasis}</i></div>
        <div className="lv"><span>Risk : Reward</span><b>{levels.riskReward} : 1</b><i>to Target 1</i></div>
        <div className="lv lv--tp"><span>Target 1</span><b>{levels.targets[0].price}</b><i>{levels.targets[0].source}</i></div>
        <div className="lv lv--tp"><span>Target 2</span><b>{levels.targets[1].price}</b><i>{levels.targets[1].source}</i></div>
        <div className="lv lv--tp"><span>Target 3</span><b>{levels.targets[2].price}</b><i>{levels.targets[2].source}</i></div>
      </div>
      <div className="levels__src">Levels derived from this stock's real price history — support/resistance swings, pivot points, Fibonacci & 52-week levels. "nR projection" = risk-multiple where no overhead level exists in the data.</div>
    </div>
  );
}
