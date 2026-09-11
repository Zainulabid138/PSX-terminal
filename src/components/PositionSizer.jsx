import React, { useState, useMemo } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { fmtPrice, fmtVolume } from '../utils/format.js';

/**
 * Position Sizer / Risk Calculator — the single most important discipline in
 * trading. You decide how much of your account you are willing to LOSE on a
 * trade (1–2% is the professional norm); given your entry and stop, it computes
 * exactly how many shares to buy so a stopped-out trade costs no more than that.
 *
 * It can pull the entry/stop straight from a stock's analysis plan. All maths;
 * no fabricated data. It never tells you a trade will win — only how to size it
 * so a loss is survivable.
 */
export default function PositionSizer() {
  const { getAnalysis, equityRows } = useMarket();
  const [account, setAccount] = useState('100000');
  const [riskPct, setRiskPct] = useState('2');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);

  const loadFromAnalysis = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!knownSymbols.includes(sym)) { setLoadMsg('Unknown symbol.'); return; }
    setLoading(true); setLoadMsg('');
    const a = await getAnalysis(sym);
    setLoading(false);
    if (!a || !a.ok) { setLoadMsg('Data unavailable from source.'); return; }
    if (!a.levels) { setLoadMsg(`${sym}: ${a.noLevelsReason || 'No long plan — not a long candidate.'}`); return; }
    const mid = (a.levels.buyZone[0] + a.levels.buyZone[1]) / 2;
    setEntry(String(Math.round(mid * 100) / 100));
    setStop(String(a.levels.stopLoss));
    setTarget(String(a.levels.targets[0].price));
    setLoadMsg(`Loaded ${sym}'s plan (${a.traderCall}). Entry = buy-zone mid, stop & first target from the plan.`);
  };

  const r = useMemo(() => {
    const acc = Number(account); const rp = Number(riskPct); const e = Number(entry); const s = Number(stop); const t = Number(target);
    if (!(acc > 0) || !(rp > 0) || !(e > 0) || !(s > 0)) return null;
    if (s >= e) return { error: 'For a long trade the stop must be BELOW the entry.' };
    const riskPerShare = e - s;
    const maxRisk = acc * (rp / 100);
    const shares = Math.floor(maxRisk / riskPerShare);
    if (shares <= 0) return { error: 'Risk per share is larger than your allowed risk — widen the account/risk or tighten the entry-stop.' };
    const positionValue = shares * e;
    const actualLoss = shares * riskPerShare;
    const lossPctAcc = (actualLoss / acc) * 100;
    const capitalLimited = positionValue > acc;
    const affordableShares = Math.floor(acc / e);
    let reward = null; let rr = null;
    if (t > e) { reward = shares * (t - e); rr = (t - e) / riskPerShare; }
    const flags = [];
    if (rp > 2) flags.push('Risking more than 2% per trade — most professionals cap risk at 1–2%. One bad streak hurts fast.');
    if (positionValue > acc * 0.25) flags.push(`This is ${((positionValue / acc) * 100).toFixed(0)}% of your account in one stock — high concentration. Consider spreading risk.`);
    if (capitalLimited) flags.push(`Risk-based size needs Rs ${Math.round(positionValue).toLocaleString()}, more than your account. You can afford ${affordableShares.toLocaleString()} shares with full capital (larger effective risk).`);
    if (rr != null && rr < 2) flags.push(`Reward:risk to the first target is ${rr.toFixed(2)}:1 — below the 2:1 many traders require.`);
    return { riskPerShare, maxRisk, shares, positionValue, actualLoss, lossPctAcc, reward, rr, flags, affordableShares, capitalLimited };
  }, [account, riskPct, entry, stop, target]);

  return (
    <div className="sizer">
      <h2 className="opps__title">🧮 Position Sizer — how many shares to buy (risk-first)</h2>
      <p className="opps__sub">Decide the most you'll lose on a trade (1–2% of your account is the pro norm). Given your entry and stop, this tells you the exact share count so a stop-out costs no more than that. This is how professionals survive losing trades. Not advice; pure risk maths.</p>

      <div className="sizer__grid">
        <div className="card sizer__inputs">
          <div className="card__head"><span>Your inputs</span></div>
          <div className="sizer__form">
            <label>Account size (Rs)<input type="number" value={account} onChange={(e) => setAccount(e.target.value)} /></label>
            <label>Risk per trade (%)<input type="number" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} /></label>
            <div className="sizer__load">
              <input list="sizer-syms" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol (optional) e.g. HUBC" />
              <datalist id="sizer-syms">{knownSymbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
              <button className="btn-primary" onClick={loadFromAnalysis} disabled={loading}>{loading ? '…' : 'Load plan'}</button>
            </div>
            {loadMsg && <div className="sizer__msg">{loadMsg}</div>}
            <label>Entry price<input type="number" value={entry} onChange={(e) => setEntry(e.target.value)} /></label>
            <label>Stop loss<input type="number" value={stop} onChange={(e) => setStop(e.target.value)} /></label>
            <label>Target (optional)<input type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          </div>
        </div>

        <div className="card sizer__out">
          <div className="card__head"><span>Your plan</span></div>
          {!r && <div className="empty">Fill account, risk %, entry and stop to see your size.</div>}
          {r && r.error && <div className="levels-none">{r.error}</div>}
          {r && !r.error && (
            <div className="sizer__result">
              <div className="sizer__big">
                <div><span>Shares to buy</span><b>{r.shares.toLocaleString()}</b></div>
                <div><span>Capital required</span><b>Rs {Math.round(r.positionValue).toLocaleString()}</b></div>
              </div>
              <div className="sizer__rows">
                <div><span>Risk per share</span><b>Rs {r.riskPerShare.toFixed(2)}</b></div>
                <div><span>Max loss if stopped</span><b className="neg">Rs {Math.round(r.actualLoss).toLocaleString()} ({r.lossPctAcc.toFixed(1)}% of account)</b></div>
                {r.reward != null && <div><span>Profit at target</span><b className="pos">Rs {Math.round(r.reward).toLocaleString()}</b></div>}
                {r.rr != null && <div><span>Reward : Risk</span><b>{r.rr.toFixed(2)} : 1</b></div>}
              </div>
              {r.flags.length > 0 && (
                <div className="sizer__flags">
                  {r.flags.map((f, i) => <div key={i} className="sizer__flag">⚠ {f}</div>)}
                </div>
              )}
              <div className="sizer__note">The share count is set so that if the price hits your stop, you lose only your chosen risk %. Keeping each loss small is what lets you survive the inevitable losing trades. Slippage, gaps and fees can make the real loss slightly larger.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
