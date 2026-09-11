import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { holdingStrategy } from '../lib/strategy.js';
import { portfolioHealth } from '../lib/portfolioHealth.js';
import { fmtPrice, shariahStatus } from '../utils/format.js';
import { downloadCSV } from '../utils/csv.js';
import { Empty } from './common.jsx';

/**
 * Portfolio — add the stocks you already own (symbol, quantity, average buy
 * price). The app shows live P/L per holding AND runs the real analysis engine
 * to give a strategy verdict against each position: Hold / Add-on-dips /
 * Trim / Reduce-Exit, with a suggested stop and the reason. It also totals your
 * whole book and flags concentration and downtrend (Stage-4) exposure.
 * Honest: P/L excludes fees/taxes; verdicts are probability-based, not advice.
 */
const rs = (n) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const toneClass = { buy: 'pf-badge--buy', sell: 'pf-badge--sell', neutral: 'pf-badge--neutral' };

const lotsOf = (h) => (h.lots ? h.lots : [{ id: `${h.symbol}-legacy`, qty: h.qty, price: h.avgCost, at: h.addedAt || 0 }]);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export default function Portfolio({ onSelect }) {
  const { holdings, addHolding, removeLot, removeHolding, setHoldingStop, getAnalysis, equityRows, hasBridge } = useMarket();
  const [f, setF] = useState({ symbol: '', qty: '', avgCost: '' });
  const [analyses, setAnalyses] = useState({}); // symbol -> analysis
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);
  const rowOf = (sym) => equityRows.find((x) => x.symbol === sym);
  const priceOf = (sym) => { const r = rowOf(sym); return r ? r.current : null; };
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Fetch the analysis for every holding (cached 5 min in context, so cheap).
  const loadStrategies = async () => {
    if (!holdings.length || !hasBridge) return;
    const token = ++reqRef.current;
    setBusy(true);
    const out = {};
    for (const h of holdings) {
      const a = await getAnalysis(h.symbol).catch(() => null);
      if (token !== reqRef.current) return; // superseded
      out[h.symbol] = a;
    }
    if (token === reqRef.current) { setAnalyses(out); setBusy(false); }
  };

  useEffect(() => {
    if (holdings.length && equityRows.length) loadStrategies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, equityRows.length]);

  const canAdd = f.symbol.trim() && Number(f.qty) > 0 && Number(f.avgCost) > 0;
  const submit = () => {
    if (!canAdd) return;
    addHolding({ symbol: f.symbol, qty: Number(f.qty), avgCost: Number(f.avgCost) });
    setF({ symbol: '', qty: '', avgCost: '' });
  };

  // Per-holding rows + portfolio totals. Quantity and average cost are DERIVED
  // from the individual buy lots (weighted average), so every purchase is kept.
  const rows = useMemo(() => holdings.map((h) => {
    const lots = lotsOf(h);
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    const invested = lots.reduce((s, l) => s + l.qty * l.price, 0);
    const avgCost = qty > 0 ? invested / qty : 0;
    const price = priceOf(h.symbol);
    const value = price != null ? qty * price : null;
    const pl = value != null ? value - invested : null;
    const plPct = price != null && avgCost ? ((price - avgCost) / avgCost) * 100 : null;
    const adv = holdingStrategy(analyses[h.symbol], avgCost, price ?? avgCost);
    const sh = shariahStatus(rowOf(h.symbol)?.listedIn);
    return { ...h, lots, qty, avgCost, price, invested, value, pl, plPct, adv, sh };
  }), [holdings, analyses, equityRows]);

  const totals = useMemo(() => {
    let invested = 0; let value = 0; let priced = 0; let downtrend = 0;
    for (const r of rows) {
      invested += r.invested;
      if (r.value != null) { value += r.value; priced += 1; if (r.adv.tone === 'sell') downtrend += r.value; }
    }
    const pl = value - invested;
    return { invested, value, pl, plPct: invested ? (pl / invested) * 100 : 0, priced, downtrendPct: value ? (downtrend / value) * 100 : 0 };
  }, [rows]);

  const withAlloc = rows.map((r) => ({ ...r, alloc: totals.value && r.value != null ? (r.value / totals.value) * 100 : null }));
  const health = portfolioHealth(withAlloc);

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">📁 My Portfolio</h2>
          <p className="opps__sub">Add what you own — the app gives a strategy against each holding (Hold / Add / Trim / Reduce-Exit) from the live analysis, plus your total P/L and risk flags. P/L excludes brokerage &amp; taxes. Not financial advice.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {holdings.length > 0 && <button className="link-btn" onClick={loadStrategies} disabled={busy}>{busy ? 'Analysing…' : '↻ Refresh strategy'}</button>}
          {holdings.length > 0 && (
            <button className="link-btn" onClick={() => downloadCSV('psx-portfolio.csv', withAlloc.flatMap((r) => r.lots.map((l, i) => ({
              symbol: r.symbol, lot: i + 1, lotQty: l.qty, lotPrice: l.price, boughtOn: fmtDate(l.at),
              totalQty: r.qty, avgCost: r.avgCost.toFixed(2), price: r.price ?? '', invested: Math.round(r.invested),
              value: r.value != null ? Math.round(r.value) : '', pl: r.pl != null ? Math.round(r.pl) : '',
              plPct: r.plPct != null ? r.plPct.toFixed(2) : '', action: r.adv.action, stop: r.adv.stop ?? '',
            }))))}>Export CSV</button>
          )}
        </div>
      </div>

      {/* Add holding */}
      <div className="card">
        <div className="card__head"><span>Add a holding</span></div>
        <div className="journal__form">
          <input list="pf-syms" value={f.symbol} onChange={(e) => set('symbol', e.target.value)} placeholder="Symbol (e.g. AIRLINK)" />
          <datalist id="pf-syms">{knownSymbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
          <input type="number" value={f.qty} onChange={(e) => set('qty', e.target.value)} placeholder="Quantity (shares)" />
          <input type="number" value={f.avgCost} onChange={(e) => set('avgCost', e.target.value)} placeholder="Buy price (this lot)" />
          <button className="btn-primary" disabled={!canAdd} onClick={submit}>Add buy</button>
        </div>
        <div className="sizer__msg" style={{ padding: '0 16px 12px' }}>Add each purchase separately (qty @ that day’s price). Buying the same stock again adds a new lot — the average cost is computed for you.</div>
      </div>

      {/* Totals */}
      {holdings.length > 0 && (
        <div className="jr-stats">
          <div className="stat-card"><div className="stat-card__label">Invested</div><div className="stat-card__value">{rs(totals.invested)}</div></div>
          <div className="stat-card"><div className="stat-card__label">Current value</div><div className="stat-card__value">{totals.priced ? rs(totals.value) : '—'}</div><div className="stat-card__sub">{totals.priced}/{holdings.length} priced live</div></div>
          <div className={`stat-card ${totals.pl >= 0 ? 'stat-card--pos' : 'stat-card--neg'}`}><div className="stat-card__label">Unrealized P/L</div><div className="stat-card__value">{totals.priced ? `${totals.pl >= 0 ? '+' : ''}${rs(totals.pl)}` : '—'}</div><div className="stat-card__sub">{totals.priced ? `${totals.plPct >= 0 ? '+' : ''}${totals.plPct.toFixed(2)}%` : ''}</div></div>
          <div className={`stat-card ${totals.downtrendPct > 40 ? 'stat-card--neg' : ''}`}><div className="stat-card__label">In downtrend</div><div className="stat-card__value">{totals.downtrendPct.toFixed(0)}%</div><div className="stat-card__sub">of value in Stage-4/bearish</div></div>
        </div>
      )}

      {/* Portfolio Health — automatic veteran-trader read of the whole book */}
      {health && (
        <div className={`pf-health pf-health--${health.grade.tone}`}>
          <div className="pf-health__head">
            <div className={`pf-score pf-score--${health.grade.tone}`}><b>{health.score}</b><span>/100</span></div>
            <div className="pf-health__title">
              <div className="pf-health__grade">Portfolio Health: <b>{health.grade.g}</b></div>
              <div className="muted small">Largest position {health.maxW.toFixed(0)}% · top two {health.top2.toFixed(0)}% · {health.downtrendPct.toFixed(0)}% in downtrend · {health.healthyPct.toFixed(0)}% in healthy uptrends · book P/L {health.plPct >= 0 ? '+' : ''}{health.plPct.toFixed(1)}%</div>
            </div>
          </div>

          {health.issues.length > 0 && (
            <div className="pf-health__issues">
              {health.issues.map((it, i) => (
                <div key={i} className={`pf-issue pf-issue--${it.level}`}>
                  <b>{it.level === 'severe' ? '🔴' : '🟡'} {it.title}</b>
                  <span>{it.detail}</span>
                </div>
              ))}
            </div>
          )}

          {health.actions.length > 0 && (
            <div className="pf-health__actions">
              <div className="pf-health__ah">✅ What a disciplined trader would do — in order</div>
              <ol>
                {health.actions.map((a, i) => (
                  <li key={i}><b>{a.action}{a.sym ? ` ${a.sym}` : ''}</b> — {a.why}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="pf-health__foot">Structural health only (concentration, trend exposure, allocation) — probability-based, not financial advice. Selling incurs brokerage &amp; CGT; decide for yourself.</div>
        </div>
      )}

      {!holdings.length && <Empty>Add the stocks you own above. You’ll get live P/L and a strategy verdict against each one.</Empty>}

      {/* Holdings */}
      {withAlloc.map((r) => (
        <div key={r.symbol} className={`pf-row pf-row--${r.adv.tone}`}>
          <div className="pf-top">
            <div className="pf-id">
              <div className="pf-id__top">
                <b className="link" onClick={() => onSelect(r.symbol)}>{r.symbol}</b>
                {r.sh.known && <span className={`shariah-badge shariah-badge--${r.sh.compliant ? 'yes' : 'no'}`}>{r.sh.compliant ? '☪ Shariah' : '✕ Non-Shariah'}</span>}
              </div>
              <span className="muted">{r.qty} sh · avg {fmtPrice(r.avgCost)}{r.alloc != null ? ` · ${r.alloc.toFixed(0)}% of book` : ''}</span>
            </div>
            <span className={`pf-badge ${toneClass[r.adv.tone]}`}>{r.adv.action}</span>
          </div>
          <div className="pf-lots">
            {r.lots.map((l, i) => (
              <div key={l.id} className="pf-lot">
                <span className="pf-lot__i">Buy {i + 1}</span>
                <span>{l.qty} sh @ {fmtPrice(l.price)}</span>
                <span className="muted">= {rs(l.qty * l.price)}</span>
                <span className="muted">{fmtDate(l.at)}</span>
                <button className="pf-lot__x" title="Remove this buy" onClick={() => removeLot(r.symbol, l.id)}>✕</button>
              </div>
            ))}
          </div>
          <div className="pf-nums">
            <span>Now: <b>{r.price != null ? fmtPrice(r.price) : '—'}</b></span>
            <span>Value: {r.value != null ? rs(r.value) : '—'}</span>
            <span className={r.pl == null ? 'muted' : r.pl >= 0 ? 'pos bold' : 'neg bold'}>
              {r.pl == null ? '—' : `${r.pl >= 0 ? '+' : ''}${rs(r.pl)} (${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(1)}%)`}
            </span>
            {r.adv.stop != null && <span className="muted">Suggested stop: {fmtPrice(r.adv.stop)}</span>}
          </div>
          <div className="pf-advice">{busy && !analyses[r.symbol] ? 'Analysing…' : r.adv.reason}</div>
          <div className="pf-stop">
            <span className="pf-stop__lbl">🔔 Alert stop</span>
            <input type="number" step="0.01" placeholder={r.adv.stop ?? ''} defaultValue={r.stop ?? ''} key={`${r.symbol}-${r.stop ?? 'x'}`}
              onBlur={(e) => setHoldingStop(r.symbol, e.target.value)} />
            <span className="muted small">App auto-alerts you to SELL if it falls to this — or turns to a downtrend — even while you’re on another tab. Empty = uses suggested {r.adv.stop != null ? fmtPrice(r.adv.stop) : '—'}.</span>
          </div>
          <button className="pf-remove" title="Remove" onClick={() => removeHolding(r.symbol)}>✕</button>
        </div>
      ))}

      {holdings.length > 0 && (
        <div className="sizer__note">Verdicts come from the same engine as the rest of the app (trend, Weinstein stage, momentum, structure) — probability-based, not a guarantee. P/L is price × quantity only; your net after brokerage, CGT and slippage will be lower. Always confirm before acting.</div>
      )}
    </div>
  );
}
