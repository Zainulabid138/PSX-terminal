/**
 * marketStatus.js
 * ---------------
 * Computes PSX session status from the current time in Pakistan Standard Time
 * (PKT = UTC+5, no daylight saving). Regular trading is Monday–Friday.
 *
 * Session times (normal, non-Ramadan schedule):
 *   Mon–Thu:  Pre-Open 09:15–09:30, Trading 09:30–15:30
 *   Friday:   Pre-Open 09:15–09:30, Session 1 09:30–12:00,
 *             Jumma break 12:00–14:30, Session 2 14:30–16:30 (closes 4:30 PM)
 *
 * NOTE: Public holidays and the shortened Ramadan schedule are not exhaustively
 * tracked here, so on a gazetted holiday the label may read "Open" while the
 * exchange is actually closed, and exact Friday break boundaries can shift. The
 * live data from the source remains the source of truth.
 */

export function getMarketStatus(now = new Date()) {
  // Convert to PKT regardless of the machine's local timezone.
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const pkt = new Date(utcMs + 5 * 3600000);
  const day = pkt.getDay(); // 0 Sun ... 6 Sat
  const minutes = pkt.getHours() * 60 + pkt.getMinutes();

  if (day === 0 || day === 6) {
    return { state: 'Closed', label: 'Closed (Weekend)', open: false, pkt };
  }

  const preOpen = 9 * 60 + 15; // 09:15
  const open = 9 * 60 + 30; // 09:30

  if (day === 5) {
    // Friday — split session around the Jumma break, closes 4:30 PM.
    const s1End = 12 * 60; // 12:00
    const s2Start = 14 * 60 + 30; // 14:30
    const close = 16 * 60 + 30; // 16:30
    if (minutes >= preOpen && minutes < open) return { state: 'Pre-Open', label: 'Pre-Open (Friday)', open: false, pkt };
    if (minutes >= open && minutes < s1End) return { state: 'Open', label: 'Market Open (Friday AM)', open: true, pkt };
    if (minutes >= s1End && minutes < s2Start) return { state: 'Break', label: 'Jumma Break', open: false, pkt };
    if (minutes >= s2Start && minutes < close) return { state: 'Open', label: 'Market Open (Friday PM)', open: true, pkt };
    return { state: 'Closed', label: 'Closed', open: false, pkt };
  }

  // Monday–Thursday.
  const close = 15 * 60 + 30; // 15:30
  if (minutes >= preOpen && minutes < open) return { state: 'Pre-Open', label: 'Pre-Open Session', open: false, pkt };
  if (minutes >= open && minutes < close) return { state: 'Open', label: 'Market Open', open: true, pkt };
  return { state: 'Closed', label: 'Closed', open: false, pkt };
}

export function pktTimeString(now = new Date()) {
  const { pkt } = getMarketStatus(now);
  return pkt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) + ' PKT';
}
