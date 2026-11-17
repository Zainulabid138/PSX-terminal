import React, { useEffect, useState, useMemo } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { HORIZON_META, marketStance, horizonFit } from '../lib/strategy.js';
import { TradeLevels } from './Opportunities.jsx';
import { Empty, Spinner } from './common.jsx';
import { fmtPct, changeClass } from '../utils/format.js';

/**
 * Investment Planner.
 * Flow: (1) pick a horizon, (2) press "Build Plan" for the app's ranked picks,
 * OR (3) type your OWN symbol in the search bar and "Check" it against that
 * horizon — so you can test any stock (your pick, or a tip you heard) and see
 * honestly whether it fits, with its plan. Real data; not a prediction.
 */
const HORIZONS = ['1M', '3M', '6M', '1Y'];
const regimeTone = (s) => (s === 'Risk-On' ? 'pos' : s === 'Risk-Off' ? 'neg' : 'warn');

export default function Planner({ onSelect }) {
  const { planner, runPlannerScan, getRegime, getAnalysis, equityRows } = useMarket();
  const [horizon, setHorizon] = useState(planner.horizon || '3M');
  const [regime, setRegime] = useState(null);
  const [myQuery, setMyQuery] = useState('');
  const [myResult, setMyResult] = useState(null);
  const [myLoading, setMyLoading] = useState(false);
  const [myMsg, setMyMsg] = useState('');

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);
  useEffect(() => { getRegime().then(setRegime); }, [getRegime]);

  const meta = HORIZON_META[horizon];
  const { list, scanning, progress, scannedAt, horizon: scannedHz } = planner;
  const scannedTime = scannedAt ? new Date(scannedAt).toLocaleString('en-PK', { hour12: true }) : null;
  const showList = scannedHz === horizon;

  const checkMyStock = async () => {
    const sym = myQuery.trim().toUpperCase();
    if (!knownSymbols.includes(sym)) { setMyMsg('Unknown symbol — check the ticker.'); setMyResult(null); return; }
    setMyLoading(true); setMyMsg('');
    const a = await getAnalysis(sym);
    setMyLoading(false);
    if (!a || !a.ok) { setMyResult(null); setMyMsg('Data unavailable / insufficient history from source.'); return; }
    setMyResult({ symbol: sym, a, fit: horizonFit(a, horizon) });
  };

  const whyNot = (a) => {
    const m = a.metrics || {};
    const ltUp = m.ema200 != null && a.price > m.ema200;
    const momWeak = (m.rsi != null && m.rsi < 50) || (m.macd != null && m.macdSignal != null && m.macd < m.macdSignal) || (m.roc10 != null && m.roc10 < 0);
    const deathCross = m.sma50 != null && m.sma200 != null && m.sma50 < m.sma200;
    if (a.stage?.stage === 4) return 'In a Stage 4 downtrend — not suitable for a long plan.';
    if (ltUp && momWeak) return `It's a long-term uptrend stock, but right now it is PULLING BACK — momentum is weak (RSI ${m.rsi != null ? m.rsi.toFixed(0) : '—'}, MACD rolling over${m.roc10 != null && m.roc10 < 0 ? `, 10-day ROC ${m.roc10.toFixed(1)}%` : ''}). Good companies pull back too. Wait for momentum to turn back up before a fresh entry — or hold your existing position with a stop.`;
    if ((horizon === '1Y' || horizon === '6M') && deathCross) return "For a long-term plan it needs a 'golden cross' (SMA50 above SMA200); right now it's the opposite (death cross). Wait for that to flip.";
    if (a.bullishProbability < 55) return `Current momentum is soft (only ${a.bullishProbability}% bullish right now).`;
    if (horizon === '1M') return 'Daily uptrend + Stage 2 (markup) are not both in place yet.';
    if (horizon === '3M') return 'Weekly + daily uptrend are not aligned yet.';
    if (horizon === '6M') return 'Not above the 200-day average with a weekly/monthly uptrend yet.';
    return 'A long-term uptrend (above 200-day + golden cross + monthly up) is not confirmed yet.';
  };

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">📅 Investment Planner — pick your time frame</h2>
          <p className="opps__sub">Select a horizon, then press <b>Build Plan</b> for the app's best-fit stocks — or search <b>your own stock</b> to check if it fits. Real trend analysis, not a prediction or financial advice.</p>
        </div>
      </div>

      {/* Step 1: choose horizon (selection only) */}
      <div className="seg planner-seg">
        {HORIZONS.map((h) => (
          <button key={h} className={horizon === h ? 'active' : ''} onClick={() => setHorizon(h)}>{HORIZON_META[h].label}</button>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: -6 }}>Selected: <b>{meta.label}</b> ({meta.sub}) · basis: {meta.basis} · typical hold: {meta.hold}</div>

      {/* Step 2: two options — build the app plan, OR check your own stock */}
      <div className="planner-bar">
        <button className="btn-primary" onClick={() => runPlannerScan(horizon)} disabled={scanning || !equityRows.length}>
          {scanning ? `Building… ${progress}%` : `🔎 Build Plan (app's picks)`}
        </button>
        <span className="planner-or">or check your own:</span>
        <input list="planner-syms" value={myQuery} onChange={(e) => setMyQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && checkMyStock()} placeholder="Your stock e.g. LOTCHEM" />
        <datalist id="planner-syms">{knownSymbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
        <button className="btn-primary" onClick={checkMyStock} disabled={myLoading}>{myLoading ? '…' : 'Check'}</button>
      </div>
      {myMsg && <div className="sizer__msg">{myMsg}</div>}

      {regime && (
        <div className={`regime regime--${regimeTone(regime.state)}`}>
          <b>Market strategy — KSE-100 is {regime.state}</b>
          <span>{marketStance(regime, horizon)}</span>
        </div>
      )}

      {/* Your own stock's result */}
      {myResult && (
        <section>
          <h3 className="opps__group">Your stock — {myResult.symbol} for {meta.label}</h3>
          <div className="opp-grid">
            <div className="opp-card" onClick={() => onSelect(myResult.symbol)}>
              <div className="opp-card__top">
                <div className="opp-card__sym"><b>{myResult.symbol}</b><span className="muted">Rs {myResult.a.price}</span></div>
                <div className="opp-score">{myResult.fit.ok ? myResult.fit.score : '—'}</div>
              </div>
              <div className={`fit-verdict ${myResult.fit.ok ? 'fit-verdict--ok' : 'fit-verdict--no'}`}>
                {myResult.fit.ok ? `✅ FITS a ${meta.label} plan` : `⚠ Does NOT fit a ${meta.label} plan`}
              </div>
              <div className="opp-chips">
                <span className="opp-chip">{myResult.a.stage?.label}</span>
                <span className="opp-chip">D/W/M: {myResult.a.trend.daily}/{myResult.a.trend.weekly}/{myResult.a.trend.monthly}</span>
                <span className="opp-chip">{myResult.a.bullishProbability}% bullish</span>
                <span className={`tier tier--${myResult.a.traderCallTone}`}>{myResult.a.traderCall}</span>
              </div>
              {myResult.fit.ok ? (
                <div className="opp-sec"><div className="opp-sec__h pos">Why it fits</div><ul>{myResult.fit.why.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
              ) : (
                <div className="opp-sec"><div className="opp-sec__h warn">Why not (yet)</div><ul><li>{whyNot(myResult.a)}</li></ul></div>
              )}
              {myResult.a.levels
                ? <TradeLevels levels={myResult.a.levels} actionable={myResult.a.setupValid && myResult.a.stage?.stage === 2} />
                : <div className="levels-none">{myResult.a.noLevelsReason}</div>}
              <div className="opp-action">
                {myResult.fit.ok
                  ? <><b>Plan ({meta.label}):</b> accumulate on dips into the buy range (not by chasing). Hold ~{meta.hold}. {meta.exit}</>
                  : <>This stock isn't suited to a {meta.label} plan right now. Put it on your watchlist and re-check when the trend improves — don't force it.</>}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* App's ranked picks */}
      {(scannedTime || scanning) && showList && (
        <div className="opps__stamp">
          {scanning ? `Building your ${meta.label} plan… ${progress}%` : `${meta.label} plan · as of ${scannedTime} · ${list.length} stocks fit this horizon`}
        </div>
      )}
      {scanning && <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }} /></div>}

      {!scanning && showList && list.length > 0 && (
        <section>
          <h3 className="opps__group">App's best-fit stocks for {meta.label} ({list.length})</h3>
          <div className="opp-grid">
            {list.map((x) => (
              <div key={x.symbol} className="opp-card" onClick={() => onSelect(x.symbol)}>
                <div className="opp-card__top">
                  <div className="opp-card__sym"><b>{x.symbol}</b><span className="muted ellipsis">{x.name || ''}</span></div>
                  <div className="opp-score">{x.score}</div>
                </div>
                <div className="opp-card__meta">
                  <span className={`tier tier--${x.a.traderCallTone}`}>{x.a.traderCall}</span>
                  <span className={`chg chg--${changeClass(x.changePct)}`}>{fmtPct(x.changePct)}</span>
                </div>
                <div className="opp-chips">
                  <span className="opp-chip">{x.a.stage?.label}</span>
                  <span className="opp-chip">{x.a.relativeStrength.label}</span>
                </div>
                {x.why.length > 0 && (
                  <div className="opp-sec"><div className="opp-sec__h pos">Fits {meta.label} because</div><ul>{x.why.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
                )}
                {x.a.levels && <TradeLevels levels={x.a.levels} actionable={x.a.setupValid && x.a.stage?.stage === 2} />}
                <div className="opp-action"><b>Plan ({meta.label}):</b> accumulate on dips into the buy range. Hold ~{meta.hold}. {meta.exit}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!scanning && (!showList || !list.length) && !myResult && (
        <Empty>Press <b>Build Plan</b> for the app's {meta.label} picks, or search your own stock above.</Empty>
      )}
    </div>
  );
}
