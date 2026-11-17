import React, { useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { fmtPrice } from '../utils/format.js';
import { getMarketStatus } from '../utils/marketStatus.js';
import { Empty } from './common.jsx';

/**
 * Paper Trading — a RISK-FREE proof. The app trades VIRTUAL money using its own
 * buy signals and exits at the stop/target automatically, so you can watch
 * whether the calls make money without risking a single rupee. Nothing real is
 * bought or sold; whole shares only, just like a real PSX account.
 */
const rs = (n) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const rs2 = (n) => `Rs ${Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (ms) => new Date(ms).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const heldDur = (a, b) => { if (!a || !b) return ''; const m = Math.max(0, Math.round((b - a) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

export default function PaperTrading({ onSelect }) {
  const { paper, startPaper, resetPaper, equityRows } = useMarket();
  const [cap, setCap] = useState('5000');
  const status = getMarketStatus();
  const priceOf = (sym) => { const r = equityRows.find((x) => x.symbol === sym); return r ? r.current : null; };
  const breadth = useMemo(() => {
    const up = equityRows.filter((r) => (r.changePct || 0) > 0).length;
    const down = equityRows.filter((r) => (r.changePct || 0) < 0).length;
    const tot = up + down;
    return { up, down, downPct: tot ? (down / tot) * 100 : 0 };
  }, [equityRows]);
  const redMarket = breadth.downPct >= 58;

  const stats = useMemo(() => {
    if (!paper) return null;
    const pos = paper.positions.map((p) => {
      const price = priceOf(p.symbol) ?? p.entry;
      const value = price * p.qty;
      const pl = (price - p.entry) * p.qty;
      const plPct = p.entry ? ((price - p.entry) / p.entry) * 100 : 0;
      return { ...p, price, value, pl, plPct };
    });
    const holdingsValue = pos.reduce((s, p) => s + p.value, 0);
    const equity = paper.cash + holdingsValue;
    const pl = equity - paper.startCapital;
    const plPct = paper.startCapital ? (pl / paper.startCapital) * 100 : 0;
    const closed = paper.closed || [];
    const wins = closed.filter((c) => c.pl > 0.005).length;
    const losses = closed.filter((c) => c.pl < -0.005).length;
    const flats = closed.length - wins - losses;
    const decisive = wins + losses;
    const realized = closed.reduce((s, c) => s + c.pl, 0);
    // Group closed trades by the DAY they were closed — newest day first.
    const groups = {};
    for (const c of closed) {
      const k = dayKeyOf(c.exitAt);
      if (!groups[k]) groups[k] = { key: k, label: dayLabel(c.exitAt), trades: [], pl: 0, wins: 0, losses: 0, flats: 0 };
      const g = groups[k];
      g.trades.push(c);
      g.pl += c.pl;
      if (c.pl > 0.005) g.wins += 1; else if (c.pl < -0.005) g.losses += 1; else g.flats += 1;
    }
    const byDay = Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
    for (const g of byDay) g.trades.sort((a, b) => b.exitAt - a.exitAt);
    return { pos, holdingsValue, equity, pl, plPct, closed, wins, losses, flats, winRate: decisive ? (wins / decisive) * 100 : 0, realized, byDay };
  }, [paper, equityRows]);

  // --- Start screen ---
  if (!paper) {
    return (
      <div className="opps">
        <div className="opps__head"><div>
          <h2 className="opps__title">🧪 Paper Trading — let the AI prove itself (risk-free)</h2>
          <p className="opps__sub">Give it virtual money and the app auto-trades on its own, so you can see whether the calls actually make a profit. No real money, ever.</p>
        </div></div>
        <div className="card">
          <div className="card__head"><span>Start a virtual run</span></div>
          <div className="journal__form">
            <label className="muted small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>Virtual capital (Rs)
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={cap}
                onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="5000" style={{ width: 160 }} />
            </label>
          </div>
          <div className="pt-modes">
            <button className="pt-mode pt-mode--primary" onClick={() => startPaper(cap, 'intraday')}>
              <b>⚡ Intraday (day trading)</b>
              <span>Buys momentum stocks (volume pushing up, near the day's high) and <b>takes profit the moment they pull back from their high</b> — no waiting for a fixed target. Closes everything before market close (same-day). This is what you described.</span>
            </button>
            <button className="pt-mode" onClick={() => startPaper(cap, 'swing')}>
              <b>📈 Swing (multi-day)</b>
              <span>Buys the app's dip-turn signals and holds until the stop or target — can run for several days. Steadier, fewer trades.</span>
            </button>
          </div>
          <div className="sizer__note">Up to 3 positions at a time. Rights-issue / distribution stocks are excluded. Acts automatically while the app is open; prices move during market hours (Mon–Thu 9:30–3:30). Whole shares only — just like a real account.</div>
        </div>
      </div>
    );
  }

  const modeLabel = (paper.mode || 'intraday') === 'intraday' ? '⚡ Intraday (day trading)' : '📈 Swing (multi-day)';

  // --- Active run ---
  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🧪 Paper Trading — AI is trading virtual money</h2>
          <p className="opps__sub">{modeLabel} · started {when(paper.startedAt)} with {rs(paper.startCapital)}. 100% simulated.</p>
        </div>
        <button className="link-btn" onClick={() => { if (window.confirm('Reset the paper run? This clears all virtual trades.')) resetPaper(); }}>↺ Reset run</button>
      </div>

      <div className="regime regime--warn">
        <b>{status.open ? '🟢 Market open — the AI is actively trading & prices are live' : '🔴 Market closed — positions held; P/L updates when the market reopens'}</b>
        <span>This is a risk-free simulation of the app's own buy signals, using whole shares like a real account. It is NOT a guarantee of future results — a short run is a small sample.</span>
      </div>

      {status.open && redMarket && (
        <div className="regime regime--neg">
          <b>🔴 Market is broadly RED ({breadth.downPct.toFixed(0)}% of stocks down)</b>
          <span>The AI is <b>holding off on new buys</b> — it won't fight a falling market ("sab girega"). It will resume entering when breadth improves. Existing positions are still managed normally.</span>
        </div>
      )}

      {/* Equity summary */}
      <div className="jr-stats">
        <div className="stat-card"><div className="stat-card__label">Total Equity</div><div className="stat-card__value">{rs(stats.equity)}</div><div className="stat-card__sub">started {rs(paper.startCapital)}</div></div>
        <div className={`stat-card ${stats.pl >= 0 ? 'stat-card--pos' : 'stat-card--neg'}`}><div className="stat-card__label">Total P/L</div><div className="stat-card__value">{stats.pl >= 0 ? '+' : ''}{rs(stats.pl)}</div><div className="stat-card__sub">{stats.plPct >= 0 ? '+' : ''}{stats.plPct.toFixed(2)}%</div></div>
        <div className="stat-card"><div className="stat-card__label">Cash / Invested</div><div className="stat-card__value">{rs(paper.cash)}</div><div className="stat-card__sub">in stocks {rs(stats.holdingsValue)}</div></div>
        <div className="stat-card"><div className="stat-card__label">Closed trades</div><div className="stat-card__value">{stats.closed.length}</div><div className="stat-card__sub">{stats.closed.length ? `${stats.wins}W / ${stats.losses}L${stats.flats ? ` / ${stats.flats}F` : ''} · ${stats.winRate.toFixed(0)}% win` : 'none yet'}</div></div>
      </div>

      {/* Open positions */}
      <div className="card">
        <div className="card__head"><span>Open Positions ({stats.pos.length}/3)</span></div>
        {!stats.pos.length && <Empty>{status.open ? 'No open positions yet — the AI opens one when a fresh buy signal appears (scans every few minutes).' : 'No open positions. The AI will buy when it finds a signal during market hours.'}</Empty>}
        {stats.pos.map((p) => (
          <div key={p.id} className="pt-row" onClick={() => onSelect(p.symbol)}>
            <div className="pt-main">
              <b className="link">{p.symbol}</b>
              <span className="muted">×{p.qty} @ {fmtPrice(p.entry)} · stop {fmtPrice(p.stop)}{p.target ? ` · tgt ${fmtPrice(p.target)}` : ''}</span>
              {p.reason && <span className="muted small">{p.reason}</span>}
            </div>
            <div className="pt-live">
              <span>Now {fmtPrice(p.price)}</span>
              <span className={p.pl >= 0 ? 'pos bold' : 'neg bold'}>{p.pl >= 0 ? '+' : ''}{rs(p.pl)} ({p.plPct >= 0 ? '+' : ''}{p.plPct.toFixed(1)}%)</span>
            </div>
          </div>
        ))}
      </div>

      {/* Closed trades — grouped day-wise, each with full bought/sold detail */}
      {stats.closed.length > 0 && (
        <div className="pt-history">
          <div className="opps__group" style={{ marginBottom: 4 }}>📅 Trade History — day by day ({stats.closed.length} trades · realized {stats.realized >= 0 ? '+' : ''}{rs(stats.realized)})</div>
          {stats.byDay.map((g) => (
            <div key={g.key} className="pt-day">
              <div className="pt-day__head">
                <b>{g.label}</b>
                <span className="pt-day__stat">
                  <span className={g.pl >= 0 ? 'pos bold' : 'neg bold'}>{g.pl >= 0 ? '+' : ''}{rs(g.pl)}</span>
                  <span className="muted">· {g.wins}W / {g.losses}L{g.flats ? ` / ${g.flats}F` : ''} · {g.trades.length} trades</span>
                </span>
              </div>
              <div className="pt-day__body">
                {g.trades.map((c) => {
                  const win = c.pl > 0.005; const loss = c.pl < -0.005;
                  const tag = win ? 'WIN 🎯' : loss ? 'LOSS ⛔' : 'FLAT ➖';
                  const cls = win ? 'pos' : loss ? 'neg' : 'muted';
                  const plPct = c.entry ? ((c.exit - c.entry) / c.entry) * 100 : 0;
                  return (
                    <div key={c.id} className={`pt-trade pt-trade--${win ? 'win' : loss ? 'loss' : 'flat'}`}>
                      <div className="pt-trade__top">
                        <b className="link" onClick={() => onSelect(c.symbol)}>{c.symbol}</b>
                        <span className={`${cls} bold`}>{tag} {c.pl >= 0 ? '+' : ''}{rs(c.pl)} <span className="muted" style={{ fontWeight: 400 }}>({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)</span></span>
                      </div>
                      <div className="pt-trade__legs">
                        <span className="pt-leg pt-leg--buy">🟢 Bought <b>{clock(c.openedAt)}</b> @ {fmtPrice(c.entry)} · {c.qty} sh</span>
                        <span className="pt-leg pt-leg--sell">🔴 Sold <b>{clock(c.exitAt)}</b> @ {fmtPrice(c.exit)}</span>
                        <span className="muted">held {heldDur(c.openedAt, c.exitAt)}</span>
                      </div>
                      {c.exitReason && <div className="pt-trade__why"><span className="muted">Exit:</span> {c.exitReason}</div>}
                      {c.reason && <div className="pt-trade__why"><span className="muted">Entry:</span> {c.reason}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sizer__note">Equity = cash + current value of open positions. P/L excludes brokerage/taxes (a real account would net slightly less). This proves the signal logic on paper — promising results here build confidence, but never guarantee the same with real money.</div>
    </div>
  );
}
