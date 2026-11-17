import React, { useMemo, useState } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { fmtPrice, fmtNum } from '../utils/format.js';
import { downloadCSV } from '../utils/csv.js';
import { Empty } from './common.jsx';

/**
 * Trade Journal — log your real trades and build an HONEST track record.
 * Open trades show live unrealized P/L and flag when price hits your stop or
 * target. Closed trades feed real stats (win rate, profit factor, average R) —
 * computed only from what you actually logged. Nothing is invented.
 */
export default function TradeJournal({ onSelect }) {
  const { journal, addTrade, closeTrade, deleteTrade, getAnalysis, equityRows } = useMarket();
  const [f, setF] = useState({ symbol: '', entry: '', stop: '', target: '', qty: '', note: '' });
  const [loadMsg, setLoadMsg] = useState('');
  const [exitInputs, setExitInputs] = useState({});

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);
  const priceOf = (sym) => { const r = equityRows.find((x) => x.symbol === sym); return r ? r.current : null; };

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const loadPlan = async () => {
    const sym = f.symbol.trim().toUpperCase();
    if (!knownSymbols.includes(sym)) { setLoadMsg('Unknown symbol.'); return; }
    const a = await getAnalysis(sym);
    if (!a || !a.ok || !a.levels) { setLoadMsg(a?.noLevelsReason || 'No long plan available.'); return; }
    const mid = (a.levels.buyZone[0] + a.levels.buyZone[1]) / 2;
    setF((p) => ({ ...p, symbol: sym, entry: String(Math.round(mid * 100) / 100), stop: String(a.levels.stopLoss), target: String(a.levels.targets[0].price) }));
    setLoadMsg(`Loaded ${sym}'s plan — adjust entry/qty to your actual fill.`);
  };

  const canAdd = f.symbol && Number(f.entry) > 0 && Number(f.stop) > 0 && Number(f.qty) > 0;
  const submit = () => {
    if (!canAdd) return;
    addTrade({ symbol: f.symbol.trim().toUpperCase(), side: 'long', entry: Number(f.entry), stop: Number(f.stop), target: f.target ? Number(f.target) : null, qty: Number(f.qty), note: f.note });
    setF({ symbol: '', entry: '', stop: '', target: '', qty: '', note: '' }); setLoadMsg('');
  };

  const open = journal.filter((t) => t.status === 'open');
  const closed = journal.filter((t) => t.status === 'closed');

  // Honest stats from CLOSED trades only.
  const stats = useMemo(() => {
    if (!closed.length) return null;
    let wins = 0; let gp = 0; let gl = 0; let totR = 0; let totPL = 0;
    for (const t of closed) {
      const pl = (t.exit - t.entry) * t.qty;
      const r = (t.entry - t.stop) ? (t.exit - t.entry) / (t.entry - t.stop) : 0;
      totPL += pl; totR += r;
      if (pl > 0) { wins += 1; gp += pl; } else { gl += Math.abs(pl); }
    }
    return {
      n: closed.length, wins, losses: closed.length - wins,
      winRate: (wins / closed.length) * 100,
      profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
      totPL, avgR: totR / closed.length,
    };
  }, [closed]);

  return (
    <div className="journal">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">📓 Trade Journal — your honest track record</h2>
          <p className="opps__sub">Log the trades you actually take. Open trades show live P/L and warn at your stop/target. Closed trades build real stats from your own results — no fabricated numbers.</p>
        </div>
        {journal.length > 0 && (
          <button className="link-btn" onClick={() => downloadCSV('psx-trade-journal.csv', journal.map((t) => ({
            symbol: t.symbol, status: t.status, entry: t.entry, stop: t.stop, target: t.target ?? '', qty: t.qty,
            exit: t.exit ?? '', pl: t.status === 'closed' ? Math.round((t.exit - t.entry) * t.qty) : '',
            openedAt: new Date(t.openedAt).toLocaleString('en-PK'), note: t.note || '',
          })))}>Export CSV</button>
        )}
      </div>

      {/* Add trade */}
      <div className="card">
        <div className="card__head"><span>Log a trade</span></div>
        <div className="journal__form">
          <input list="jr-syms" value={f.symbol} onChange={(e) => set('symbol', e.target.value)} placeholder="Symbol" />
          <datalist id="jr-syms">{knownSymbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
          <button className="link-btn" onClick={loadPlan}>Load plan</button>
          <input type="number" value={f.entry} onChange={(e) => set('entry', e.target.value)} placeholder="Entry" />
          <input type="number" value={f.stop} onChange={(e) => set('stop', e.target.value)} placeholder="Stop" />
          <input type="number" value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="Target (opt)" />
          <input type="number" value={f.qty} onChange={(e) => set('qty', e.target.value)} placeholder="Shares" />
          <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Note (opt)" className="journal__note-in" />
          <button className="btn-primary" disabled={!canAdd} onClick={submit}>Add</button>
        </div>
        {loadMsg && <div className="sizer__msg" style={{ padding: '0 16px 12px' }}>{loadMsg}</div>}
      </div>

      {/* Stats */}
      {stats && (
        <div className="jr-stats">
          <div className="stat-card"><div className="stat-card__label">Closed trades</div><div className="stat-card__value">{stats.n}</div><div className="stat-card__sub">{stats.wins}W / {stats.losses}L</div></div>
          <div className="stat-card"><div className="stat-card__label">Win rate</div><div className="stat-card__value">{stats.winRate.toFixed(0)}%</div></div>
          <div className={`stat-card ${stats.profitFactor >= 1 ? 'stat-card--pos' : 'stat-card--neg'}`}><div className="stat-card__label">Profit factor</div><div className="stat-card__value">{stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}</div></div>
          <div className={`stat-card ${stats.totPL >= 0 ? 'stat-card--pos' : 'stat-card--neg'}`}><div className="stat-card__label">Total P/L</div><div className="stat-card__value">Rs {Math.round(stats.totPL).toLocaleString()}</div><div className="stat-card__sub">avg {stats.avgR.toFixed(2)}R</div></div>
        </div>
      )}

      {/* Open positions */}
      <div className="card">
        <div className="card__head"><span>Open Positions ({open.length})</span></div>
        {!open.length && <Empty>No open trades. Log one above after you buy.</Empty>}
        {open.map((t) => {
          const px = priceOf(t.symbol);
          const upl = px != null ? (px - t.entry) * t.qty : null;
          const uplPct = px != null && t.entry ? ((px - t.entry) / t.entry) * 100 : null;
          const rNow = px != null && (t.entry - t.stop) ? (px - t.entry) / (t.entry - t.stop) : null;
          const hitStop = px != null && px <= t.stop;
          const hitTarget = px != null && t.target != null && px >= t.target;
          return (
            <div key={t.id} className={`jr-row ${hitStop ? 'jr-row--stop' : hitTarget ? 'jr-row--target' : ''}`}>
              <div className="jr-main">
                <b className="link" onClick={() => onSelect(t.symbol)}>{t.symbol}</b>
                <span className="muted">{t.qty} sh @ {fmtPrice(t.entry)} · stop {fmtPrice(t.stop)}{t.target ? ` · tgt ${fmtPrice(t.target)}` : ''}</span>
              </div>
              <div className="jr-live">
                <span>Now: {px != null ? fmtPrice(px) : '—'}</span>
                <span className={upl == null ? 'muted' : upl >= 0 ? 'pos' : 'neg'}>{upl == null ? '—' : `${upl >= 0 ? '+' : ''}Rs ${Math.round(upl).toLocaleString()} (${uplPct >= 0 ? '+' : ''}${uplPct.toFixed(1)}%)`}</span>
                <span className="muted">{rNow != null ? `${rNow >= 0 ? '+' : ''}${rNow.toFixed(2)}R` : ''}</span>
                {hitStop && <span className="neg bold">⛔ Stop hit — exit</span>}
                {hitTarget && <span className="pos bold">🎯 Target hit — book</span>}
              </div>
              <div className="jr-actions">
                <input type="number" placeholder="exit px" value={exitInputs[t.id] || ''} onChange={(e) => setExitInputs((p) => ({ ...p, [t.id]: e.target.value }))} />
                <button className="link-btn" onClick={() => { const ex = Number(exitInputs[t.id] || px); if (ex > 0) closeTrade(t.id, ex); }}>Close</button>
                <button className="link-btn" onClick={() => deleteTrade(t.id)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Closed trades */}
      {closed.length > 0 && (
        <div className="card">
          <div className="card__head"><span>Closed Trades ({closed.length})</span></div>
          {closed.map((t) => {
            const pl = (t.exit - t.entry) * t.qty;
            const r = (t.entry - t.stop) ? (t.exit - t.entry) / (t.entry - t.stop) : 0;
            return (
              <div key={t.id} className="jr-row">
                <div className="jr-main">
                  <b className="link" onClick={() => onSelect(t.symbol)}>{t.symbol}</b>
                  <span className="muted">{t.qty} sh · {fmtPrice(t.entry)} → {fmtPrice(t.exit)}</span>
                </div>
                <div className="jr-live">
                  <span className={pl >= 0 ? 'pos bold' : 'neg bold'}>{pl >= 0 ? 'WIN' : 'LOSS'} {pl >= 0 ? '+' : ''}Rs {Math.round(pl).toLocaleString()}</span>
                  <span className="muted">{r >= 0 ? '+' : ''}{r.toFixed(2)}R</span>
                </div>
                <div className="jr-actions"><button className="link-btn" onClick={() => deleteTrade(t.id)}>Delete</button></div>
              </div>
            );
          })}
        </div>
      )}

      <div className="sizer__note">P/L is price × quantity and excludes brokerage, taxes and slippage — your real net will differ. Stats are computed only from trades you closed here; a small sample is not a reliable edge.</div>
    </div>
  );
}
