import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useMarket } from '../store/MarketContext.jsx';
import { answer } from '../lib/assistant.js';

const SUGGESTIONS = [
  'Best shares to buy today',
  'Should I buy HUBC?',
  'Where to buy OGDC',
  'MARI ka kya haal hai',
  'Find breakout stocks',
  'Show oversold stocks',
  'Explain Stage analysis',
];

/**
 * AskAssistant
 * ------------
 * Local, transparent chat. It routes questions to the rule-based assistant,
 * which answers strictly from real analysis. No external LLM, no fabricated data.
 */
export default function AskAssistant({ onSelect }) {
  const { equityRows, getAnalysis } = useMarket();
  const [messages, setMessages] = useState([
    { role: 'bot', kind: 'text', text: 'Ask me about any PSX stock or the market. I analyze real data only and explain my reasoning. Try the suggestions below.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const lastSymbolRef = useRef(null); // remembers the last discussed stock for follow-ups

  const knownSymbols = useMemo(() => equityRows.map((r) => r.symbol), [equityRows]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: 'user', kind: 'text', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const res = await answer(q, {
        rows: equityRows,
        knownSymbols,
        getAnalysis,
        lastSymbol: lastSymbolRef.current,
      });
      if (res.symbol) lastSymbolRef.current = res.symbol; // remember for follow-ups
      setMessages((m) => [...m, { role: 'bot', ...res }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'bot', kind: 'text', text: 'Something went wrong handling that question. Data may be unavailable from the source.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistant">
      <div className="assistant__log">
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            {m.kind === 'list' ? (
              <div>
                <div className="msg__text">{m.text}</div>
                <div className="msg__list">
                  {m.list.length ? m.list.map((it) => (
                    <button key={it.symbol} className="chip" onClick={() => onSelect(it.symbol)}>
                      <b>{it.symbol}</b> <span>{it.detail}</span>
                    </button>
                  )) : <span className="muted">No matches.</span>}
                </div>
              </div>
            ) : (
              <div className="msg__text">
                {m.text}
                {m.kind === 'analysis' && (
                  <button className="link-btn" onClick={() => onSelect(m.symbol)}>Open {m.symbol} →</button>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg msg--bot"><div className="msg__text typing">Analyzing real data…</div></div>}
        <div ref={endRef} />
      </div>

      <div className="assistant__suggest">
        {SUGGESTIONS.map((s) => <button key={s} className="suggest-chip" onClick={() => send(s)}>{s}</button>)}
      </div>

      <div className="assistant__input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder='Ask: "Analyze OGDC", "Find breakout stocks", "Explain RSI"…'
        />
        <button className="btn-primary" onClick={() => send()} disabled={busy}>Send</button>
      </div>
    </div>
  );
}
