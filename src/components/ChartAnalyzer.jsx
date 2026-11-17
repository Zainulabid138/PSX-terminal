import React, { useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { readChart } from '../lib/chartRead.js';
import PriceChart from './PriceChart.jsx';
import { Spinner, Empty } from './common.jsx';
import { fmtPKR } from '../utils/format.js';

/**
 * Chart Analyzer — pick a stock and the app "reads" its chart for you in plain
 * language: trend, structure, moving averages, range position, support/resistance,
 * momentum, volume, and the detected patterns. It describes what the real data
 * shows — it does not predict a price.
 */
const biasClass = (b) => (b === 'bullish' ? 'pos' : b === 'bearish' ? 'neg' : 'muted');

export default function ChartAnalyzer({ onSelect }) {
  const { getAnalysis, equityRows, rows } = useMarket();
  const [query, setQuery] = useState('');
  const [symbol, setSymbol] = useState(null);
  const [a, setA] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [tf, setTf] = useState('daily');

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);
  const row = symbol ? (rows.find((r) => r.symbol === symbol) || {}) : {};

  const analyzeSym = async (sym) => {
    const s = (sym || query).trim().toUpperCase();
    if (!knownSymbols.includes(s)) { setMsg('Unknown symbol — check the ticker.'); return; }
    setMsg(''); setLoading(true); setSymbol(s); setA(null);
    const res = await getAnalysis(s);
    setLoading(false);
    if (!res || !res.ok) { setMsg(res?.message || 'Data unavailable from source.'); return; }
    setA(res);
  };

  const read = a && a.ok ? readChart(a) : null;

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🔎 Chart Analyzer — I'll read the chart for you</h2>
          <p className="opps__sub">Pick a stock and I'll explain, in plain words, what its chart is saying — trend, structure, support/resistance, patterns, momentum and volume. Describes the real data; it does not predict a price.</p>
        </div>
      </div>

      <div className="planner-bar">
        <input list="ca-syms" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && analyzeSym()} placeholder="Type a symbol e.g. LOTCHEM, OGDC…" />
        <datalist id="ca-syms">{knownSymbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
        <button className="btn-primary" onClick={() => analyzeSym()} disabled={loading}>{loading ? 'Reading…' : 'Analyze chart'}</button>
      </div>
      {msg && <div className="sizer__msg">{msg}</div>}

      {loading && <Spinner label="Reading the chart…" />}

      {!loading && a && a.ok && read && (
        <>
          <div className="detail__head">
            <div>
              <div className="detail__symbol">{symbol}</div>
              <div className="detail__name">{row.name || ''} · {fmtPKR(a.price)}</div>
            </div>
          </div>

          <div className="card chart-card">
            <div className="card__head">
              <span>Price Chart</span>
              <div className="tf-tabs">
                <button className={tf === 'intraday' ? 'active' : ''} onClick={() => setTf('intraday')}>Intraday</button>
                <button className={tf === 'daily' ? 'active' : ''} onClick={() => setTf('daily')}>Daily</button>
              </div>
            </div>
            <PriceChart symbol={symbol} timeframe={tf} snapshot={row} />
          </div>

          <div className={`regime regime--${read.tone === 'bullish' ? 'pos' : read.tone === 'bearish' ? 'neg' : 'warn'}`}>
            <b>What the chart is saying — {read.headline}</b>
            <span>{read.bottomLine}</span>
          </div>

          <div className="card">
            <div className="card__head"><span>Reading, point by point</span></div>
            <div className="report__lines">
              {read.points.map((pt, i) => (
                <div key={i} className="rep-row"><span className="rep-row__k">{pt.k}</span><span className="rep-row__v">{pt.v}</span></div>
              ))}
            </div>
          </div>

          {a.patterns?.length > 0 && (
            <div className="card">
              <div className="card__head"><span>Patterns detected on the chart</span></div>
              <div className="pat-list">
                {a.patterns.map((pt, i) => (
                  <div key={i} className="pat-row">
                    <span className={`pat-dot pat-dot--${biasClass(pt.bias)}`} />
                    <b>{pt.name}</b>
                    <span className={biasClass(pt.bias)}>{pt.bias}</span>
                    <span className="muted">{pt.detail}</span>
                  </div>
                ))}
              </div>
              <div className="tape__note" style={{ padding: '0 16px 14px' }}>
                Multi-candle candlestick patterns (engulfing, stars, head-and-shoulders, etc.) need historical OHLC candles the source doesn't provide, so only close-based structure, today's candle, and swing patterns are read here.
              </div>
            </div>
          )}

          <div className="opp-action">Open the full analysis for the plan (buy/stop/targets): <button className="link-btn" onClick={() => onSelect(symbol)}>Open {symbol} →</button></div>
        </>
      )}

      {!loading && !a && !msg && <Empty>Type a symbol above and press “Analyze chart” — I'll read it for you in plain language.</Empty>}
    </div>
  );
}
