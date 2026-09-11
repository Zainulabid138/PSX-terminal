import React from 'react';
import { changeClass, fmtPct } from '../utils/format.js';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner">
      <div className="spinner__ring" />
      <span>{label}</span>
    </div>
  );
}

export function StatCard({ label, value, sub, tone = 'default' }) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {sub != null && <div className="stat-card__sub">{sub}</div>}
    </div>
  );
}

export function ChangeBadge({ value }) {
  return <span className={`chg chg--${changeClass(value)}`}>{fmtPct(value)}</span>;
}

const TONE_COLOR = {
  buy: 'var(--pos)',
  sell: 'var(--neg)',
  neutral: 'var(--muted)',
};

export function RecoBadge({ recommendation }) {
  if (!recommendation) return null;
  const color = TONE_COLOR[recommendation.tone] || 'var(--muted)';
  return (
    <span className="reco-badge" style={{ borderColor: color, color }}>
      {recommendation.action}
    </span>
  );
}

/** Probability bar: green portion = upward probability, red = downward. */
export function ProbBar({ up }) {
  if (up == null) return <div className="probbar probbar--empty">Insufficient data</div>;
  return (
    <div className="probbar" title={`Up ${up}% / Down ${100 - up}%`}>
      <div className="probbar__up" style={{ width: `${up}%` }} />
      <div className="probbar__label">{up}% ↑ / {100 - up}% ↓</div>
    </div>
  );
}

export function ConfidencePill({ level }) {
  const cls = level === 'High' ? 'pos' : level === 'Medium' ? 'warn' : 'neg';
  return <span className={`pill pill--${cls}`}>{level} confidence</span>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
