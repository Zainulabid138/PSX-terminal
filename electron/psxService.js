'use strict';

/**
 * psxService.js
 * -------------
 * All communication with the Pakistan Stock Exchange (PSX) public data portal
 * (https://dps.psx.com.pk) lives here. This module runs inside the Electron
 * MAIN process (Node.js), which means it is free of browser CORS restrictions.
 *
 * Endpoints used (all return REAL exchange data):
 *   - GET /symbols                       -> master list: symbol, name, sectorName, isETF, isDebt
 *   - GET /market-watch                  -> live snapshot table for every listed symbol (HTML)
 *   - GET /timeseries/eod/{SYMBOL}       -> end-of-day series: [ts, close, volume, prevClose]
 *   - GET /timeseries/int/{SYMBOL}       -> intraday ticks:    [ts, price, volume]
 *
 * STRICT RULE: This module never fabricates data. If the source does not
 * provide a value, the value is returned as null and the UI shows
 * "Data unavailable from source." We never estimate or guess missing values.
 */

const cheerio = require('cheerio');

const BASE = 'https://dps.psx.com.pk';

// A browser-like User-Agent reduces the chance of the portal rejecting requests.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/json,*/*',
};

const REQUEST_TIMEOUT_MS = 20000;

/**
 * Fetch a URL with a timeout. Returns the raw text body.
 * Throws on network failure or non-2xx status so callers can surface
 * "Data unavailable from source." rather than silently inventing data.
 */
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a number that may contain thousands separators; return null if not parseable. */
function num(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Symbols master list (company names + real sector names)
// ---------------------------------------------------------------------------

let _symbolsCache = null;
let _symbolsFetchedAt = 0;
const SYMBOLS_TTL_MS = 6 * 60 * 60 * 1000; // refresh master list at most every 6 hours

/**
 * Returns a Map: SYMBOL -> { name, sectorName, isETF, isDebt }.
 * Cached because the listing rarely changes intraday.
 */
async function getSymbols() {
  const now = Date.now();
  if (_symbolsCache && now - _symbolsFetchedAt < SYMBOLS_TTL_MS) {
    return _symbolsCache;
  }
  const body = await fetchText(`${BASE}/symbols`);
  let arr;
  try {
    arr = JSON.parse(body);
  } catch (e) {
    throw new Error('Unable to parse symbols list from source.');
  }
  const map = new Map();
  for (const item of arr) {
    if (!item || !item.symbol) continue;
    map.set(item.symbol, {
      name: item.name || null,
      sectorName: item.sectorName || null,
      isETF: !!item.isETF,
      isDebt: !!item.isDebt,
    });
  }
  _symbolsCache = map;
  _symbolsFetchedAt = now;
  return map;
}

// ---------------------------------------------------------------------------
// Market watch (live snapshot for every listed symbol)
// ---------------------------------------------------------------------------

/**
 * Fetches and parses the market-watch table.
 * Each row carries today's OHLC, the last day's close (LDCP), current price,
 * absolute & percentage change, and volume — all sourced directly from PSX.
 *
 * Company name and sector name are joined in from the /symbols master list.
 * Equities only (debt instruments / TFCs are filtered out for the equity view).
 */
async function getMarketWatch() {
  const [html, symbols] = await Promise.all([
    fetchText(`${BASE}/market-watch`),
    getSymbols().catch(() => new Map()), // degrade gracefully: still return price data
  ]);

  const $ = cheerio.load(html);
  const rows = [];

  $('tbody.tbl__body tr').each((_, tr) => {
    const $tds = $(tr).find('td');
    if ($tds.length < 11) return;

    const $symCell = $($tds[0]);
    const symbol = ($symCell.find('a.tbl__symbol strong').text() || $symCell.attr('data-order') || '')
      .trim();
    if (!symbol) return;

    const titleAttr = $symCell.find('a.tbl__symbol').attr('data-title');
    const sectorCode = $($tds[1]).text().trim() || null;
    const listedIn = ($($tds[2]).text().trim() || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const meta = symbols.get(symbol) || {};

    rows.push({
      symbol,
      name: meta.name || titleAttr || null,
      sectorName: meta.sectorName || null,
      sectorCode,
      isETF: !!meta.isETF,
      isDebt: !!meta.isDebt,
      listedIn,
      ldcp: num($($tds[3]).attr('data-order') ?? $($tds[3]).text()),
      open: num($($tds[4]).attr('data-order') ?? $($tds[4]).text()),
      high: num($($tds[5]).attr('data-order') ?? $($tds[5]).text()),
      low: num($($tds[6]).attr('data-order') ?? $($tds[6]).text()),
      current: num($($tds[7]).attr('data-order') ?? $($tds[7]).text()),
      change: num($($tds[8]).attr('data-order') ?? $($tds[8]).text()),
      changePct: num($($tds[9]).attr('data-order') ?? $($tds[9]).text()),
      volume: num($($tds[10]).attr('data-order') ?? $($tds[10]).text()),
    });
  });

  return {
    fetchedAt: Date.now(),
    count: rows.length,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Time series (EOD + intraday)
// ---------------------------------------------------------------------------

/**
 * End-of-day history for a symbol.
 * Source rows are [unixSeconds, close, volume, prevClose] (most-recent first).
 * Returned ascending by time. close & volume are the reliable fields and are
 * sufficient for trend/momentum/volume indicators. The source does not provide
 * historical OHLC, so open/high/low are intentionally absent (never invented).
 */
async function getEod(symbol) {
  const body = await fetchText(`${BASE}/timeseries/eod/${encodeURIComponent(symbol)}`);
  const json = JSON.parse(body);
  if (!json || json.status !== 1 || !Array.isArray(json.data)) {
    throw new Error(`No EOD data from source for ${symbol}.`);
  }
  const series = json.data
    .map((r) => ({
      time: r[0],
      close: num(r[1]),
      volume: num(r[2]),
      prevClose: num(r[3]),
    }))
    .filter((p) => p.close !== null)
    .sort((a, b) => a.time - b.time);
  return series;
}

/**
 * Intraday tick series for a symbol: [unixSeconds, price, volume].
 * Returned ascending by time. Used for the intraday price chart and VWAP.
 */
async function getIntraday(symbol) {
  const body = await fetchText(`${BASE}/timeseries/int/${encodeURIComponent(symbol)}`);
  const json = JSON.parse(body);
  if (!json || json.status !== 1 || !Array.isArray(json.data)) {
    throw new Error(`No intraday data from source for ${symbol}.`);
  }
  return json.data
    .map((r) => ({ time: r[0], price: num(r[1]), volume: num(r[2]) }))
    .filter((p) => p.price !== null)
    .sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// Company announcements (official PSX filings — factual headlines only)
// ---------------------------------------------------------------------------

/**
 * Fetch official PSX company announcements via the portal's POST endpoint.
 * Returns an array of { date, time, symbol, name, title, pdfUrl } — REAL
 * filings only. We never summarise or invent content; we surface the official
 * title and a link to the official PDF document.
 *
 * @param {object} opts
 *   - type:  'C' company, 'P' PSX, etc. (defaults to company announcements)
 *   - count: rows to return
 *   - offset: paging offset
 *   - symbol: optional symbol filter
 */
async function getAnnouncements({ type = 'C', count = 25, offset = 0, symbol = '', page = '' } = {}) {
  // page='' returns the FULL company announcement stream (board meetings,
  // results, dividends, disclosures). page='cbs' would return only Corporate
  // Briefing Sessions.
  const body = new URLSearchParams({
    type, symbol: symbol || '', query: '', count: String(count), offset: String(offset),
    date_from: '', date_to: '', page,
  }).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(`${BASE}/announcements`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for announcements`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);
  const items = [];
  $('#announcementsTable tbody.tbl__body tr, table.tbl tbody.tbl__body tr').each((_, tr) => {
    const $tds = $(tr).find('td');
    if ($tds.length < 5) return;
    const sym = $($tds[2]).find('strong').first().text().trim() || $($tds[2]).text().trim();
    const name = $($tds[3]).find('strong').first().text().trim() || $($tds[3]).text().trim();
    const title = $($tds[4]).text().trim();
    let pdfUrl = null;
    $($tds[5]).find('a').each((__, a) => {
      const href = $(a).attr('href') || '';
      if (href.toLowerCase().endsWith('.pdf')) pdfUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    });
    if (!title && !sym) return;
    items.push({
      date: $($tds[0]).text().trim() || null,
      time: $($tds[1]).text().trim() || null,
      symbol: sym || null,
      name: name || null,
      title: title || null,
      pdfUrl,
    });
  });
  return { fetchedAt: Date.now(), count: items.length, items };
}

/**
 * Structured payouts (dividends / bonus / rights) for a symbol, from the PSX
 * portal's POST /company/payouts. Returns real dividend %, type, and the
 * book-closure date range — so eligibility can be computed without PDFs.
 */
async function getPayouts(symbol) {
  const body = new URLSearchParams({ symbol }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(`${BASE}/company/payouts`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for payouts`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const $ = cheerio.load(html);
  const items = [];
  $('table.tbl tbody.tbl__body tr, table.tbl tr').each((_, tr) => {
    const $tds = $(tr).find('td');
    if ($tds.length < 4) return;
    const date = $($tds[0]).text().trim();
    const details = $($tds[2]).text().trim();     // e.g. "15%(ii) (D)"
    const bookClosure = $($tds[3]).text().trim();  // e.g. "27/07/2026  - 29/07/2026"
    if (!date && !details) return;
    items.push({ date, details, bookClosure });
  });
  return { symbol, items };
}

module.exports = {
  getSymbols,
  getMarketWatch,
  getEod,
  getIntraday,
  getAnnouncements,
  getPayouts,
};
