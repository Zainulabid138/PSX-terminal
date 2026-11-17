import React, { useEffect, useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { marketOutlook } from '../lib/marketOutlook.js';
import { Empty, Spinner } from './common.jsx';

/**
 * Market Analysis — a professional, forward read of the whole market (KSE-100):
 * is it down or up now, how far it could fall (supports), and what has to happen
 * — and roughly when — for it to turn up (reclaim levels). Honest: direction is
 * conditional + probability-based, never an exact date.
 */
const n0 = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-PK'));

export default function MarketOutlook({ onSelect }) {
  const { getAnalysis, getRegime, getIndexQuote, equityRows, hasBridge } = useMarket();
  const [o, setO] = useState(undefined); // undefined=loading, null=unavailable
  const [reloadKey, setReloadKey] = useState(0);

  const breadth = useMemo(() => {
    const up = equityRows.filter((r) => (r.changePct || 0) > 0).length;
    const down = equityRows.filter((r) => (r.changePct || 0) < 0).length;
    const tot = up + down;
    return { up, down, upPct: tot ? Math.round((up / tot) * 100) : 0, downPct: tot ? Math.round((down / tot) * 100) : 0 };
  }, [equityRows]);

  useEffect(() => {
    let alive = true;
    setO(undefined);
    if (!hasBridge) { setO(null); return () => {}; }
    (async () => {
      const [a, regime, quote] = await Promise.all([
        getAnalysis('KSE100').catch(() => null),
        getRegime().catch(() => null),
        getIndexQuote('KSE100').catch(() => null),
      ]);
      if (!alive) return;
      setO(marketOutlook(a, regime, breadth, quote));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAnalysis, getRegime, getIndexQuote, reloadKey]);

  const toneClass = { buy: 'mo-head--up', sell: 'mo-head--down', neutral: 'mo-head--neutral' };
  const biasColor = (t) => (t === 'buy' ? 'pos' : t === 'sell' ? 'neg' : 'warn');

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🧭 Market Analysis — KSE-100 outlook</h2>
          <p className="opps__sub">Where the whole market stands, how far it could fall, and what must happen (and roughly when) for it to turn up. Probability-based — not an exact-date prediction.</p>
        </div>
        <button className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>↻ Refresh</button>
      </div>

      {o === undefined && <div className="loading-pad"><Spinner /> Analysing the market…</div>}
      {o === null && <Empty>Market data unavailable right now. Try Refresh in a moment.</Empty>}

      {o && (
        <>
          <div className={`mo-head ${toneClass[o.tone]}`}>
            <div className="mo-head__top">
              <div>
                <div className="mo-head__idx">KSE-100 <b>{n0(o.value)}</b>
                  {o.changePct != null && <span className={o.changePct >= 0 ? 'pos' : 'neg'}> {o.changePct >= 0 ? '▲' : '▼'} {o.changePct >= 0 ? '+' : ''}{o.changePct.toFixed(2)}%</span>}
                </div>
                <div className="muted small">{o.phase}{o.asOf ? ` · as of ${new Date(o.asOf * 1000).toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short' })}` : ''}</div>
              </div>
              <span className={`mo-bias mo-bias--${o.tone}`}>{o.bias}</span>
            </div>
            <div className="mo-head__line">{o.headline}</div>
            <div className="mo-prob">Bias: <b className={biasColor(o.tone)}>{o.bull}% up / {o.bear}% down</b></div>
          </div>

          {/* Next session — the if-then to watch at the open */}
          <div className={`mo-next mo-next--${o.nextSession.leanTone}`}>
            <div className="mo-next__head">
              <span className="mo-next__title">🔮 Next session — what to watch</span>
              <span className={`mo-bias mo-bias--${o.nextSession.leanTone}`}>{o.nextSession.leanText}</span>
            </div>
            <div className="mo-next__grid">
              <div className="mo-next__card mo-next__card--up">
                <div className="mo-next__k">🟢 If it goes UP</div>
                <div className="mo-next__v">{o.nextSession.upTrigger}</div>
                <div className="muted small">→ next target ~{o.nextSession.upTarget}</div>
              </div>
              <div className="mo-next__card mo-next__card--down">
                <div className="mo-next__k">🔴 If it goes DOWN</div>
                <div className="mo-next__v">{o.nextSession.downTrigger}</div>
                <div className="muted small">→ pullback toward ~{o.nextSession.downTarget}</div>
              </div>
            </div>
            <div className="mo-next__watch">
              👁 Key levels to watch: support <b className="neg">{n0(o.nextSession.watchSupport)}</b> · resistance <b className="pos">{n0(o.nextSession.watchResist)}</b>
            </div>
            <div className="mo-next__action">🎯 {o.nextSession.action}</div>
          </div>

          {/* Forward view */}
          <div className="card">
            <div className="card__head"><span>📈 What's likely next</span></div>
            <div className="mo-sec">
              <p className="mo-forward">{o.forward}</p>
              <div className="mo-kv"><span>⏳ Timeframe</span><b>{o.timeframe}</b></div>
              <div className="mo-kv"><span>🎯 What a trader should do</span><b className={biasColor(o.tone)}>{o.whatToDo}</b></div>
            </div>
          </div>

          {/* Levels */}
          <div className="mo-levels">
            <div className="card">
              <div className="card__head"><span>📉 If it falls — support levels</span></div>
              <div className="mo-list">
                {o.downLevels.length ? o.downLevels.map((l, i) => (
                  <div key={i} className="mo-row"><span className="muted">{l.label}</span><b className="neg">{n0(l.value)}</b></div>
                )) : <div className="mo-row muted">No clear support below — at/near lows.</div>}
              </div>
            </div>
            <div className="card">
              <div className="card__head"><span>📈 To turn up — reclaim levels</span></div>
              <div className="mo-list">
                {o.upLevels.length ? o.upLevels.map((l, i) => (
                  <div key={i} className="mo-row"><span className="muted">{l.label}</span><b className="pos">{n0(l.value)}</b></div>
                )) : <div className="mo-row muted">At/near highs — in blue-sky territory.</div>}
              </div>
            </div>
          </div>

          {/* Context */}
          <div className="card">
            <div className="card__head"><span>🔎 Market context</span></div>
            <div className="mo-sec">
              <ul className="mo-ctx">{o.context.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          </div>

          <div className="sizer__note">⚖ {o.caveat}</div>
        </>
      )}
    </div>
  );
}
