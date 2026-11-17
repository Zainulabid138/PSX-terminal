// Formatting helpers shared across the UI. All display-only; no data invented.

export function fmtPrice(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPKR(n) {
  if (n == null) return 'Data unavailable from source.';
  return 'Rs ' + fmtPrice(n);
}

export function fmtPct(n, withSign = true) {
  if (n == null) return '—';
  const s = withSign && n >= 0 ? '+' : '';
  return `${s}${Number(n).toFixed(2)}%`;
}

export function fmtVolume(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toLocaleString('en-PK');
}

export function fmtNum(n, dp = 2) {
  if (n == null) return '—';
  return Number(n).toFixed(dp);
}

export function changeClass(n) {
  if (n == null) return 'neutral';
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'neutral';
}

/**
 * Shariah-compliance status, derived from PSX's own index membership (the
 * `listedIn` field on each market-watch row). A stock in the KMI All-Share
 * Islamic Index (KMIALLSHR) has passed the PSX/Meezan Shariah screening; KMI-30
 * is the blue-chip Shariah subset. This is official exchange data, not a guess.
 * If listedIn is missing (symbol not in today's snapshot) we return unknown
 * rather than claiming either way.
 */
export function shariahStatus(listedIn) {
  if (!Array.isArray(listedIn) || !listedIn.length) return { known: false, compliant: false, kmi30: false, label: 'Shariah status: unknown' };
  const compliant = listedIn.includes('KMIALLSHR');
  const kmi30 = listedIn.includes('KMI30');
  return {
    known: true,
    compliant,
    kmi30,
    label: compliant ? (kmi30 ? 'Shariah-compliant (KMI-30)' : 'Shariah-compliant (KMI)') : 'Not Shariah-compliant',
  };
}

export function fmtTime(unixSeconds) {
  if (!unixSeconds) return '—';
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString('en-PK', { hour12: true });
}
