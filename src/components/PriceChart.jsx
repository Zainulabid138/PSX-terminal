import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { ema } from '../lib/indicators.js';
import { Spinner, Empty } from './common.jsx';

/**
 * lightweight-charts has no timezone support — it always renders UNIX
 * timestamps in UTC. PSX trades in Pakistan Standard Time (UTC+5, no DST), so
 * raw timestamps would show the 09:30–15:30 session as 04:30–10:30 (UTC).
 * We shift every plotted timestamp by +5h so the (UTC-rendered) axis and
 * crosshair read correct PKT clock times. This is display-only.
 */
const PKT_OFFSET = 5 * 3600;
const toPkt = (unixSeconds) => unixSeconds + PKT_OFFSET;

/** Collapse duplicate timestamps (keep the last) so lightweight-charts accepts the series. */
function dedupeByTime(points) {
  const map = new Map();
  for (const p of points) map.set(p.time, p);
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/**
 * PriceChart
 * ----------
 * Interactive chart (zoom, pan, crosshair via lightweight-charts).
 *
 * Honesty note: the PSX EOD endpoint provides daily CLOSE + VOLUME but not
 * historical OHLC, so the daily timeframe is drawn as a faithful close-based
 * AREA line with volume histogram and EMA overlays — not invented candles.
 * The intraday timeframe draws the real tick price line.
 */
export default function PriceChart({ symbol, timeframe, snapshot }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [partial, setPartial] = useState('');

  useEffect(() => {
    if (!symbol || !window.psx) { setStatus('error'); setErrorMsg('Data unavailable from source.'); return; }
    let disposed = false;
    setStatus('loading');
    setPartial('');

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: { background: { color: 'transparent' }, textColor: '#9fb0c3' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: timeframe === 'intraday', secondsVisible: false },
      width: el.clientWidth,
      height: el.clientHeight,
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    async function load() {
      try {
        if (timeframe === 'intraday') {
          const res = await window.psx.getIntraday(symbol);
          if (!res.ok || !res.data.length) throw new Error('Insufficient data to calculate.');
          if (disposed) return;
          const hi = snapshot?.high; const lo = snapshot?.low; const pc = snapshot?.ldcp;
          const line = chart.addAreaSeries({
            lineColor: '#3a86ff', topColor: 'rgba(58,134,255,0.25)', bottomColor: 'rgba(58,134,255,0.0)', lineWidth: 2,
            // Make the scale include today's true high/low even if the tick feed
            // only returned a partial (recent) window for a very active stock.
            autoscaleInfoProvider: (orig) => {
              const rr = orig();
              if (rr && rr.priceRange) {
                if (hi != null) rr.priceRange.maxValue = Math.max(rr.priceRange.maxValue, hi);
                if (lo != null) rr.priceRange.minValue = Math.min(rr.priceRange.minValue, lo);
              }
              return rr;
            },
          });
          const pts = dedupeByTime(res.data.map((d) => ({ time: toPkt(d.time), value: d.price })));
          line.setData(pts);
          // Real day-range reference lines from the snapshot (source of truth).
          const op = snapshot?.open;
          if (hi != null) line.createPriceLine({ price: hi, color: 'rgba(255,90,95,0.75)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Day High' });
          if (lo != null) line.createPriceLine({ price: lo, color: 'rgba(33,208,122,0.75)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Day Low' });
          if (op != null) line.createPriceLine({ price: op, color: 'rgba(244,183,64,0.8)', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'Open' });
          if (pc != null) line.createPriceLine({ price: pc, color: 'rgba(130,148,171,0.8)', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'Prev Close' });

          // Show the FULL session on the x-axis (09:30–15:30 PKT), even if the
          // tick feed only returned a later window — so the chart reads as a
          // whole trading day from the open.
          const lastT = pts[pts.length - 1].time; // PKT-shifted timestamp
          const dt = new Date(lastT * 1000);
          const y = dt.getUTCFullYear(); const mo = dt.getUTCMonth(); const da = dt.getUTCDate();
          const sessionOpen = Date.UTC(y, mo, da, 9, 30) / 1000;
          const sessionClose = Date.UTC(y, mo, da, 15, 30) / 1000;
          try {
            chart.timeScale().setVisibleRange({ from: sessionOpen, to: Math.max(sessionClose, lastT) });
          } catch (e) { chart.timeScale().fitContent(); }

          // Note if the plotted ticks start well after the open.
          const firstT = pts[0].time;
          const fdt = new Date(firstT * 1000);
          const mins = fdt.getUTCHours() * 60 + fdt.getUTCMinutes();
          if (mins > 9 * 60 + 45) {
            const hh = String(fdt.getUTCHours()).padStart(2, '0');
            const mm = String(fdt.getUTCMinutes()).padStart(2, '0');
            setPartial(`The tick feed only returned prices from ${hh}:${mm} PKT for this very active stock, so the line starts there. The full session (09:30–15:30) is on the axis, and today's real Open / High / Low are drawn as reference lines.`);
          }
        } else {
          const res = await window.psx.getEod(symbol);
          if (!res.ok || !res.data.length) throw new Error('Insufficient data to calculate.');
          if (disposed) return;
          const data = res.data;
          const area = chart.addAreaSeries({ lineColor: '#21d07a', topColor: 'rgba(33,208,122,0.20)', bottomColor: 'rgba(33,208,122,0.0)', lineWidth: 2, priceLineVisible: true });
          area.setData(dedupeByTime(data.map((d) => ({ time: toPkt(d.time), value: d.close }))));

          // EMA overlays (faithful from close)
          const closes = data.map((d) => d.close);
          const addEma = (period, color) => {
            if (closes.length < period) return;
            const e = ema(closes, period);
            const series = chart.addLineSeries({ color, lineWidth: 1 });
            series.setData(data.map((d, i) => (e[i] != null ? { time: toPkt(d.time), value: e[i] } : null)).filter(Boolean));
          };
          addEma(20, '#f4a261');
          addEma(50, '#9b5de5');

          // Volume histogram on a separate scale
          const vol = chart.addHistogramSeries({ priceScaleId: 'vol', color: 'rgba(120,140,170,0.4)', priceFormat: { type: 'volume' } });
          chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
          vol.setData(dedupeByTime(data.map((d, i) => ({
            time: toPkt(d.time),
            value: d.volume || 0,
            color: i > 0 && d.close >= data[i - 1].close ? 'rgba(33,208,122,0.45)' : 'rgba(255,90,95,0.45)',
          }))));
          chart.timeScale().fitContent();
        }
        if (!disposed) setStatus('ready');
      } catch (e) {
        if (!disposed) { setStatus('error'); setErrorMsg(e.message || 'Data unavailable from source.'); }
      }
    }
    load();

    return () => {
      disposed = true;
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, timeframe]);

  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart-canvas" />
      {timeframe === 'daily' && status === 'ready' && (
        <div className="chart-legend">
          <span><i style={{ background: '#21d07a' }} />Price</span>
          <span><i style={{ background: '#f4a261' }} />EMA 20</span>
          <span><i style={{ background: '#9b5de5' }} />EMA 50</span>
        </div>
      )}
      {partial && status === 'ready' && <div className="chart-partial">ⓘ {partial}</div>}
      {status === 'loading' && <div className="chart-overlay"><Spinner label="Loading chart…" /></div>}
      {status === 'error' && <div className="chart-overlay"><Empty>{errorMsg}</Empty></div>}
    </div>
  );
}
