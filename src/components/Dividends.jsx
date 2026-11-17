import React from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { Empty } from './common.jsx';
import { fmtPrice } from '../utils/format.js';

/**
 * Upcoming Dividends — companies with an announced cash dividend whose
 * book-closure is near, from PSX's structured payouts data (dividend % + exact
 * book-closure dates). Shows whether you are still ELIGIBLE (buy before the
 * cum-dividend date). Real data; eligibility date is approximate (T+2) — confirm
 * the exact cum-date with your broker.
 */
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short' });

export default function Dividends({ onSelect }) {
  const { dividends, runDividendScan, equityRows } = useMarket();
  const { list, scanning, progress, scannedAt } = dividends;
  const scannedTime = scannedAt ? new Date(scannedAt).toLocaleString('en-PK', { hour12: true }) : null;
  const eligible = list.filter((d) => d.eligible);
  const closed = list.filter((d) => !d.eligible);

  const Row = ({ d }) => (
    <div className={`div-row ${d.eligible ? '' : 'div-row--closed'}`} onClick={() => onSelect(d.symbol)}>
      <div className="div-sym"><b>{d.symbol}</b>{d.inWatch && <span className="div-star">★</span>}<span className="muted ellipsis">{d.name || ''}</span></div>
      <span className="div-amt">💰 {d.details}</span>
      <span className="muted">Price {fmtPrice(d.price)}</span>
      <span className="div-bc">Book closure: <b>{d.bookClosure}</b></span>
      <span className={`div-elig ${d.eligible ? 'div-elig--yes' : 'div-elig--no'}`}>
        {d.eligible ? `✅ Buy by ~${fmtDate(d.lastBuyMs)}` : '❌ Ex-dividend / closed'}
      </span>
    </div>
  );

  return (
    <div className="opps">
      <div className="opps__head">
        <div>
          <h2 className="opps__title">💰 Upcoming Dividends</h2>
          <p className="opps__sub">Companies with an announced cash dividend and a near book-closure — from PSX's official payouts data. Shows if you're still eligible (buy before the cum-dividend date). Scans your watchlist + the most liquid stocks.</p>
        </div>
        <button className="btn-primary" onClick={runDividendScan} disabled={scanning || !equityRows.length}>
          {scanning ? `Scanning… ${progress}%` : scannedAt ? '↻ Rescan' : 'Scan Dividends'}
        </button>
      </div>

      <div className="regime regime--warn">
        <b>Before you buy for a dividend — read this</b>
        <span>Own the share BEFORE the cum-dividend date (≈2 working days before book-closure starts) to be eligible. BUT on the ex-date the price usually DROPS by ~the dividend, and dividends are taxed (~15% filer) — so it is NOT free profit. Dividend stocks are for long-term holding, not a quick capture. "Buy by" dates are approximate (T+2) — confirm the exact cum-date with your broker.</span>
      </div>

      {(scannedTime || scanning) && (
        <div className="opps__stamp">{scanning ? `Checking payouts… ${progress}%` : `As of ${scannedTime} · ${eligible.length} still eligible · ${closed.length} closed/ex`}</div>
      )}
      {scanning && <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }} /></div>}

      {!scanning && scannedAt && !list.length && (
        <Empty>No near-term cash dividends among your watchlist + liquid stocks right now. Dividends cluster around results season — rescan then.</Empty>
      )}
      {!scannedAt && !scanning && <Empty>Press “Scan Dividends” to find companies with an upcoming dividend and check your eligibility.</Empty>}

      {eligible.length > 0 && (
        <section>
          <h3 className="opps__group">✅ Still eligible ({eligible.length}) — you can still buy in time</h3>
          <div className="div-list">{eligible.map((d) => <Row key={d.symbol} d={d} />)}</div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h3 className="opps__group">❌ Ex-dividend / book-closure passed ({closed.length})</h3>
          <div className="div-list">{closed.map((d) => <Row key={d.symbol} d={d} />)}</div>
        </section>
      )}
    </div>
  );
}
