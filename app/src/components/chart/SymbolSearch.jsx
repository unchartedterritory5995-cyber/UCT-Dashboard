// app/src/components/chart/SymbolSearch.jsx — Clickable symbol badge + search input overlay
import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './SymbolSearch.module.css'

// Common tickers for quick access
const POPULAR = [
  'SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD',
  'AVGO', 'NFLX', 'CRM', 'COST', 'LLY', 'PLTR', 'SMCI', 'MSTR', 'COIN', 'SNOW',
  'IWM', 'DIA', 'XLF', 'XLE', 'XLK', 'XLV', 'GLD', 'TLT', 'ARKK', 'SOXX',
]

export default function SymbolSearch({ sym, onSymbolChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
      setQuery('')
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const submit = useCallback((ticker) => {
    const clean = ticker.trim().toUpperCase()
    if (clean && clean !== sym) {
      onSymbolChange(clean)
    }
    setOpen(false)
    setQuery('')
  }, [sym, onSymbolChange])

  const filtered = query.trim()
    ? POPULAR.filter(t => t.startsWith(query.trim().toUpperCase()))
    : POPULAR

  if (!onSymbolChange) {
    // Read-only mode — just show symbol, not clickable
    return <div className={styles.badge}>{sym}</div>
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button className={styles.badge} onClick={() => setOpen(!open)} title="Search ticker">
        {sym}
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="5" cy="5" r="3.5" />
          <line x1="7.5" y1="7.5" x2="10.5" y2="10.5" />
        </svg>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              className={styles.input}
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && query.trim()) submit(query)
              }}
              placeholder="Type ticker..."
              spellCheck={false}
              maxLength={10}
            />
          </div>
          <div className={styles.list}>
            {filtered.slice(0, 20).map(t => (
              <button
                key={t}
                className={`${styles.item} ${t === sym ? styles.itemActive : ''}`}
                onClick={() => submit(t)}
              >
                {t}
              </button>
            ))}
            {query.trim() && !filtered.length && (
              <button className={styles.item} onClick={() => submit(query)}>
                Go to <strong>{query.trim().toUpperCase()}</strong>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
