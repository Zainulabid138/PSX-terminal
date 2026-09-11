import React, { useMemo, useState } from 'react';
import { useMarket, ALERT_TYPES } from '../store/MarketContext.jsx';
import { Empty } from './common.jsx';
import { fmtPrice, fmtPct, fmtVolume } from '../utils/format.js';

/**
 * Alerts — create and manage price / change% / volume-spike alerts.
 * Evaluated live in MarketContext on every market refresh; when a condition is
 * met it fires a desktop notification + sound and is marked Triggered here.
 */
export default function Alerts({ onSelect }) {
  const { alerts, addAlert, removeAlert, rearmAlert, equityRows, settings, updateSettings } = useMarket();
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState('price_above');
  const [value, setValue] = useState('');

  const symbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);
  const valid = symbol && symbols.includes(symbol.toUpperCase()) && value !== '' && !Number.isNaN(Number(value));

  const submit = () => {
    if (!valid) return;
    addAlert({ symbol: symbol.toUpperCase(), type, value: Number(value) });
    setValue('');
  };

  const unitFor = (t) => (ALERT_TYPES.find((x) => x.id === t) || {}).unit || '';

  return (
    <div className="alerts">
      <div className="card alert-form">
        <div className="card__head"><span>Create Alert</span></div>
        <div className="alert-form__row">
          <input list="alert-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol (e.g. HUBC)" />
          <datalist id="alert-symbols">{symbols.slice(0, 600).map((s) => <option key={s} value={s} />)}</datalist>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {ALERT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Value (${unitFor(type)})`} />
          <button className="btn-primary" disabled={!valid} onClick={submit}>Add Alert</button>
        </div>
        <label className="alert-toggle">
          <input type="checkbox" checked={!!settings.soundAlerts} onChange={(e) => updateSettings({ soundAlerts: e.target.checked })} /> Sound
        </label>
        <label className="alert-toggle">
          <input type="checkbox" checked={!!settings.desktopNotifications} onChange={(e) => updateSettings({ desktopNotifications: e.target.checked })} /> Desktop notification
        </label>
      </div>

      {!alerts.length && <Empty>No alerts yet. Create one above, or add one from any stock's detail page.</Empty>}

      {alerts.length > 0 && (
        <div className="card">
          <div className="card__head"><span>Active & Triggered Alerts ({alerts.length})</span></div>
          <div className="alert-list">
            {alerts.map((a) => {
              const label = (ALERT_TYPES.find((t) => t.id === a.type) || {}).label || a.type;
              const row = equityRows.find((r) => r.symbol === a.symbol);
              return (
                <div key={a.id} className={`alert-row ${a.triggeredAt ? 'alert-row--fired' : ''}`}>
                  <span className="bold link" onClick={() => onSelect(a.symbol)}>{a.symbol}</span>
                  <span>{label} <b>{a.type.startsWith('vol') ? fmtVolume(a.value) : a.type.startsWith('pct') ? fmtPct(a.value, false) : fmtPrice(a.value)}</b></span>
                  <span className="muted">now: {row ? (a.type.startsWith('vol') ? fmtVolume(row.volume) : a.type.startsWith('pct') ? fmtPct(row.changePct) : fmtPrice(row.current)) : '—'}</span>
                  <span className={a.triggeredAt ? 'pos' : 'muted'}>{a.triggeredAt ? '🔔 Triggered' : 'Watching…'}</span>
                  <span className="alert-actions">
                    {a.triggeredAt && <button className="link-btn" onClick={() => rearmAlert(a.id)}>Re-arm</button>}
                    <button className="link-btn" onClick={() => removeAlert(a.id)}>Delete</button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
