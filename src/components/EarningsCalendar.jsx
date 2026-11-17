import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { Spinner, Empty } from './common.jsx';

/**
 * Earnings / Results Calendar — filters the official PSX announcement stream for
 * the notices that matter for earnings: board meetings (which announce upcoming
 * results), financial results/accounts, and dividends/payouts. Real filings only;
 * the exact result date is usually in the notice/PDF. No invented dates.
 */
// Mutual-fund daily distributions are noise for an equity dividend calendar.
const FUND_NOISE = /-FUNDS$|daily dividend distribution|money market fund|income fund|fixed return fund|mutual fund/i;

function categorize(symbol, title) {
  if (FUND_NOISE.test(symbol || '') || FUND_NOISE.test(title || '')) return null;
  const t = (title || '').toLowerCase();
  if (/dividend|payout|bonus|entitlement|book closure|book-closure|closure of book|right (issue|share)|final cash|interim cash|% cash/.test(t)) return { label: 'Dividend / Payout', icon: '💰', tone: 'pos' };
  if (/board meeting/.test(t)) return { label: 'Board Meeting', icon: '📅', tone: 'warn' };
  if (/result|accounts|financial statement|financial results|quarterly|half.?year|nine.?month|eps|audited|un-?audited/.test(t)) return { label: 'Results', icon: '📊', tone: 'accent' };
  return null;
}

export default function EarningsCalendar({ onSelect }) {
  const { getAnnouncements, equityRows } = useMarket();
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState('All');
  const [symActive, setSymActive] = useState(null); // when viewing one company's filings
  const [symMsg, setSymMsg] = useState('');

  const knownSymbols = useMemo(() => new Set(equityRows.map((r) => r.symbol)), [equityRows]);

  const load = useCallback(async () => {
    setStatus('loading'); setSymActive(null); setSymMsg('');
    const res = await getAnnouncements({ type: 'C', count: 150 });
    if (!res.ok) { setStatus('error'); return; }
    const tagged = res.data.items
      .map((i) => ({ ...i, cat: categorize(i.symbol, i.title) }))
      .filter((i) => i.cat);
    setItems(tagged);
    setStatus(tagged.length ? 'ready' : 'empty');
  }, [getAnnouncements]);

  // Look up ONE company's own filings (its results, board meetings, dividends) —
  // these are often older than the market-wide window, so we fetch by symbol.
  const lookup = useCallback(async () => {
    const sym = filter.trim().toUpperCase();
    if (!knownSymbols.has(sym)) { setSymMsg('Type a valid symbol (e.g. LOTCHEM) to look up its filings.'); return; }
    setStatus('loading'); setSymMsg('');
    const res = await getAnnouncements({ type: 'C', count: 40, symbol: sym });
    if (!res.ok) { setStatus('error'); return; }
    const tagged = res.data.items.map((i) => ({ ...i, cat: categorize(i.symbol, i.title) || { label: 'Filing', icon: '📄', tone: 'muted' } }));
    setItems(tagged); setSymActive(sym); setCat('All');
    setStatus(tagged.length ? 'ready' : 'empty');
  }, [filter, knownSymbols, getAnnouncements]);

  useEffect(() => { load(); }, [load]);

  const shown = (items || []).filter((i) => {
    if (cat !== 'All' && i.cat.label !== cat) return false;
    if (filter && !((i.symbol || '').toUpperCase().includes(filter.toUpperCase()) || (i.title || '').toUpperCase().includes(filter.toUpperCase()))) return false;
    return true;
  });

  // Group by date (feed is newest-first).
  const groups = [];
  const seen = new Map();
  for (const it of shown) {
    if (!seen.has(it.date)) { seen.set(it.date, []); groups.push([it.date, seen.get(it.date)]); }
    seen.get(it.date).push(it);
  }

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">🗓️ Earnings / Results Calendar</h2>
          <p className="opps__sub">Official PSX notices that move earnings: board meetings (announce upcoming results), financial results/accounts, and dividends. Real filings only — the exact date is in each notice/PDF. Not investment advice.</p>
        </div>
        <button className="btn-primary" onClick={load} disabled={status === 'loading'}>↻ Refresh</button>
      </div>

      <div className="planner-bar">
        <div className="seg">
          {['All', 'Board Meeting', 'Results', 'Dividend / Payout'].map((c) => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c === 'Dividend / Payout' ? '💰 Dividends' : c}</button>
          ))}
        </div>
        <input list="earn-syms" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="Company symbol e.g. LOTCHEM…" />
        <datalist id="earn-syms">{equityRows.slice(0, 600).map((r) => <option key={r.symbol} value={r.symbol} />)}</datalist>
        <button className="btn-primary" onClick={lookup}>🔎 Look up company</button>
        {symActive && <button className="link-btn" onClick={load}>← back to market</button>}
      </div>
      {symMsg && <div className="sizer__msg">{symMsg}</div>}
      {symActive && <div className="opps__stamp">Showing all recent filings for <b>{symActive}</b> — results/dividends are often inside the "Financial Results" notice (open its PDF for the dividend rate & book-closure date).</div>}

      {cat === 'Dividend / Payout' && (
        <div className="regime regime--warn">
          <b>How dividends work (important)</b>
          <span>To get a dividend you must OWN the share BEFORE its book-closure / entitlement date (shown in each notice / PDF) — buying after does NOT get you that dividend. BUT: on the ex-date the price usually DROPS by about the dividend amount, so a dividend is NOT free profit. Real reason to hold dividend stocks = long-term income + growth, not a quick "capture" trick.</span>
        </div>
      )}

      {status === 'loading' && <Spinner label="Loading result & board-meeting notices…" />}
      {status === 'error' && <Empty>Data unavailable from source.</Empty>}
      {status === 'empty' && <Empty>{symActive ? `No recent filings found for ${symActive}.` : 'No result/board-meeting notices in the recent announcement stream.'}</Empty>}

      {status === 'ready' && (
        <div className="card">
          {!shown.length && <Empty>No notices match the filter.</Empty>}
          {groups.map(([day, list]) => (
            <div key={day} className="hist-day">
              <div className="hist-day__head">{day} <span className="muted">· {list.length} notice{list.length > 1 ? 's' : ''}</span></div>
              {list.map((it, i) => (
                <div key={i} className="earn-row">
                  <span className={`earn-tag earn-tag--${it.cat.tone}`}>{it.cat.icon} {it.cat.label}</span>
                  <b className="link" onClick={() => it.symbol && onSelect(it.symbol)}>{it.symbol || '—'}</b>
                  <span className="earn-title">{it.title}</span>
                  {it.pdfUrl && <a href={it.pdfUrl} target="_blank" rel="noreferrer" className="link-btn">PDF ↗</a>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
