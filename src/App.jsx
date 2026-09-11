import React, { useMemo, useState } from 'react';
import { MarketProvider, useMarket } from './store/MarketContext.jsx';
import Dashboard from './components/Dashboard.jsx';
import MarketTable from './components/MarketTable.jsx';
import Scanner from './components/Scanner.jsx';
import StockDetail from './components/StockDetail.jsx';
import Watchlist from './components/Watchlist.jsx';
import AskAssistant from './components/AskAssistant.jsx';
import News from './components/News.jsx';
import Alerts from './components/Alerts.jsx';
import Opportunities from './components/Opportunities.jsx';
import LiveRadar from './components/LiveRadar.jsx';
import RupeeMovers from './components/RupeeMovers.jsx';
import PennyStocks from './components/PennyStocks.jsx';
import NextDay from './components/NextDay.jsx';
import Planner from './components/Planner.jsx';
import BuySignals from './components/BuySignals.jsx';
import ChartAnalyzer from './components/ChartAnalyzer.jsx';
import EarningsCalendar from './components/EarningsCalendar.jsx';
import Dividends from './components/Dividends.jsx';
import PositionSizer from './components/PositionSizer.jsx';
import TradeJournal from './components/TradeJournal.jsx';
import Portfolio from './components/Portfolio.jsx';
import Backtest from './components/Backtest.jsx';
import { getMarketStatus, pktTimeString } from './utils/marketStatus.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'portfolio', label: 'My Portfolio', icon: '📁' },
  { id: 'radar', label: 'Live Radar', icon: '⚡' },
  { id: 'rupeemovers', label: 'Rupee Movers', icon: '💹' },
  { id: 'penny', label: 'Penny Stocks', icon: '🪙' },
  { id: 'buysignals', label: 'Buy Signals', icon: '📈' },
  { id: 'opportunities', label: 'Top Picks', icon: '💡' },
  { id: 'nextday', label: 'Next-Day', icon: '🌙' },
  { id: 'planner', label: 'Planner', icon: '📅' },
  { id: 'chart', label: 'Chart Analyzer', icon: '🔎' },
  { id: 'sizer', label: 'Position Size', icon: '🧮' },
  { id: 'journal', label: 'Trade Journal', icon: '📓' },
  { id: 'backtest', label: 'Backtest', icon: '🔬' },
  { id: 'market', label: 'Market', icon: '≣' },
  { id: 'scanner', label: 'AI Scanner', icon: '◎' },
  { id: 'watchlist', label: 'Watchlist', icon: '★' },
  { id: 'alerts', label: 'Alerts', icon: '🔔' },
  { id: 'news', label: 'News', icon: '📰' },
  { id: 'earnings', label: 'Earnings', icon: '🗓️' },
  { id: 'dividends', label: 'Dividends', icon: '💰' },
  { id: 'assistant', label: 'AI Assistant', icon: '✦' },
];

function Clock() {
  const [, force] = useState(0);
  React.useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const status = getMarketStatus();
  return (
    <div className="clock">
      <span className={`status-dot status-dot--${status.open ? 'open' : 'closed'}`} />
      <span className="status-label">{status.label}</span>
      <span className="muted">{pktTimeString()}</span>
    </div>
  );
}

function GlobalSearch({ onSelect }) {
  const { equityRows } = useMarket();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return [];
    return equityRows
      .filter((r) => r.symbol.includes(t) || (r.name || '').toUpperCase().includes(t))
      .slice(0, 8);
  }, [q, equityRows]);

  return (
    <div className="global-search">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search PSX symbol or company…"
      />
      {open && matches.length > 0 && (
        <div className="search-drop">
          {matches.map((r) => (
            <div key={r.symbol} className="search-item" onMouseDown={() => { onSelect(r.symbol); setQ(''); setOpen(false); }}>
              <b>{r.symbol}</b> <span className="muted ellipsis">{r.name || ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { error, fetchedAt, refresh, hasBridge, loading } = useMarket();
  const [view, setView] = useState('dashboard');
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  const openStock = (symbol) => { setSelected(symbol); setView('detail'); };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark">PSX</div>
          <div className="brand__text"><b>PSX Terminal</b><span>Pakistan Stock Exchange</span></div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
              <span className="nav-item__icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="muted small">Data: dps.psx.com.pk</div>
          <div className="muted small">Probability-based. Not financial advice.</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <GlobalSearch onSelect={openStock} />
          <div className="topbar__right">
            <Clock />
            <button className="icon-btn" title="Refresh now" onClick={refresh}>⟳</button>
          </div>
        </header>

        {!hasBridge && (
          <div className="banner banner--warn">
            Running outside the desktop shell — live PSX data needs the Electron backend. Start with <code>npm run dev</code>.
          </div>
        )}
        {error && hasBridge && (
          <div className="banner banner--err">Data unavailable from source: {error}</div>
        )}
        {fetchedAt && (
          <div className="updated-bar">Last updated: {new Date(fetchedAt).toLocaleTimeString('en-PK', { hour12: true })}</div>
        )}

        <section className="view">
          {loading && view !== 'detail' && <div className="loading-pad">Connecting to PSX…</div>}
          {view === 'dashboard' && <Dashboard onSelect={openStock} />}
          {view === 'portfolio' && <Portfolio onSelect={openStock} />}
          {view === 'opportunities' && <Opportunities onSelect={openStock} />}
          {view === 'radar' && <LiveRadar onSelect={openStock} />}
          {view === 'rupeemovers' && <RupeeMovers onSelect={openStock} />}
          {view === 'penny' && <PennyStocks onSelect={openStock} />}
          {view === 'buysignals' && <BuySignals onSelect={openStock} />}
          {view === 'nextday' && <NextDay onSelect={openStock} />}
          {view === 'planner' && <Planner onSelect={openStock} />}
          {view === 'chart' && <ChartAnalyzer onSelect={openStock} />}
          {view === 'sizer' && <PositionSizer />}
          {view === 'journal' && <TradeJournal onSelect={openStock} />}
          {view === 'backtest' && <Backtest />}
          {view === 'market' && <MarketTable onSelect={openStock} query={search} />}
          {view === 'scanner' && <Scanner onSelect={openStock} />}
          {view === 'watchlist' && <Watchlist onSelect={openStock} />}
          {view === 'alerts' && <Alerts onSelect={openStock} />}
          {view === 'news' && <News onSelect={openStock} />}
          {view === 'earnings' && <EarningsCalendar onSelect={openStock} />}
          {view === 'dividends' && <Dividends onSelect={openStock} />}
          {view === 'assistant' && <AskAssistant onSelect={openStock} />}
          {view === 'detail' && (
            <div className="detail-view">
              <button className="back-btn" onClick={() => setView('market')}>← Back</button>
              <StockDetail symbol={selected} />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <MarketProvider>
      <Shell />
    </MarketProvider>
  );
}
