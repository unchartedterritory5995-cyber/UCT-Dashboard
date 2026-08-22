// app/src/components/chart/SymbolSearch.jsx — Clickable symbol badge + predictive search overlay
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import CompanyLogo from '../CompanyLogo'
import uctMark from '../intro/assets/compass-mark.png'
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

const SymbolSearch = forwardRef(function SymbolSearch({ sym, onSymbolChange, hideIcon = false, logoSym = null, brandLogo = false, displayLabel = null, fullLabel = false, labelColor = null, boundsRef = null, themeVars = null }, ref) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(POPULAR_RESULTS)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const listRef = useRef(null)
  const abortRef = useRef(null)
  const dropdownRef = useRef(null)
  // Fixed-position coords for the portaled dropdown (see the positioning effect).
  const [menuPos, setMenuPos] = useState(null)

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

  // Position the dropdown as a fixed-position PORTAL (rendered to document.body).
  // The chart-widget header is `overflow:hidden` and only ~28px tall, and the grid
  // item's transform makes even position:fixed get clipped — so an in-tree dropdown
  // has its top/bottom cut off. A portal escapes every ancestor. Recompute on
  // scroll/resize so it tracks the badge while open.
  useEffect(() => {
    if (!open) { setMenuPos(null); return }
    const place = () => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const W = Math.min(280, window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
      setMenuPos({ left, top: r.bottom + 4, width: W })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Focus the input once it's mounted (after the position is known). The
  // activeElement guard keeps a scroll-triggered reposition from stealing the caret.
  useEffect(() => {
    if (open && menuPos && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus()
      const len = inputRef.current.value.length
      try { inputRef.current.setSelectionRange(len, len) } catch {}
    }
  }, [open, menuPos])

  // Close on outside click (the portaled dropdown lives outside wrapRef, so check both)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target)
      const inMenu = dropdownRef.current && dropdownRef.current.contains(e.target)
      if (!inWrap && !inMenu) setOpen(false)
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

  // Return focus to the chart when the dropdown CLOSES so type-to-search works
  // again immediately. Type-to-search fires from the chart's onKeyDown, which
  // needs the chart element focused; closing by clicking outside left focus on
  // <body>, so the next keystroke never reached the chart handler and the search
  // wouldn't reopen. Only refocus if nothing else claimed focus (checked after the
  // click's focus settles) — so clicking straight into another input isn't
  // hijacked. Charts only (boundsRef, the chart element, is passed there).
  const wasOpenRef = useRef(false)
  useEffect(() => {
    const justClosed = wasOpenRef.current && !open
    wasOpenRef.current = open
    if (!justClosed) return undefined
    const host = boundsRef?.current
    if (!host) return undefined
    const id = requestAnimationFrame(() => {
      const ae = document.activeElement
      if (!ae || ae === document.body) {
        try { host.focus({ preventScroll: true }) } catch { /* not focusable */ }
      }
    })
    return () => cancelAnimationFrame(id)
  }, [open, boundsRef])

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
        style={hideIcon ? { justifyContent: fullLabel ? 'flex-start' : 'center', width: fullLabel ? 'auto' : '100%' } : undefined}
        onClick={() => { if (open) { setOpen(false) } else { setQuery(''); setOpen(true) } }}
        title={displayLabel ? `${sym} — click to search` : 'Search ticker'}
        aria-label={sym ? `${sym} — click to search a different ticker` : 'Search ticker'}
      >
        {displayLabel ? (
          // fullLabel: lift the 240px cap so the whole name has real layout width
          // (otherwise it overflows the capped box and paints over the day gain).
          <span
            className={styles.labelWrap}
            style={{ ...(fullLabel ? { maxWidth: 'none' } : null), ...(labelColor ? { color: labelColor } : null) }}
          >
            {logoSym ? (
              <span className={styles.labelLogo}><CompanyLogo sym={logoSym} name={displayLabel} size={16} round /></span>
            ) : brandLogo ? (
              // Thematic indexes have no company ticker → no logo.dev logo. Fall back to
              // the Uncharted Territory compass mark (the app's brand symbol) instead.
              <span className={styles.labelLogo}>
                {/* Rendered a touch larger than a company logo (20 vs 16): the mark
                    has transparent padding + pointed arms and isn't clipped to a
                    filled circle, so it reads smaller at the same box size. */}
                <img src={uctMark} alt="Uncharted Territory" width={20} height={20} style={{ display: 'block', objectFit: 'contain' }} />
              </span>
            ) : null}
            <span className={styles.labelText} style={fullLabel ? { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'nowrap' } : undefined}>{displayLabel}</span>
          </span>
        ) : sym}
        {!hideIcon && (
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="5" cy="5" r="3.5" />
            <line x1="7.5" y1="7.5" x2="10.5" y2="10.5" />
          </svg>
        )}
      </button>

      {open && menuPos && createPortal(
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          style={{ position: 'fixed', left: menuPos.left, top: menuPos.top, width: menuPos.width, zIndex: 3000, ...(themeVars || {}) }}
        >
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
                    {r.delisted && (
                      <span
                        style={{
                          marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: '#c9a84c',
                          border: '1px solid rgba(201,168,76,0.4)', borderRadius: 3,
                          padding: '0 5px', whiteSpace: 'nowrap',
                        }}
                      >
                        Delisted{r.delisted_date ? ` ${String(r.delisted_date).slice(0, 4)}` : ''}
                      </span>
                    )}
                    {r.breadth && (
                      <span
                        style={{
                          marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: '#8ab4f8',
                          border: '1px solid rgba(138,180,248,0.4)', borderRadius: 3,
                          padding: '0 5px', whiteSpace: 'nowrap',
                        }}
                        title={r.group_label ? `UCT Breadth · ${r.group_label}` : 'UCT Breadth indicator'}
                      >
                        BREADTH
                      </span>
                    )}
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
        </div>,
        document.body,
      )}
    </div>
  )
})

export default SymbolSearch
