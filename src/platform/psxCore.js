/**
 * psxCore.js
 * ----------
 * Platform-agnostic PSX data client: token handling + HTML/JSON parsing, with
 * the actual network call INJECTED (`request`). This lets the same fetch+parse
 * logic run on mobile (Capacitor native HTTP — bypasses CORS) exactly as it does
 * in Electron's main process. Parsing mirrors `electron/psxService.js` 1:1.
 *
 * `request({ url, method, headers, body }) => Promise<{ status, text }>`
 */
import * as cheerio from 'cheerio';

const BASE = 'https://dps.psx.com.pk';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function num(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function createPsxClient({ request }) {
  let _token = null;
  let _tokenAt = 0;
  const TTL = 15 * 60 * 1000;

  async function getToken(force = false) {
    if (!force && _token && Date.now() - _tokenAt < TTL) return _token;
    const { text } = await request({ url: `${BASE}/`, method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' } });
    const m = (text || '').match(/"_k"\s*:\s*"([A-Za-z0-9_-]+)"/);
    if (!m) throw new Error('Unable to obtain PSX access token from source.');
    _token = m[1]; _tokenAt = Date.now();
    return _token;
  }

  // Token-authenticated request with one refresh+retry on 403/401.
  async function req(url, { method = 'GET', body = null, referer = `${BASE}/`, json = false } = {}) {
    const run = async (token) => request({
      url, method, body,
      headers: {
        'User-Agent': UA,
        Accept: json ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Req-Id': token,
        Referer: referer,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
    let r = await run(await getToken());
    if (r.status === 403 || r.status === 401) r = await run(await getToken(true));
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.text;
  }

  async function getSymbolsMap() {
    const body = await req(`${BASE}/symbols`, { json: true });
    const arr = JSON.parse(body);
    const map = new Map();
    for (const item of arr) {
      if (!item || !item.symbol) continue;
      map.set(item.symbol, { name: item.name || null, sectorName: item.sectorName || null, isETF: !!item.isETF, isDebt: !!item.isDebt });
    }
    return map;
  }

  async function getMarketWatch() {
    const [html, symbols] = await Promise.all([
      req(`${BASE}/market-watch`),
      getSymbolsMap().catch(() => new Map()),
    ]);
    const $ = cheerio.load(html);
    const rows = [];
    $('tbody.tbl__body tr').each((_, tr) => {
      const $tds = $(tr).find('td');
      if ($tds.length < 11) return;
      const $symCell = $($tds[0]);
      const symbol = ($symCell.find('a.tbl__symbol strong').text() || $symCell.attr('data-order') || '').trim();
      if (!symbol) return;
      const titleAttr = $symCell.find('a.tbl__symbol').attr('data-title');
      const sectorCode = $($tds[1]).text().trim() || null;
      const listedIn = ($($tds[2]).text().trim() || '').split(',').map((s) => s.trim()).filter(Boolean);
      const meta = symbols.get(symbol) || {};
      const g = (i) => num($($tds[i]).attr('data-order') ?? $($tds[i]).text());
      rows.push({
        symbol,
        name: meta.name || titleAttr || null,
        sectorName: meta.sectorName || null,
        sectorCode,
        isETF: !!meta.isETF,
        isDebt: !!meta.isDebt,
        listedIn,
        ldcp: g(3), open: g(4), high: g(5), low: g(6), current: g(7), change: g(8), changePct: g(9), volume: g(10),
      });
    });
    return { fetchedAt: Date.now(), count: rows.length, rows };
  }

  async function getEod(symbol) {
    const body = await req(`${BASE}/timeseries/eod/${encodeURIComponent(symbol)}`, { json: true, referer: `${BASE}/company/${symbol}` });
    const json = JSON.parse(body);
    if (!json || json.status !== 1 || !Array.isArray(json.data)) throw new Error(`No EOD data from source for ${symbol}.`);
    return json.data
      .map((r) => ({ time: r[0], close: num(r[1]), volume: num(r[2]), prevClose: num(r[3]) }))
      .filter((p) => p.close !== null)
      .sort((a, b) => a.time - b.time);
  }

  async function getIntraday(symbol) {
    const body = await req(`${BASE}/timeseries/int/${encodeURIComponent(symbol)}`, { json: true, referer: `${BASE}/company/${symbol}` });
    const json = JSON.parse(body);
    if (!json || json.status !== 1 || !Array.isArray(json.data)) throw new Error(`No intraday data from source for ${symbol}.`);
    return json.data
      .map((r) => ({ time: r[0], price: num(r[1]), volume: num(r[2]) }))
      .filter((p) => p.price !== null)
      .sort((a, b) => a.time - b.time);
  }

  async function getAnnouncements({ type = 'C', count = 25, offset = 0, symbol = '', page = '' } = {}) {
    const body = new URLSearchParams({ type, symbol: symbol || '', query: '', count: String(count), offset: String(offset), date_from: '', date_to: '', page }).toString();
    const html = await req(`${BASE}/announcements`, { method: 'POST', body });
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
      items.push({ date: $($tds[0]).text().trim() || null, time: $($tds[1]).text().trim() || null, symbol: sym || null, name: name || null, title: title || null, pdfUrl });
    });
    return { fetchedAt: Date.now(), count: items.length, items };
  }

  async function getPayouts(symbol) {
    const body = new URLSearchParams({ symbol }).toString();
    const html = await req(`${BASE}/company/payouts`, { method: 'POST', body, referer: `${BASE}/company/${symbol}` });
    const $ = cheerio.load(html);
    const items = [];
    $('table.tbl tbody.tbl__body tr, table.tbl tr').each((_, tr) => {
      const $tds = $(tr).find('td');
      if ($tds.length < 4) return;
      const date = $($tds[0]).text().trim();
      const details = $($tds[2]).text().trim();
      const bookClosure = $($tds[3]).text().trim();
      if (!date && !details) return;
      items.push({ date, details, bookClosure });
    });
    return { symbol, items };
  }

  async function getSymbols() {
    const map = await getSymbolsMap();
    return Array.from(map.entries()).map(([symbol, v]) => ({ symbol, ...v }));
  }

  return { getMarketWatch, getEod, getIntraday, getAnnouncements, getPayouts, getSymbols };
}
