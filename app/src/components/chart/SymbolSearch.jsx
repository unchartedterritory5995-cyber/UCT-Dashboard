// app/src/components/chart/SymbolSearch.jsx — Clickable symbol badge + predictive search overlay
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import styles from './SymbolSearch.module.css'

// Default suggestions shown when the input is empty. Hardcoded names so the
// empty-state list always shows them even before the ticker_meta cache fills.
const POPULAR_RESULTS = [
  { ticker: 'SPY',   name: 'SPDR S&P 500 ETF Trust' },
  { ticker: 'QQQ',   name: 'Invesco QQQ Trust' },
  { ticker: 'AAPL',  name: 'Apple Inc.' },
  { ticker: 'MSFT',  name: 'Microsoft Corp.' },
  { ticker: 'NVDA',  name: 'NVIDIA Corp.' },
  { ticker: 'AMZN',  name: 'Amazon.com Inc.' },
  { ticker: 'GOOGL', name: 'Alphabet Inc. Class A' },
  { ticker: 'META',  name: 'Meta Platforms Inc.' },
  { ticker: 'TSLA',  name: 'Tesla Inc.' },
  { ticker: 'AMD',   name: 'Advanced Micro Devices' },
  { ticker: 'AVGO',  name: 'Broadcom Inc.' },
  { ticker: 'NFLX',  name: 'Netflix Inc.' },
  { ticker: 'CRM',   name: 'Salesforce Inc.' },
  { ticker: 'COST',  name: 'Costco Wholesale Corp.' },
  { ticker: 'LLY',   name: 'Eli Lilly & Co.' },
  { ticker: 'PLTR',  name: 'Palantir Technologies' },
  { ticker: 'SMCI',  name: 'Super Micro Computer' },
  { ticker: 'MSTR',  name: 'MicroStrategy Inc.' },
  { ticker: 'COIN',  name: 'Coinbase Global' },
  { ticker: 'SNOW',  name: 'Snowflake Inc.' },
  { ticker: 'IWM',   name: 'iShares Russell 2000 ETF' },
  { ticker: 'DIA',   name: 'SPDR Dow Jones Industrial' },
  { ticker: 'XLF',   name: 'Financial Select Sector SPDR' },
  { ticker: 'XLE',   name: 'Energy Select Sector SPDR' },
  { ticker: 'XLK',   name: 'Technology Select Sector SPDR' },
  { ticker: 'XLV',   name: 'Health Care Select Sector SPDR' },
  { ticker: 'GLD',   name: 'SPDR Gold Trust' },
  { ticker: 'TLT',   name: 'iShares 20+ Year Treasury' },
  { ticker: 'ARKK',  name: 'ARK Innovation ETF' },
  { ticker: 'SOXX',  name: 'iShares Semiconductor ETF' },
]

const SymbolSearch = forwardRef(function SymbolSearch({ sym, onSymbolChange }, ref) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(POPULAR_RESULTS)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const listRef = useRef(null)
  const abortRef = useRef(null)

  // Imperative open-with-text — used by ChartWidget so typing a letter on the
  // chart opens the search with that letter already entered.
  // Up-to-date open flag for the imperative handler (avoids a stale closure).
  const openRef = useRef(false)
  openRef.current = open
  useImperativeHandle(ref, () => ({
    openWith: (text = '') => {
      // Append when already open so fast chart type-to-search keystrokes during the
      // async focus gap don't reset the query; fresh start when the box was closed.
      const wasOpen = openRef.current
      openRef.current = true
      setOpen(true)
      setQuery(q => (wasOpen ? q + (text || '') : (text || '')).toUpperCase())
    },
  }), [])

  // Focus input when opened.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
      const len = inputRef.current.value.length
      try { inputRef.current.setSelectionRange(len, len) } catch {}
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

  // Debounced server-side autocomplete (3,685-ticker $300M+ universe).
  // Empty query → POPULAR. Non-empty → /api/ticker-search.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults(POPULAR_RESULTS)
      setActiveIdx(0)
      return
    }
    // Instant lock: show the typed ticker as the selected item IMMEDIATELY (no
    // debounce/network wait) so "Go to {typed}" + Enter always reflect the current
    // text. The debounced fetch below enriches it with autocomplete matches.
    setResults([{ ticker: q.toUpperCase(), name: null, _typed: true }])
    setActiveIdx(0)
    if (abortRef.current) abortRef.current.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    const t = setTimeout(() => {
      fetch(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`, { signal: ctl.signal })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(j => {
          const arr = Array.isArray(j?.results) ? j.results : []
          // Ensure the literal "go to {q}" fallback is always present last when
          // no exact match exists — keeps the type-anything UX from the V1.
          const hasExact = arr.some(r => r.ticker === q.toUpperCase())
          const merged = hasExact ? arr : [...arr, { ticker: q.toUpperCase(), name: null, _typed: true }]
          setResults(merged)
          setActiveIdx(0)
        })
        .catch(() => {
          // Network or 4xx — show the literal typed value so submit still works.
          setResults([{ ticker: q.toUpperCase(), name: null, _typed: true }])
          setActiveIdx(0)
        })
    }, 150)
    return () => { clearTimeout(t); ctl.abort() }
  }, [query, open])

  // Auto-scroll active item into view during keyboard navigation
  useEffect(() => {
    const el = listRef.current?.children?.[activeIdx]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIdx])

  const submit = useCallback((ticker) => {
    const clean = ticker.trim().toUpperCase()
    if (clean && clean !== sym) {
      onSymbolChange(clean)
    }
    setOpen(false)
    setQuery('')
  }, [sym, onSymbolChange])

  const handleInputKey = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      // Instant: Enter goes straight to the typed ticker with no wait for the
      // debounced autocomplete. Only defer to a suggestion the user explicitly
      // arrow-navigated to (activeIdx > 0).
      const typed = query.trim()
      if (activeIdx > 0 && results[activeIdx]?.ticker) submit(results[activeIdx].ticker)
      else if (typed) submit(typed)
      else if (results[activeIdx]?.ticker) submit(results[activeIdx].ticker)
    }
  }, [results, activeIdx, submit, query])

  if (!onSymbolChange) {
    // Read-only mode — just show symbol, not clickable
    return <div className={styles.badge}>{sym}</div>
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        className={styles.badge}
        onClick={() => { if (open) { setOpen(false) } else { setQuery(''); setOpen(true) } }}
        title="Search ticker"
      >
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
              onKeyDown={handleInputKey}
              placeholder="Type ticker..."
              spellCheck={false}
              maxLength={10}
            />
          </div>
          <div ref={listRef} className={styles.list}>
            {results.map((r, i) => (
              <button
                key={`${r.ticker}-${i}`}
                className={[
                  styles.item,
                  r.ticker === sym ? styles.itemActive : '',
                  i === activeIdx ? styles.itemHighlighted : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => submit(r.ticker)}
              >
                {r._typed ? (
                  <>Go to <strong>{r.ticker}</strong></>
                ) : (
                  <>
                    <span className={styles.itemSym}>{r.ticker}</span>
                    {r.name && <span className={styles.itemName}>{r.name}</span>}
                  </>
                )}
              </button>
            ))}
            {results.length === 0 && query.trim() && (
              <button className={styles.item} onClick={() => submit(query)}>
                Go to <strong>{query.trim().toUpperCase()}</strong>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

export default SymbolSearch
