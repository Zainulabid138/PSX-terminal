import React, { useState, useCallback } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { ProbBar, RecoBadge, Empty } from './common.jsx';
import { fmtPct, changeClass } from '../utils/format.js';

const recoTone = (action) => (/Buy/.test(action) ? 'buy' : /Sell|Avoid/.test(action) ? 'sell' : 'neutral');

/**
 * Scanner
 * -------
 * Runs the probability engine across a bounded candidate set (the most active /
 * most-moved symbols) and ranks them. Work is done one symbol at a time with
 * `await`, so the UI never freezes and results stream in. The candidate cap is
 * shown explicitly — coverage is never silently truncated.
 */
const SCAN_LIMIT = 60;

export default function Scanner({ onSelect }) {
  const { equityRows, getAnalysis } = useMarket();
  const [results, setResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [bias, setBias] = useState('bullish'); // bullish | bearish

  const runScan = useCallback(async () => {
    setScanning(true);
    setResults([]);
    setProgress(0);

    const candidates = [...equityRows]
      .sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0) || (b.volume || 0) - (a.volume || 0))
      .slice(0, SCAN_LIMIT);

    const found = [];
    for (let i = 0; i < candidates.length; i++) {
      const r = candidates[i];
      // eslint-disable-next-line no-await-in-loop
      const a = await getAnalysis(r.symbol);
      setProgress(Math.round(((i + 1) / candidates.length) * 100));
      if (a && a.ok && a.confidence >= 70 && !a.conflict) {
        found.push({ symbol: r.symbol, name: r.name, changePct: r.changePct, analysis: a });
        // live-update ranking as we go
        setResults(rank([...found], bias));
      }
    }
    setResults(rank(found, bias));
    setScanning(false);
  }, [equityRows, getAnalysis, bias]);

  return (
    <div className="scanner">
      <div className="scanner__bar">
        <div className="seg">
          <button className={bias === 'bullish' ? 'active' : ''} onClick={() => { setBias('bullish'); setResults((r) => rank(r, 'bullish')); }}>Bullish edge</button>
          <button className={bias === 'bearish' ? 'active' : ''} onClick={() => { setBias('bearish'); setResults((r) => rank(r, 'bearish')); }}>Bearish edge</button>
        </div>
        <button className="btn-primary" onClick={runScan} disabled={scanning || !equityRows.length}>
          {scanning ? `Scanning… ${progress}%` : `Run AI Scan (top ${SCAN_LIMIT} active)`}
        </button>
      </div>
      {scanning && <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }} /></div>}

      <div className="scan-note">
        Scans the {SCAN_LIMIT} most active / most-moved symbols (bounded for performance and to be gentle on the data source).
        Low-confidence and conflicting setups are excluded. Probability-based, not advice.
      </div>

      {!results.length && !scanning && <Empty>Run a scan to rank stocks by probability edge.</Empty>}

      <div className="scan-list">
        {results.map((r) => (
          <div key={r.symbol} className="scan-row" onClick={() => onSelect(r.symbol)}>
            <div className="scan-row__sym">
              <b>{r.symbol}</b>
              <span className="muted ellipsis">{r.name || ''}</span>
            </div>
            <div className="scan-row__reco"><RecoBadge recommendation={{ action: r.analysis.finalRecommendation, tone: recoTone(r.analysis.finalRecommendation) }} /></div>
            <div className="scan-row__prob"><ProbBar up={r.analysis.bullishProbability} /></div>
            <div className="scan-row__conf"><span className="pill">{r.analysis.confidence}% · TQ {r.analysis.tradeQuality}</span></div>
            <div className={`scan-row__chg ${changeClass(r.changePct)}`}>{fmtPct(r.changePct)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function rank(list, bias) {
  const key = bias === 'bullish' ? (a) => a.analysis.bullishProbability : (a) => a.analysis.bearishProbability;
  return [...list].sort((a, b) => key(b) - key(a));
}
