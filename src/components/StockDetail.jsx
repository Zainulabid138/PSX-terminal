import React, { useEffect, useState } from 'react';
import { useMarket, ALERT_TYPES } from '../store/MarketContext.jsx';
import PriceChart from './PriceChart.jsx';
import { ProbBar, RecoBadge, Spinner, Empty, ChangeBadge } from './common.jsx';
import { TradeLevels } from './Opportunities.jsx';
import { analyzeTape } from '../lib/tape.js';
import { project, PROJECTION_HORIZONS } from '../lib/projection.js';
import { fmtPrice, fmtPKR, fmtVolume, fmtNum, fmtPct, shariahStatus } from '../utils/format.js';
import { traderDesk } from '../lib/traderDesk.js';

/** Trader's Desk — a forward, trader-voice opinion + game plan (not a day report). */
function TraderDeskPanel({ a, regime }) {
  const td = a && a.ok ? traderDesk(a, regime) : null;
  if (!td) return null;
  return (
    <div className={`tdesk tdesk--${td.tone}`}>
      <div className="tdesk__head">
        <span className="tdesk__title">🧠 Trader’s Desk — my read &amp; plan</span>
        <span className={`tdesk__badge tdesk__badge--${td.tone}`}>{td.badge}</span>
      </div>
      <div className="tdesk__headline">{td.headline}</div>
      <p className="tdesk__thesis">{td.thesis}</p>
      <div className="tdesk__paths">
        <div className="tdesk__path tdesk__path--bull"><b>📈 Bull path (~{td.bullPath.prob}%)</b><span>{td.bullPath.text}</span></div>
        <div className="tdesk__path tdesk__path--bear"><b>📉 Bear path (~{td.bearPath.prob}%)</b><span>{td.bearPath.text}</span></div>
      </div>
      {td.overlays.length > 0 && (
        <ul className="tdesk__overlays">{td.overlays.map((o, i) => <li key={i}>{o}</li>)}</ul>
      )}
      <div className="tdesk__plan">
        <div><span>My move</span><b>{td.plan.trigger}</b></div>
        <div><span>I’m wrong if</span><b className="neg">{td.plan.invalidation}</b></div>
        <div><span>Objective</span><b className="pos">{td.plan.target}</b></div>
        <div><span>Timeframe</span><b>{td.plan.timeframe}</b></div>
      </div>
      <div className="tdesk__caveat">⚖ {td.caveat}</div>
    </div>
  );
}

/** Honest "how far could it move" range from the stock's own volatility. */
function ProjectionPanel({ a }) {
  const [hz, setHz] = useState('3M');
  const m = a.metrics || {};
  const p = project(a.price, m.vol60, hz);
  return (
    <div className="card">
      <div className="card__head">
        <span>Price Projection — realistic range (not a prediction)</span>
        <div className="tf-tabs">
          {PROJECTION_HORIZONS.map((h) => <button key={h} className={hz === h ? 'active' : ''} onClick={() => setHz(h)}>{h}</button>)}
        </div>
      </div>
      <div className="proj">
        {!p && <Empty>Insufficient data to project a range.</Empty>}
        {p && p.extreme && (
          <div className="levels-none">
            ⚠ Extreme volatility (~{p.dailyVolPct.toFixed(0)}%/day). This stock is a gamble — its realistic range is enormous, so ANY price target (20 or 200) is meaningless. Avoid, or only a tiny speculative amount you can lose.
          </div>
        )}
        {p && !p.extreme && (
          <>
            <div className="proj__row"><span>Direction bias</span><b className={a.bullishProbability >= 50 ? 'pos' : 'neg'}>{a.bullishProbability}% up / {a.bearishProbability}% down · {a.confidence}% conf</b></div>
            <div className="proj__row"><span>~68% likely range ({hz})</span><b>Rs {fmtPrice(p.r68[0])} – {fmtPrice(p.r68[1])}</b></div>
            <div className="proj__row"><span>~95% likely range ({hz})</span><b>Rs {fmtPrice(p.r95[0])} – {fmtPrice(p.r95[1])}</b></div>
            <div className="proj__levels">
              <div><span>Upside if trend holds</span><b className="pos">{m.resistance != null ? fmtPrice(m.resistance) : '—'} → 52w high {m.hi52 != null ? fmtPrice(m.hi52) : '—'}</b></div>
              <div><span>Downside risk</span><b className="neg">support {m.support != null ? fmtPrice(m.support) : '—'} → 52w low {m.lo52 != null ? fmtPrice(m.lo52) : '—'}</b></div>
            </div>
          </>
        )}
        <div className="proj__note">
          This is a spread of possibilities from this stock's own volatility (σ ~{p ? p.dailyVolPct.toFixed(1) : '—'}%/day) — <b>NOT a forecast or a promise</b>. Nobody can predict an exact future price. Use the direction bias + a stop; the wider the range, the less predictable the stock.
        </div>
      </div>
    </div>
  );
}

/** Big Trades / tape-reading panel — who is really behind the move (large buyers vs sellers). */
function StockTape({ symbol }) {
  const [tape, setTape] = useState(undefined); // undefined=loading, null=insufficient
  useEffect(() => {
    let alive = true;
    setTape(undefined);
    if (!window.psx) { setTape(null); return () => {}; }
    window.psx.getIntraday(symbol).then((res) => {
      if (!alive) return;
      setTape(res.ok ? analyzeTape(res.data) : null);
    });
    return () => { alive = false; };
  }, [symbol]);

  return (
    <div className="card">
      <div className="card__head"><span>Big Trades — Tape Reading (today)</span></div>
      {tape === undefined && <Spinner label="Reading the tape…" />}
      {tape === null && <Empty>Insufficient intraday trades from source to read the tape.</Empty>}
      {tape && (
        <div className="tape">
          <div className={`tape__verdict tape__verdict--${tape.bias}`}>{tape.verdict}</div>
          <div className="tape__stats">
            <div><span>Buy pressure</span><b className={tape.buyPct >= 50 ? 'pos' : 'neg'}>{tape.buyPct}%</b></div>
            <div><span>Large buys</span><b className="pos">{fmtVolume(tape.bigBuy)}</b></div>
            <div><span>Large sells</span><b className="neg">{fmtVolume(tape.bigSell)}</b></div>
            <div><span>Biggest trade</span><b>{tape.biggest ? `${fmtVolume(tape.biggest.volume)} @ ${tape.biggest.price} (${tape.biggest.dir})` : '—'}</b></div>
          </div>
          {tape.recent.length > 0 && (
            <div className="tape__list">
              {tape.recent.map((t, i) => (
                <div key={i} className={`tape-row tape-row--${t.dir}`}>
                  <span className="muted">{new Date(t.time * 1000 + 5 * 3600000).toISOString().slice(11, 16)}</span>
                  <b>{fmtVolume(t.volume)} sh</b>
                  <span>@ {t.price}</span>
                  <span className={t.dir === 'buy' ? 'pos' : t.dir === 'sell' ? 'neg' : 'muted'}>{t.dir === 'buy' ? '▲ BUY' : t.dir === 'sell' ? '▼ SELL' : '—'}</span>
                </div>
              ))}
            </div>
          )}
          <div className="tape__note">Large prints (≥ {fmtVolume(tape.threshold)} sh) from today's real tape. Trades are anonymous; buy/sell is inferred from the up/down-tick rule — an approximation, not exchange-tagged, and it shows size, not identity.</div>
        </div>
      )}
    </div>
  );
}

/** Quick inline alert creator for the current symbol. */
function QuickAlert({ symbol, price }) {
  const { addAlert } = useMarket();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('price_above');
  const [value, setValue] = useState(price != null ? String(Math.round(price * 1.02 * 100) / 100) : '');
  if (!open) return <button className="watch-btn" onClick={() => setOpen(true)}>🔔 Add Alert</button>;
  return (
    <span className="quick-alert">
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {ALERT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn-primary" disabled={value === '' || Number.isNaN(Number(value))} onClick={() => { addAlert({ symbol, type, value: Number(value) }); setOpen(false); }}>Set</button>
      <button className="link-btn" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

/** Latest official filings for the current symbol (factual headlines only). */
function StockNews({ symbol }) {
  const { getAnnouncements } = useMarket();
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    getAnnouncements({ type: 'C', count: 6, symbol }).then((res) => {
      if (!alive) return;
      const list = res.ok ? res.data.items.filter((i) => !i.symbol || i.symbol === symbol) : [];
      setItems(list);
    });
    return () => { alive = false; };
  }, [symbol, getAnnouncements]);

  return (
    <div className="card">
      <div className="card__head"><span>Latest Filings — {symbol}</span></div>
      {items == null && <Spinner label="Loading filings…" />}
      {items != null && items.length === 0 && <Empty>No recent announcements from source for {symbol}.</Empty>}
      {items != null && items.length > 0 && (
        <div className="filings">
          {items.map((it, i) => (
            <div key={i} className="filing">
              <div className="filing__meta">{it.date} {it.time}</div>
              <div className="filing__title">{it.title}</div>
              {it.pdfUrl && <a href={it.pdfUrl} target="_blank" rel="noreferrer" className="link-btn">Official PDF ↗</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TIMEFRAMES = [
  { id: 'intraday', label: 'Intraday' },
  { id: 'daily', label: 'Daily' },
];

/** Metric row helper; shows a fallback for null. */
function M({ label, value, na = 'Data unavailable from source.' }) {
  return (
    <div className="metric">
      <span className="metric__k">{label}</span>
      <span className="metric__v">{value == null || value === '' ? na : value}</span>
    </div>
  );
}

/** One labelled report line. */
function R({ label, children, tone }) {
  return (
    <div className={`rep-row ${tone ? `rep-row--${tone}` : ''}`}>
      <span className="rep-row__k">{label}</span>
      <span className="rep-row__v">{children}</span>
    </div>
  );
}

const trendTone = (t) => (t === 'Bullish' || t === 'Up' ? 'pos' : t === 'Bearish' || t === 'Down' ? 'neg' : '');

function Confirmations({ conf }) {
  const items = [
    ['Trend (Daily)', conf.trendDaily], ['Trend (Weekly)', conf.trendWeekly],
    ['MACD', conf.macd], ['RSI', conf.rsi], ['ADX', conf.adx],
    ['Volume', conf.volume], ['Breakout', conf.breakout],
    ['Sector', conf.sector], ['Rel. Strength', conf.rs],
  ];
  return (
    <div className="confirm-grid">
      {items.map(([k, v]) => (
        <span key={k} className={`confirm ${v ? 'confirm--yes' : 'confirm--no'}`} title={k === 'ADX' && !v ? 'ADX requires historical high/low data not provided by the source' : ''}>
          {v ? '✓' : '✕'} {k}
        </span>
      ))}
    </div>
  );
}

export default function StockDetail({ symbol }) {
  const { equityRows, rows, getAnalysis, getRegime, watchlist, toggleWatch } = useMarket();
  const [tf, setTf] = useState('daily');
  const [a, setA] = useState(null);
  const [regime, setRegime] = useState(null);
  const [loading, setLoading] = useState(true);

  const row = rows.find((r) => r.symbol === symbol) || equityRows.find((r) => r.symbol === symbol);

  useEffect(() => {
    let alive = true;
    setLoading(true); setA(null);
    getAnalysis(symbol).then((res) => { if (alive) { setA(res); setLoading(false); } });
    getRegime().then((rg) => { if (alive) setRegime(rg); }).catch(() => {});
    return () => { alive = false; };
  }, [symbol, getAnalysis, getRegime]);

  if (!symbol) return <Empty>Select a stock to view its analysis.</Empty>;

  const watched = watchlist.includes(symbol);
  const m = a?.metrics;

  return (
    <div className="detail">
      <div className="detail__head">
        <div>
          <div className="detail__symbol">
            {symbol}
            <button className={`watch-btn ${watched ? 'watch-btn--on' : ''}`} onClick={() => toggleWatch(symbol)}>
              {watched ? '★ Watching' : '☆ Watch'}
            </button>
            <QuickAlert symbol={symbol} price={row?.current} />
            {(() => {
              const sh = shariahStatus(row?.listedIn);
              if (!sh.known) return null;
              return (
                <span className={`shariah-badge ${sh.compliant ? 'shariah-badge--yes' : 'shariah-badge--no'}`} title={sh.compliant ? 'In the KMI All-Share Islamic Index — passed PSX/Meezan Shariah screening.' : 'Not in the KMI All-Share Islamic Index — treated as non-Shariah by PSX screening.'}>
                  {sh.compliant ? `☪ ${sh.kmi30 ? 'Shariah · KMI-30' : 'Shariah-compliant'}` : '✕ Non-Shariah'}
                </span>
              );
            })()}
          </div>
          <div className="detail__name">{row?.name || 'Data unavailable from source.'}</div>
          <div className="detail__sector">{row?.sectorName || row?.sectorCode || ''}{row?.listedIn?.length ? ` · ${row.listedIn.join(', ')}` : ''}</div>
        </div>
        <div className="detail__price">
          <div className="detail__last">{fmtPKR(row?.current)}</div>
          <div><ChangeBadge value={row?.changePct} /> <span className="muted">({fmtNum(row?.change)} today)</span></div>
        </div>
      </div>

      {a?.ok && <TraderDeskPanel a={a} regime={regime} />}

      <div className="quote-grid">
        <M label="Open" value={fmtPrice(row?.open)} />
        <M label="High" value={fmtPrice(row?.high)} />
        <M label="Low" value={fmtPrice(row?.low)} />
        <M label="Prev Close (LDCP)" value={fmtPrice(row?.ldcp)} />
        <M label="Volume" value={fmtVolume(row?.volume)} />
        <M label="52W High (close)" value={m ? fmtPrice(m.hi52) : null} />
        <M label="52W Low (close)" value={m ? fmtPrice(m.lo52) : null} />
        <M label="Avg Vol (20d)" value={m ? fmtVolume(m.avgVol20) : null} />
        <M label="VWAP (intraday)" value={m && m.vwap != null ? fmtPrice(m.vwap) : null} />
        <M label="Market Cap" value={null} />
      </div>

      <div className="detail__cols">
        <div className="card chart-card">
          <div className="card__head">
            <span>Price Chart</span>
            <div className="tf-tabs">
              {TIMEFRAMES.map((t) => (
                <button key={t.id} className={tf === t.id ? 'active' : ''} onClick={() => setTf(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
          <PriceChart symbol={symbol} timeframe={tf} snapshot={row} />
          <div className="chart-note">
            Times shown in PKT (UTC+5). Daily view uses real closing prices + volume + EMA20/50 overlays from the PSX source (the source does not provide historical OHLC candles, so a close line is shown). Intraday view shows real ticks for the current session (09:30–15:30 PKT).
          </div>
        </div>

        {a && a.ok && <ProjectionPanel a={a} />}
        <StockTape symbol={symbol} />
        <StockNews symbol={symbol} />

        <div className="card analysis-card">
          <div className="card__head"><span>Institutional Analysis — evidence-based, probability-driven</span></div>
          {loading && <Spinner label="Analyzing real data…" />}
          {!loading && a && !a.ok && <Empty>{a.message}{a.detail ? ` — ${a.detail}` : ''}</Empty>}
          {!loading && a && a.ok && (
            <div className="report">
              <div className="report__verdict">
                <RecoBadge recommendation={{ action: a.finalRecommendation, tone: /Buy/.test(a.finalRecommendation) ? 'buy' : /Sell|Avoid/.test(a.finalRecommendation) ? 'sell' : 'neutral' }} />
                <span className={`pill ${a.setupValid ? 'pill--pos' : ''}`}>{a.setup}</span>
                <span className="pill">TQ Score {a.tradeQuality}/100</span>
              </div>

              <ProbBar up={a.bullishProbability} />
              <div className="prob-line">
                <span className="pos">Bullish {a.bullishProbability}%</span>
                <span className="neg">Bearish {a.bearishProbability}%</span>
                <span>Confidence <b>{a.confidence}%</b> ({a.confidenceTier})</span>
              </div>

              <Confirmations conf={a.confirmations} />

              {a.traderCall && (
                <div className="playbook">
                  <div className="playbook__head">
                    <span>Trader's Playbook</span>
                    <span className={`tier tier--${a.traderCallTone}`}>{a.traderCall}</span>
                    <span className="pill">Conviction {a.conviction}/100</span>
                  </div>
                  <div className="playbook__chips">
                    {a.marketRegime && <span className="opp-chip">Market: {a.marketRegime.state}</span>}
                    <span className="opp-chip">{a.stage?.label}</span>
                    <span className="opp-chip">Setup: {a.setupType}</span>
                  </div>
                  <ul className="playbook__notes">{a.traderNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  {a.levels
                    ? <TradeLevels levels={a.levels} actionable={a.setupValid && a.stage?.stage === 2} />
                    : <div className="levels-none">{a.noLevelsReason}</div>}
                </div>
              )}

              <div className="report__lines">
                <R label="Trend (D / W / M)">
                  <span className={trendTone(a.trend.daily)}>{a.trend.daily}</span> / <span className={trendTone(a.trend.weekly)}>{a.trend.weekly}</span> / <span className={trendTone(a.trend.monthly)}>{a.trend.monthly}</span>
                  <div className="sub">{a.trend.summary}</div>
                </R>
                <R label="Market Structure">{a.marketStructure.label}<div className="sub">{a.marketStructure.reason}</div></R>
                <R label="Sector Strength">{a.sectorStrength.label}<div className="sub">{a.sectorStrength.detail}</div></R>
                <R label="Relative Strength">{a.relativeStrength.label}<div className="sub">{a.relativeStrength.detail}</div></R>
                <R label="Momentum">{a.momentum.summary}</R>
                <R label="Volume">{a.volume.summary}</R>
                <R label="Support">{a.support != null ? fmtPrice(a.support) : 'None detected'}</R>
                <R label="Resistance">{a.resistance != null ? fmtPrice(a.resistance) : 'None detected'}</R>
                <R label="Risk Level" tone={a.riskLevel === 'High' ? 'neg' : a.riskLevel === 'Low' ? 'pos' : ''}>{a.riskLevel}</R>
              </div>

              <div className="reasons">
                <div className="reasons__col">
                  <h4 className="pos">Reasons For ({a.reasons.length})</h4>
                  <ul>{a.reasons.length ? a.reasons.map((r, i) => <li key={i}>{r}</li>) : <li className="muted">None.</li>}</ul>
                </div>
                <div className="reasons__col">
                  <h4 className="neg">Reasons Against ({a.reasonsAgainst.length})</h4>
                  <ul>{a.reasonsAgainst.length ? a.reasonsAgainst.map((r, i) => <li key={i}>{r}</li>) : <li className="muted">None.</li>}</ul>
                </div>
              </div>

              {a.risks?.length > 0 && (
                <div className="risks">
                  <h4>Risk Analysis</h4>
                  <ul>{a.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}

              <div className="alternative">{a.alternative}</div>
              <div className="invalidation"><b>Invalidation:</b> {a.invalidationLevel}</div>

              <div className="indi-grid">
                <M label="RSI (14)" value={m.rsi != null ? fmtNum(m.rsi, 1) : null} na="Insufficient data" />
                <M label="Stoch RSI %K" value={m.stochRsiK != null ? fmtNum(m.stochRsiK, 0) : null} na="Insufficient data" />
                <M label="MACD" value={m.macd != null ? fmtNum(m.macd, 3) : null} na="Insufficient data" />
                <M label="MACD signal" value={m.macdSignal != null ? fmtNum(m.macdSignal, 3) : null} na="Insufficient data" />
                <M label="EMA 9 / 20" value={m.ema9 != null ? `${fmtNum(m.ema9)} / ${fmtNum(m.ema20)}` : null} na="Insufficient data" />
                <M label="EMA 50 / 200" value={m.ema50 != null ? `${fmtNum(m.ema50)} / ${m.ema200 != null ? fmtNum(m.ema200) : '—'}` : null} na="Insufficient data" />
                <M label="SMA 50 / 200" value={m.sma50 != null ? `${fmtNum(m.sma50)} / ${m.sma200 != null ? fmtNum(m.sma200) : '—'}` : null} na="Insufficient data" />
                <M label="Bollinger U / L" value={m.bbUpper != null ? `${fmtNum(m.bbUpper)} / ${fmtNum(m.bbLower)}` : null} na="Insufficient data" />
                <M label="ROC (10d)" value={m.roc10 != null ? fmtPct(m.roc10) : null} na="Insufficient data" />
                <M label="Rel. Volume" value={m.volRatio != null ? `${fmtNum(m.volRatio)}x` : null} na="Insufficient data" />
                <M label="Volatility (14d σ)" value={m.volatilityPct != null ? fmtPct(m.volatilityPct, false) : null} na="Insufficient data" />
                <M label="Pivot (P / R1 / S1)" value={m.pivots ? `${fmtNum(m.pivots.p)} / ${fmtNum(m.pivots.r1)} / ${fmtNum(m.pivots.s1)}` : null} na="Insufficient data" />
              </div>

              <details className="unavailable">
                <summary>What this source cannot provide (transparency)</summary>
                <ul>{a.unavailable.map((u, i) => <li key={i}>{u}</li>)}</ul>
              </details>

              <div className="disclaimer">
                Evidence-based, probability-driven analysis for decision support only — not financial advice and not a guarantee of any outcome. The engine never forces a Buy/Sell: when evidence is weak or conflicting it defaults to Watch/Hold/No-Trade.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
