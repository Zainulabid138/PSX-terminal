# PSX Terminal — Developer Context (CLAUDE.md)

A production-quality **Windows desktop app** for the Pakistan Stock Exchange (PSX): live market data, technical + rule-based analysis, honest probability-based trade guidance, portfolio tracking, and real-time alerts. Built for a retail trader who wants disciplined, evidence-based decisions — **never fabricated data, never guaranteed profit.**

---

## 1. Stack & how to run

- **Electron** (main + preload + IPC) · **React 18** · **Vite** · **lightweight-charts** · **cheerio** (HTML parsing in main process).
- No backend server. PSX data is fetched directly from `dps.psx.com.pk` inside the **Electron main process** (no CORS there).

```bash
npm run dev      # Vite + Electron in dev (hot reload)
npm run build    # Vite production build -> dist/
npm run start    # build + launch Electron (production-like)
npm run dist     # build + electron-builder -> release/ (NSIS Setup.exe)
npm run pack     # build + electron-builder --dir (unpacked, for a portable ZIP)
```

Current version: see `package.json` (`version`). Release artifacts land in `release/`.

### ⚠️ Critical gotcha — ELECTRON_RUN_AS_NODE
This machine has **`ELECTRON_RUN_AS_NODE=1` set globally**, which makes `require('electron')` return a string and **breaks every Electron launch**. All launches go through **`scripts/start-electron.cjs`**, which does `delete process.env.ELECTRON_RUN_AS_NODE` before spawning Electron. Never launch electron directly — always via that launcher (the npm scripts already do).

Other build notes:
- electron-builder may hit a **winCodeSign "Cannot create symbolic link"** error (Windows privilege). Fix: manually extract `winCodeSign-2.6.0.7z` without symlinks into the electron-builder cache, clean partial dirs, rebuild. It built cleanly most recently.
- App is **not code-signed** → users see a SmartScreen warning → "More info" → "Run anyway". This is expected.

---

## 2. Architecture

```
electron/
  main.js         BrowserWindow (backgroundThrottling:false + powerSaveBlocker),
                  all IPC handlers wrapping psxService + store, desktop notifications.
  preload.js      contextBridge -> window.psx.* (the ONLY renderer<->main channel).
  psxService.js   ALL PSX network calls + HTML/JSON parsing. Never fabricates.
  store.js        JSON persistence in Electron userData (watchlist, alerts, journal,
                  holdings, radarLog, notes, settings).
scripts/
  start-electron.cjs   Launcher that neutralises ELECTRON_RUN_AS_NODE.
src/
  store/MarketContext.jsx   Central state + polling + all scans/alerts. The brain.
  lib/            Pure analysis modules (no React). Unit-testable via node.
  components/     UI. One file per view/tab.
  utils/          format.js, marketStatus.js, csv.js.
  App.jsx         Shell: sidebar NAV array + view routing.
```

**Data flow:** `psxService.js` → IPC (`main.js`) → `preload.js` (`window.psx.*`) → `MarketContext.jsx` (state, caching, scans) → components. Analysis is computed in `src/lib/*` from the fetched data.

---

## 3. PSX data source (`electron/psxService.js`)

Base: `https://dps.psx.com.pk`. All real exchange data; **missing values are returned as `null` and the UI shows "Data unavailable from source." — never estimated.**

| Function | Endpoint | Returns |
|---|---|---|
| `getSymbols()` | `GET /symbols` | Map: symbol → {name, sectorName, isETF, isDebt} (cached 6h) |
| `getMarketWatch()` | `GET /market-watch` (HTML) | Live snapshot rows: current, ldcp, open/high/low, change, changePct, volume, **`listedIn`** (index membership) |
| `getEod(symbol)` | `GET /timeseries/eod/{SYM}` | `[{time, close, volume, prevClose}]` ascending. **No historical OHLC** — only close. Works for indices too (`KSE100`, `KMIALLSHR`, `KMI30`, `ALLSHR`). |
| `getIntraday(symbol)` | `GET /timeseries/int/{SYM}` | `[{time, price, volume}]` current session ticks |
| `getAnnouncements(opts)` | `POST /announcements` | Official filings `[{date,time,symbol,name,title,pdfUrl}]`. `page:''` = full stream |
| `getPayouts(symbol)` | `POST /company/payouts` | Structured dividends `[{date, details, bookClosure}]` |

**Key derived facts from `listedIn`:**
- **Shariah-compliant** = `listedIn.includes('KMIALLSHR')` (KMI All-Share Islamic Index; `KMI30` = blue-chip Islamic). This is official PSX/Meezan screening — see `utils/format.js → shariahStatus()`.

**Source limitations (never faked):** no historical OHLC → no ADX/ATR/CCI/Keltner/multi-candle patterns; intraday can return a partial tick window for active stocks.

---

## 4. The analysis engine (`src/lib/`)

Everything here is **pure** (no React) — testable with a quick node script (see §7).

| File | Role |
|---|---|
| `aiEngine.js` | `analyze({snapshot, eod, intradayVwap, indexSeries, sectorStrength})` → the core object: trend (D/W/M), momentum, volume, support/resistance, bullish/bearishProbability, confidence (capped ≤90), tradeQuality, metrics{ema20/50/200, rsi, macd, support, resistance, hi52/lo52, todayChangePct, vol60, fib, pivots...}, unavailable[]. `MIN_BARS=60`. |
| `indicators.js` | SMA, EMA, RSI (Wilder), MACD, Bollinger, OBV, ROC, StochRSI, VWAP, volatility. |
| `strategy.js` | `marketRegime` (Risk-On/Off), `stageAnalysis` (Weinstein Stage 1–4, 150-day MA), `classifySetup`, `computeTradeLevels` (buyZone/stop/targets), `applyStrategy` (decorates analysis: stage, traderCall/traderCallTone, conviction, levels), `buyTurnSignal` (dip-turn buy), **`holdingStrategy`** (Portfolio verdict), `horizonFit`, `marketStance`. |
| `traderDesk.js` | **`traderDesk(a, regime)`** → forward, trader-voice opinion: lean/badge, thesis, bull/bear if-then paths, plan (trigger/invalidation/target/timeframe), honest conviction. Rendered in StockDetail. |
| `corporateAction.js` | **`detectCorporateAction(announcements)`** (keyword match on real filing titles → rights issue / de-listing / suspension / merger / bonus...) + `tapeWarning(tape)`. Gates Buy Signals & Top Picks. |
| `tape.js` | `analyzeTape(ticks)` → large-print buy/sell via up/down-tick rule → verdict + `bias` (buy/sell/neutral) + buyPct. |
| `portfolioHealth.js` | `portfolioHealth(rows)` → structural score (concentration, downtrend exposure, inverted allocation) + prioritised actions. |
| `projection.js` | `project(price, dailyVolPct, horizon)` → realistic volatility range (NOT a forecast). |
| `patterns.js`, `backtest.js`, `chartRead.js`, `assistant.js` | swing S/R, no-look-ahead backtest, plain chart narrative, local chat. |

---

## 5. Central state (`src/store/MarketContext.jsx`)

The single source of truth. Key responsibilities:
- **Polling** market-watch every `settings.refreshSeconds`; exposes `rows` / `equityRows`.
- **`getAnalysis(symbol)`** — fetch EOD (+intraday VWAP+tape), run `analyze` + `applyStrategy`, cache 5 min. Attaches `a.tape`.
- **`getIndexQuote(symbol)`** — index level + change vs last close (Dashboard index board).
- **`realWorldWarnings(symbol, a)`** — shared reality-check (corporate actions from filings + tape). Used to gate/demote **Buy Signals AND Top Picks**, and to silence buy alerts.
- Scans (state persists across tab switches): `runOpportunityScan` (Top Picks), `runBuySignalScan`, `runNextDayScan`, `runPlannerScan`, `runDividendScan`, `radar`.
- **Alerts (desktop + sound, from any tab, market-open only):**
  - Trade Journal open positions → stop/target.
  - **Portfolio holdings guard** (every 2 min) → hard stop, downtrend turn (early sell), EMA20 break in loss, sharp drop, distribution. Per-holding `stop` is user-editable.
  - Watchlist buy-turn alerts (gated by `realWorldWarnings`).
- **Persistence:** holdings are **lot-based** — `{symbol, lots:[{id,qty,price,at}], stop, addedAt}`; qty/avgCost are derived. `addHolding` appends a lot; `removeLot`, `setHoldingStop`.

---

## 6. Components / tabs (nav order in `App.jsx`)

Dashboard (index board + gainers/losers + heatmap) · **My Portfolio** (lots, P/L, Health panel, alert-stop) · Live Radar · **Rupee Movers** (Rs-move + price bands) · **Penny Stocks** · Buy Signals (self-vetted) · Top Picks / Opportunities (self-vetted) · Next-Day · Planner · Chart Analyzer · Position Size · Trade Journal · Backtest · Market · AI Scanner · Watchlist · Alerts · News · Earnings · Dividends · AI Assistant.

`StockDetail.jsx` (opened on any symbol click) shows **Trader's Desk** panel, quote grid, Shariah badge, chart, tape, news, projection.

---

## 7. Conventions & rules (IMPORTANT — keep these)

1. **Honesty is the product.** Never invent data. No guaranteed profit. Always probability + a stop + risk. Surface source limitations plainly. Roman-Urdu explanations for the user are fine and expected.
2. **React hook imports** — Vite build does NOT catch a missing hook import (`useMemo`/`useEffect`/...); it becomes a runtime blank-screen crash (happened once with EarningsCalendar). **After editing any component, verify every hook used is imported.** Quick audit script pattern used before: grep hooks used vs the `import React` line.
3. **Test lib logic with node** before wiring UI. Pattern: write a temp `.mjs` **inside the project dir** (relative ESM imports need it — `/tmp` fails), import from `./src/lib/...`, fetch live PSX data with cheerio, run the function, print, then delete. See git history / prior scans.
4. **PKT timezone** — PSX session Mon–Thu 09:30–15:30; Friday split with Jumma break (closes 16:30). Chart timestamps need `+5h` (PKT_OFFSET). See `utils/marketStatus.js`.
5. **Trade levels** must be ordered and give R:R ≥ ~1.5; bearish/Stage-4 stocks get `levels=null` + a `noLevelsReason` (no long plans on downtrends).
6. **New reality-checks** (rights issue, tape, etc.) go through `realWorldWarnings` so Buy Signals + Top Picks stay consistent.
7. Build after every change: `npm run build` (should end "✓ built in …", modules count grows as files are added).

---

## 8. Common tasks

- **Add a new tab:** create `src/components/X.jsx` → import in `App.jsx` → add to `NAV` array → add `{view === 'x' && <X onSelect={openStock} />}` in the view switch → add CSS in `src/index.css`.
- **Add a PSX endpoint:** add fn in `psxService.js` → IPC handler in `main.js` → expose in `preload.js` → wrap in `MarketContext.jsx`.
- **Add persisted data:** add key to `DEFAULTS` in `store.js` + a `setX` fn → IPC in `main.js` → `preload.js` → load in MarketContext's `getState()` effect → add a setter.
- **Cut a release:** bump `version` in `package.json` → `npm run dist` (Setup.exe) → optionally zip `release/win-unpacked/*` for portable. Files in `release/`.

---

## 9. Quick reference — key computed fields on `getAnalysis` result `a`

`a.ok`, `a.price`, `a.stage.{stage,label}`, `a.trend.{daily,weekly,monthly}`, `a.bullishProbability` / `a.bearishProbability`, `a.confidence`, `a.conviction`, `a.traderCall` / `a.traderCallTone` (buy/neutral/sell), `a.levels.{buyZone,stopLoss,targets[],riskReward}` (or null + `a.noLevelsReason`), `a.relativeStrength.label`, `a.tape.{bias,buyPct}`, `a.metrics.{ema20,ema50,ema200,rsi,macd,support,resistance,hi52,lo52,todayChangePct,avgVol20,vol60}`, `a.unavailable[]`.

Row (market-watch) fields: `symbol, name, sectorName, current, ldcp, open, high, low, change, changePct, volume, listedIn[], isDebt, isETF`.
