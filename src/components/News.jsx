import React, { useEffect, useState, useCallback } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { Spinner, Empty } from './common.jsx';

/**
 * News — official PSX company announcements (factual headlines only).
 * Shows real filings (date, time, symbol, company, title) with a link to the
 * official PDF. No AI summaries, no invented content. If the source returns
 * nothing, it says so plainly.
 */
export default function News({ onSelect }) {
  const { getAnnouncements } = useMarket();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('');
  const COUNT = 30;

  const load = useCallback(async (off) => {
    setStatus('loading');
    const res = await getAnnouncements({ type: 'C', count: COUNT, offset: off });
    if (res.ok) {
      setItems(res.data.items);
      setStatus(res.data.items.length ? 'ready' : 'empty');
    } else {
      setError(res.error || 'Data unavailable from source.');
      setStatus('error');
    }
  }, [getAnnouncements]);

  useEffect(() => { load(offset); }, [load, offset]);

  const shown = filter
    ? items.filter((i) => (i.symbol || '').toUpperCase().includes(filter.toUpperCase()) || (i.title || '').toUpperCase().includes(filter.toUpperCase()))
    : items;

  return (
    <div className="news">
      <div className="news__bar">
        <input className="news__search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by symbol or keyword…" />
        <div className="news__page">
          <button disabled={offset === 0 || status === 'loading'} onClick={() => setOffset(Math.max(0, offset - COUNT))}>← Newer</button>
          <span className="muted">rows {offset + 1}–{offset + COUNT}</span>
          <button disabled={status === 'loading'} onClick={() => setOffset(offset + COUNT)}>Older →</button>
        </div>
      </div>
      <div className="news__note">Official PSX company announcements (source: dps.psx.com.pk). Headlines and official PDFs only — no AI-generated summaries.</div>

      {status === 'loading' && <Spinner label="Loading announcements…" />}
      {status === 'error' && <Empty>Data unavailable from source: {error}</Empty>}
      {status === 'empty' && <Empty>No announcements returned from source.</Empty>}
      {status === 'ready' && (
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="left">Date</th><th className="left">Time</th><th className="left">Symbol</th>
                  <th className="left">Company</th><th className="left">Title</th><th className="left">Document</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((it, i) => (
                  <tr key={i}>
                    <td className="left muted">{it.date || '—'}</td>
                    <td className="left muted">{it.time || '—'}</td>
                    <td className="left bold link" onClick={() => it.symbol && onSelect(it.symbol)}>{it.symbol || '—'}</td>
                    <td className="left muted ellipsis">{it.name || '—'}</td>
                    <td className="left">{it.title || '—'}</td>
                    <td className="left">{it.pdfUrl ? <a href={it.pdfUrl} target="_blank" rel="noreferrer" className="link-btn">PDF ↗</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <Empty>No rows match the filter.</Empty>}
          </div>
        </div>
      )}
    </div>
  );
}
