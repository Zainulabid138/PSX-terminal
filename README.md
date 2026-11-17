# PSX Terminal

A premium **Windows desktop terminal** for the **Pakistan Stock Exchange (PSX)**, built with
**React + Electron + Vite**. It monitors every listed PSX symbol in real time, computes
**real** technical indicators, and produces a **transparent, probability‑based** analysis with
the reasoning behind every signal — never a guarantee.

> ⚠️ **Decision‑support tool, not financial advice.** Every output is probability‑based. Markets
> carry risk. The app never claims certainty and never uses words like "guaranteed" or "sure shot".

---

## What it does

- **Live market** — all listed PSX symbols with price, OHLC, % change and volume, polled on an interval (background, non‑blocking).
- **Dashboard** — listed‑symbol count, advancers/decliners, total volume, top gainers/losers, most active, and a **volume‑weighted sector heatmap**.
- **Interactive charts** — zoom / pan / crosshair (TradingView `lightweight-charts`), daily close + volume + EMA overlays, and intraday tick view.
- **Technical indicators** — RSI, MACD, EMA (9/20/50/100/200), Bollinger Bands, OBV, ROC, close‑based Stochastic, return volatility, 20‑day average volume, 52‑week high/low, intraday VWAP.
- **Price action / patterns** — support & resistance, trend structure, breakout/breakdown, double top/bottom, gaps, and today's single‑candle patterns.
- **AI analysis (rule‑based, transparent)** — combines trend, momentum, volume, price action and volatility into an **upward probability + confidence + risk**, with **bullish/bearish reasons**, an **alternative scenario**, and a **trade plan** (entry/stop/targets/R:R) only when there is a clear edge.
- **AI Scanner** — ranks the most active symbols by probability edge (low‑confidence/conflicting setups excluded).
- **AI Assistant** — ask "Analyze HUBC", "Should I buy MARI?", "Find breakout stocks", "Show oversold stocks", "Explain MACD", etc. Answers come only from real analysis.
- **Watchlist** — persisted locally.

---

## Data source & honesty rules

Data comes from the **official PSX data portal** (`https://dps.psx.com.pk`):

| Endpoint | Used for |
|---|---|
| `/symbols` | company names + real sector names |
| `/market-watch` | live snapshot (OHLC, change, volume) for every symbol |
| `/timeseries/eod/{SYMBOL}` | daily close + volume history |
| `/timeseries/int/{SYMBOL}` | intraday ticks |

This app follows strict no‑fabrication rules:

- **Never invents prices, signals, or values.** If the source has no value, it shows **"Data unavailable from source."**
- If there isn't enough history for an indicator, it shows **"Insufficient data to calculate."**
- The PSX EOD feed provides daily **close + volume but not historical OHLC**, so indicators that strictly require historical highs/lows — **ATR, ADX, CCI, SuperTrend, Ichimoku, Parabolic SAR** — and **multi‑candle candlestick patterns** are reported as unavailable rather than approximated. **Market cap** (needs shares outstanding) is likewise marked unavailable. This is stated openly in the Stock Detail view.
- Low confidence or conflicting signals → **"No clear trading edge."** The app never forces a Buy/Sell.

> **Usage note:** PSX restricts commercial redistribution of its market data. This project is for
> personal/educational analysis. For commercial use, obtain a licence from PSX
> (`marketdatarequest@psx.com.pk`).

---

## Install & run

**Requirements:** Node.js 18+ (includes the `fetch` used by the backend) and Windows 10/11.

```bash
# 1. install dependencies
npm install

# 2. run in development (Vite dev server + Electron)
npm run dev
```

The desktop window opens automatically and connects to live PSX data.

### Production build / installer

```bash
npm run build      # build the React renderer into dist/
npm start          # build, then launch the packaged renderer in Electron
npm run dist       # build a Windows installer (NSIS) into release/  (needs electron-builder)
```

---

## Project structure

```
trading-app/
├─ electron/
│  ├─ main.js          # Electron entry, window, IPC handlers, notifications
│  ├─ preload.js       # secure contextBridge API (window.psx.*)
│  ├─ psxService.js    # all PSX portal fetching + parsing (no fabrication)
│  └─ store.js         # local JSON persistence (watchlist / settings)
├─ src/
│  ├─ main.jsx         # React entry
│  ├─ App.jsx          # shell: sidebar, topbar, global search, routing
│  ├─ index.css        # premium dark theme
│  ├─ store/
│  │  └─ MarketContext.jsx   # polling, market status, analysis cache
│  ├─ lib/
│  │  ├─ indicators.js # technical indicators (pure functions)
│  │  ├─ patterns.js   # price‑action / pattern detection
│  │  ├─ aiEngine.js   # probability scoring, reasons, buy/sell engine
│  │  └─ assistant.js  # local rule‑based chat assistant
│  ├─ utils/
│  │  ├─ format.js
│  │  └─ marketStatus.js     # PSX session status (PKT)
│  └─ components/      # Dashboard, MarketTable, Scanner, StockDetail,
│                      # PriceChart, Heatmap, Watchlist, AskAssistant, common
├─ index.html
├─ vite.config.js
└─ package.json
```

---

## How the probability score works

Each real signal (EMA alignment, MACD vs signal, RSI zone, ROC, volume vs average, OBV slope,
Bollinger position, breakout, trend structure, double top/bottom, gaps, today's candle) is
weighted and summed into a net score, mapped through a logistic function to an **upward
probability (0–100%)**. **Confidence** is High/Medium/Low based on how strongly the signals
agree and how much history exists; conflicting evidence lowers confidence and is shown explicitly.
Trade plans size stops from **close‑return volatility** (a faithful substitute for ATR, which the
source can't supply) and place targets at detected resistance/support and risk multiples.

---

## Roadmap (not in this first build)

Portfolio P/L, alerts (desktop/sound/Telegram/email), news & economic calendar, drawing tools,
and additional named chart patterns. The architecture (services, IPC, lib, components) is laid out
so these slot in cleanly.
