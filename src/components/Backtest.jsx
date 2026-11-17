import React, { useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { backtest, aggregate } from '../lib/backtest.js';
import { Empty, Spinner } from './common.jsx';

/**
 * Backtest — honestly measure whether the trend/momentum buy rule had an edge
 * on a stock's real history (no look-ahead). Run one symbol or your whole
 * watchlist (aggregated). Results are indicative, not a promise of the future.
 */
export default function Backtest() {
  const { equityRows, watchlist } = useMarket();
  const [symbol, setSymbol] = useState('');
  const [horizon, setHorizon] = useState('10');
  const [result, setResult] = useState(null);
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);
  const hz = Math.max(3, Math.min(30, Number(horizon) || 10));

  const runOne = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!knownSymbols.includes(sym)) { setMsg('Unknown symbol.'); return; }
    setBusy(true); setMsg(''); setResult(null);
    const res = await window.psx.getEod(sym);
    setBusy(false);
    if (!res.ok) { setMsg('Data unavailable from source.'); return; }
    const closes = res.data.map((d) => d.close).filter((v) => v != null);
    const r = backtest(closes, { horizon: hz });
    setScope(`${sym} · ${closes.length} daily bars`);
    setResult(r);
  };

  const runWatchlist = async () => {
    if (!watchlist.length) { setMsg('Your watchlist is empty — add stocks first.'); return; }
    setBusy(true); setMsg(''); setResult(null);
    const results = [];
    for (const sym of watchlist) {
      // eslint-disable-next-line no-await-in-loop
      const res = await window.psx.getEod(sym);
      if (!res.ok) continue;
      const closes = res.data.map((d) => d.close).filter((v) => v != null);
      results.push(backtest(closes, { horizon: hz }));
    }
    setBusy(false);
    setScope(`Watchlist · ${watchlist.length} symbols`);
    setResult(aggregate(results));
  };

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🔬 Strategy Backtest — did the signal have an edge?</h2>
          <p className="opps__sub">Tests the trend/momentum buy rule (Stage 2 + EMA20&gt;EMA50 + RSI/MACD) on real history with a mechanical 2:1 exit, using only past data at each point (no look-ahead). Indicative, not a promise — see the assumptions below.</p>
        </div>
      </div>

      <div className="card">
        <div className="bt-form">
          <input list="bt-syms" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol e.g. OGDC" />
          <datalist id="bt-syms">{knownSymbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
          <label className="bt-hz">Hold up to <input type="number" value={horizon} onChange={(e) => setHorizon(e.target.value)} /> days</label>
          <button className="btn-primary" onClick={runOne} disabled={busy}>Backtest symbol</button>
          <button className="link-btn" onClick={runWatchlist} disabled={busy}>Backtest my watchlist ({watchlist.length})</button>
        </div>
        {msg && <div className="sizer__msg" style={{ padding: '0 16px 12px' }}>{msg}</div>}
      </div>

      {busy && <Spinner label="Running backtest on real history…" />}

      {result && !busy && (
        <div className="card">
          <div className="card__head"><span>Result — {scope}</span></div>
          {result.error && <Empty>{result.error}</Empty>}
          {!result.error && result.trades === 0 && <Empty>No signals triggered in the available history for this scope.</Empty>}
          {!result.error && result.trades > 0 && (
            <div className="bt-result">
              <div className="jr-stats">
                <div className="stat-card"><div className="stat-card__label">Signals / trades</div><div className="stat-card__value">{result.trades}</div><div className="stat-card__sub">{result.wins}W / {result.losses}L</div></div>
                <div className={`stat-card ${result.winRate >= 50 ? 'stat-card--pos' : ''}`}><div className="stat-card__label">Win rate</div><div className="stat-card__value">{result.winRate.toFixed(0)}%</div></div>
                <div className={`stat-card ${result.profitFactor >= 1 ? 'stat-card--pos' : 'stat-card--neg'}`}><div className="stat-card__label">Profit factor</div><div className="stat-card__value">{result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}</div></div>
                <div className={`stat-card ${result.avgR >= 0 ? 'stat-card--pos' : 'stat-card--neg'}`}><div className="stat-card__label">Avg result / trade</div><div className="stat-card__value">{result.avgR >= 0 ? '+' : ''}{result.avgR.toFixed(2)}R</div>{result.totalR != null && <div className="stat-card__sub">total {result.totalR >= 0 ? '+' : ''}{result.totalR.toFixed(1)}R</div>}</div>
              </div>
              <div className="bt-read">
                {result.profitFactor >= 1.3 && result.winRate >= 45
                  ? '✅ On this history the rule showed a positive edge (profit factor > 1.3). Still no guarantee it repeats.'
                  : result.profitFactor >= 1
                    ? '🟡 Marginal edge on this history — not strong. Treat with caution.'
                    : '🔴 No positive edge on this history — the rule lost money here. Do not rely on it for this scope.'}
              </div>
            </div>
          )}
          <div className="sizer__note">
            Assumptions: entry at the signal day's close; stop −1R, target +2R with R = {result.stopFrac ? (result.stopFrac * 100).toFixed(1) + '%' : '~volatility'} of price; exits checked on the daily CLOSE (real intraday hits not modelled — so results are approximate/optimistic); no brokerage, tax, slippage or dividends; non-overlapping trades. A single stock is a small sample. Past performance does not predict future results.
          </div>
        </div>
      )}
    </div>
  );
}
