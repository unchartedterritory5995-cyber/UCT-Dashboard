// app/src/components/chart/SymbolSearch.jsx — Clickable symbol badge + centered symbol-search modal
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import CompanyLogo from '../CompanyLogo'
import uctMark from '../intro/assets/compass-mark.png'
import styles from './SymbolSearch.module.css'

// Default suggestions shown when the input is empty. Hardcoded names so the
// empty-state list always shows them even before the ticker_meta cache fills.
// Exported: the phone symbol sheet (pages/charts/mobile) shows the same list,
// so the two surfaces can never drift on what "popular" means.
export const POPULAR_RESULTS = [
  { ticker: 'SPY',   name: 'SPDR S&P 500 ETF Trust', type: 'etf' },
  { ticker: 'QQQ',   name: 'Invesco QQQ Trust', type: 'etf' },
  { ticker: 'AAPL',  name: 'Apple Inc.', type: 'stock' },
  { ticker: 'MSFT',  name: 'Microsoft Corp.', type: 'stock' },
  { ticker: 'NVDA',  name: 'NVIDIA Corp.', type: 'stock' },
  { ticker: 'AMZN',  name: 'Amazon.com Inc.', type: 'stock' },
  { ticker: 'GOOGL', name: 'Alphabet Inc. Class A', type: 'stock' },
  { ticker: 'META',  name: 'Meta Platforms Inc.', type: 'stock' },
  { ticker: 'TSLA',  name: 'Tesla Inc.', type: 'stock' },
  { ticker: 'AMD',   name: 'Advanced Micro Devices', type: 'stock' },
  { ticker: 'AVGO',  name: 'Broadcom Inc.', type: 'stock' },
  { ticker: 'NFLX',  name: 'Netflix Inc.', type: 'stock' },
  { ticker: 'CRM',   name: 'Salesforce Inc.', type: 'stock' },
  { ticker: 'COST',  name: 'Costco Wholesale Corp.', type: 'stock' },
  { ticker: 'LLY',   name: 'Eli Lilly & Co.', type: 'stock' },
  { ticker: 'PLTR',  name: 'Palantir Technologies', type: 'stock' },
  { ticker: 'SMCI',  name: 'Super Micro Computer', type: 'stock' },
  { ticker: 'MSTR',  name: 'MicroStrategy Inc.', type: 'stock' },
  { ticker: 'COIN',  name: 'Coinbase Global', type: 'stock' },
  { ticker: 'SNOW',  name: 'Snowflake Inc.', type: 'stock' },
  { ticker: 'IWM',   name: 'iShares Russell 2000 ETF', type: 'etf' },
  { ticker: 'DIA',   name: 'SPDR Dow Jones Industrial', type: 'etf' },
  { ticker: 'XLF',   name: 'Financial Select Sector SPDR', type: 'etf' },
  { ticker: 'XLE',   name: 'Energy Select Sector SPDR', type: 'etf' },
  { ticker: 'XLK',   name: 'Technology Select Sector SPDR', type: 'etf' },
  { ticker: 'XLV',   name: 'Health Care Select Sector SPDR', type: 'etf' },
  { ticker: 'GLD',   name: 'SPDR Gold Trust', type: 'etf' },
  { ticker: 'TLT',   name: 'iShares 20+ Year Treasury', type: 'etf' },
  { ticker: 'ARKK',  name: 'ARK Innovation ETF', type: 'etf' },
  { ticker: 'SOXX',  name: 'iShares Semiconductor ETF', type: 'etf' },
]

// Category chips → the `type` query param the backend filters on. 'all' = no filter.
const CHIPS = [
  { key: 'all', label: 'All', type: '' },
  { key: 'stock', label: 'Stocks', type: 'stock' },
  { key: 'etf', label: 'ETFs', type: 'etf' },
  { key: 'index', label: 'Indices', type: 'index' },
  { key: 'breadth', label: 'Breadth', type: 'breadth' },
]

// The exact indices our charts render (api/index_bars.py INDEX_MAP). This IS the
// full "Indices" universe, so the chip is served client-side from this list — both
// the empty-state preload and searches filter it (no backend round-trip needed).
const INDICES_PRESET = [
  { ticker: 'SPX', name: 'S&P 500 Index', type: 'index' },
  { ticker: 'NDX', name: 'Nasdaq 100 Index', type: 'index' },
  { ticker: 'DJX', name: 'Dow Jones Industrial Average', type: 'index' },
  { ticker: 'RUT', name: 'Russell 2000 Index', type: 'index' },
  { ticker: 'VIX', name: 'CBOE Volatility Index', type: 'index' },
  { ticker: 'XSP', name: 'Mini S&P 500 Index', type: 'index' },
  { ticker: 'XND', name: 'Micro Nasdaq 100 Index', type: 'index' },
]

// q matches a preset/breadth row by ticker OR name (case-insensitive substring).
const matchQ = (r, q) => {
  if (!q) return true
  const qu = q.toUpperCase()
  return String(r.ticker || '').includes(qu) || String(r.name || '').toUpperCase().includes(qu)
}

const TYPE_LABEL = { stock: 'stock', etf: 'ETF', index: 'index', breadth: 'breadth', delisted: 'delisted' }

// Render `text` with every case-insensitive occurrence of the typed query wrapped in
// a gold `.hit` span (TradingView highlights the matched term; ours is gold).
function highlighted(text, query, styles) {
  if (!text) return null
  const q = (query || '').trim()
  if (!q) return text
  const tl = text.toLowerCase()
  const ql = q.toLowerCase()
  if (!tl.includes(ql)) return text
  const parts = []
  let idx = 0, pos = tl.indexOf(ql, idx), k = 0
  while (pos !== -1) {
    if (pos > idx) parts.push(text.slice(idx, pos))
    parts.push(<span key={k++} className={styles.hit}>{text.slice(pos, pos + q.length)}</span>)
    idx = pos + q.length
    pos = tl.indexOf(ql, idx)
  }
  if (idx < text.length) parts.push(text.slice(idx))
  return parts
}

const SymbolSearch = forwardRef(function SymbolSearch({ sym, onSymbolChange, hideIcon = false, logoSym = null, brandLogo = false, displayLabel = null, fullLabel = false, labelColor = null, boundsRef = null, themeVars = null }, ref) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(POPULAR_RESULTS)
  const [activeIdx, setActiveIdx] = useState(0)
  const [chip, setChip] = useState('all')
  const [breadthAll, setBreadthAll] = useState([])
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const listRef = useRef(null)
  const abortRef = useRef(null)
  const dialogRef = useRef(null)

  // Imperative open-with-text — used by ChartPane so typing a letter on the
  // chart opens the search with that letter already entered.
  const openRef = useRef(false)
  openRef.current = open
  useImperativeHandle(ref, () => ({
    openWith: (text = '') => {
      // Append when already open so fast chart type-to-search keystrokes during the
      // async focus gap don't reset the query; fresh start when the box was closed.
      const wasOpen = openRef.current
      openRef.current = true
      setOpen(true)
      if (!wasOpen) setChip('all')
      setQuery(q => (wasOpen ? q + (text || '') : (text || '')).toUpperCase())
    },
  }), [])

  // Focus the input once the modal is mounted.
  useEffect(() => {
    if (open && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus()
      const len = inputRef.current.value.length
      try { inputRef.current.setSelectionRange(len, len) } catch { /* */ }
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined
    const handler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open])

  // Return focus to the chart when the modal CLOSES so type-to-search works again.
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

  // Fetch the full UCT breadth catalog once (on first open) so the Breadth chip has a
  // real list to preload + filter (works on any backend — independent of search).
  useEffect(() => {
    if (!open || breadthAll.length) return undefined
    let alive = true
    fetch('/api/breadth-symbols')
      .then(r => (r.ok ? r.json() : { symbols: [] }))
      .then(d => {
        if (!alive) return
        const rows = (d.symbols || []).map(s => ({
          ticker: String(s.symbol || '').toUpperCase(),
          name: s.name || s.label || '',
          type: 'breadth', breadth: true, group_label: s.group,
        })).filter(r => r.ticker)
        setBreadthAll(rows)
      })
      .catch(() => { /* leave empty */ })
    return () => { alive = false }
  }, [open, breadthAll.length])

  // Results. Indices + Breadth are OUR OWN closed universes → served entirely
  // client-side (empty-state preload + search both filter the curated/fetched list),
  // so their filter is exact regardless of the backend. Stocks/ETFs/All go to the
  // server; the chip type-filters the response (once the server labels a type).
  useEffect(() => {
    if (!open) return undefined
    const q = query.trim()
    const typeParam = CHIPS.find(c => c.key === chip)?.type || ''

    if (chip === 'index') {
      setResults(INDICES_PRESET.filter(r => matchQ(r, q)))
      setActiveIdx(0)
      return undefined
    }
    if (chip === 'breadth') {
      setResults(breadthAll.filter(r => matchQ(r, q)))
      setActiveIdx(0)
      return undefined
    }
    if (!q) {
      setResults(typeParam ? POPULAR_RESULTS.filter(r => r.type === typeParam) : POPULAR_RESULTS)
      setActiveIdx(0)
      return undefined
    }
    // Instant lock so "Go to {typed}" + Enter always work with no network wait.
    setResults([{ ticker: q.toUpperCase(), name: null, _typed: true }])
    setActiveIdx(0)
    if (abortRef.current) abortRef.current.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    const url = `/api/ticker-search?q=${encodeURIComponent(q)}&limit=40${typeParam ? `&type=${typeParam}` : ''}`
    const t = setTimeout(() => {
      fetch(url, { signal: ctl.signal })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(j => {
          let arr = Array.isArray(j?.results) ? j.results : []
          // Client-side safety net: if a category is active AND the server labeled
          // types, keep only that type (so a stale/typeless server can't leak the
          // wrong category through). Typeless responses (old server) pass through.
          if (typeParam && arr.some(r => r.type)) arr = arr.filter(r => r.type === typeParam)
          const hasExact = arr.some(r => r.ticker === q.toUpperCase())
          const merged = (hasExact || typeParam) ? arr : [...arr, { ticker: q.toUpperCase(), name: null, _typed: true }]
          setResults(merged)
          setActiveIdx(0)
        })
        .catch(() => {
          setResults(typeParam ? [] : [{ ticker: q.toUpperCase(), name: null, _typed: true }])
          setActiveIdx(0)
        })
    }, 150)
    return () => { clearTimeout(t); ctl.abort() }
  }, [query, open, chip, breadthAll])

  // Auto-scroll active item into view during keyboard navigation
  useEffect(() => {
    const el = listRef.current?.children?.[activeIdx]
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const submit = useCallback((ticker) => {
    const clean = (ticker || '').trim().toUpperCase()
    if (clean && clean !== sym) onSymbolChange(clean)
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
      const typed = query.trim()
      if (activeIdx > 0 && results[activeIdx]?.ticker) submit(results[activeIdx].ticker)
      else if (typed) submit(typed)
      else if (results[activeIdx]?.ticker) submit(results[activeIdx].ticker)
    } else if (e.key === 'Tab') {
      // Tab / Shift+Tab cycles the category chips (TradingView-ish quick filter).
      e.preventDefault()
      const i = CHIPS.findIndex(c => c.key === chip)
      const n = (i + (e.shiftKey ? -1 : 1) + CHIPS.length) % CHIPS.length
      setChip(CHIPS[n].key)
    }
  }, [results, activeIdx, submit, query, chip])

  if (!onSymbolChange) {
    // Read-only mode — just show symbol, not clickable
    return <div className={styles.badge}>{sym}</div>
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        className={styles.badge}
        style={hideIcon ? { justifyContent: fullLabel ? 'flex-start' : 'center', width: fullLabel ? 'auto' : '100%' } : undefined}
        onClick={() => { if (open) { setOpen(false) } else { setQuery(''); setChip('all'); setOpen(true) } }}
        title={displayLabel ? `${sym} — click to search` : 'Search ticker'}
        aria-label={sym ? `${sym} — click to search a different ticker` : 'Search ticker'}
      >
        {displayLabel ? (
          <span
            className={styles.labelWrap}
            style={{ ...(fullLabel ? { maxWidth: 'none' } : null), ...(labelColor ? { color: labelColor } : null) }}
          >
            {logoSym ? (
              <span className={styles.labelLogo}><CompanyLogo sym={logoSym} name={displayLabel} size={16} round /></span>
            ) : brandLogo ? (
              <span className={styles.labelLogo}>
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

      {open && createPortal(
        <div
          className={styles.backdrop}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            ref={dialogRef}
            className={styles.dialog}
            style={themeVars || undefined}
            role="dialog"
            aria-label="Symbol search"
          >
            <div className={styles.dialogHead}>
              <span className={styles.dialogTitle}>Symbol Search</span>
              <button type="button" className={styles.dialogClose} onClick={() => setOpen(false)} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
                </svg>
              </button>
            </div>

            <div className={styles.searchRow}>
              <svg className={styles.searchIcon} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
              <input
                ref={inputRef}
                className={styles.searchInput}
                value={query}
                onChange={e => setQuery(e.target.value.toUpperCase())}
                onKeyDown={handleInputKey}
                placeholder="Search symbol or company…"
                spellCheck={false}
                maxLength={48}
              />
              {query && (
                <button type="button" className={styles.searchClear} onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
                  </svg>
                </button>
              )}
            </div>

            <div className={styles.chipRow}>
              {CHIPS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  className={`${styles.chip} ${chip === c.key ? styles.chipActive : ''}`}
                  onClick={() => { setChip(c.key); inputRef.current?.focus() }}
                >{c.label}</button>
              ))}
            </div>

            <div ref={listRef} className={styles.resultList}>
              {results.map((r, i) => (
                <button
                  key={`${r.ticker}-${i}`}
                  className={[
                    styles.resultRow,
                    r.ticker === sym ? styles.resultCurrent : '',
                    i === activeIdx ? styles.resultActive : '',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => submit(r.ticker)}
                >
                  {r._typed ? (
                    <span className={styles.resultTyped}>Go to <strong>{r.ticker}</strong></span>
                  ) : (
                    <>
                      <span className={styles.resultLogo}>
                        {r.breadth
                          ? <img src={uctMark} alt="" width={20} height={20} style={{ display: 'block', objectFit: 'contain' }} />
                          : <CompanyLogo sym={r.ticker} name={r.name || r.ticker} size={26} round />}
                      </span>
                      <span className={styles.resultMain}>
                        <span className={styles.resultSym}>{highlighted(r.ticker, query, styles)}</span>
                        {r.name && <span className={styles.resultName}>{highlighted(r.name, query, styles)}</span>}
                      </span>
                      <span className={styles.resultRight}>
                        {r.exchange && !r.breadth && !r.delisted && <span className={styles.resultExch}>{r.exchange}</span>}
                        {r.delisted ? (
                          <span className={`${styles.typeBadge} ${styles.badgeDelisted}`}>
                            Delisted{r.delisted_date ? ` ${String(r.delisted_date).slice(0, 4)}` : ''}
                          </span>
                        ) : r.breadth ? (
                          <span className={`${styles.typeBadge} ${styles.badgeBreadth}`} title={r.group_label ? `UCT Breadth · ${r.group_label}` : 'UCT Breadth indicator'}>BREADTH</span>
                        ) : r.type ? (
                          <span className={`${styles.typeBadge} ${styles['badge_' + r.type] || ''}`}>{TYPE_LABEL[r.type] || r.type}</span>
                        ) : null}
                      </span>
                    </>
                  )}
                </button>
              ))}
              {results.length === 0 && (
                <div className={styles.resultEmpty}>
                  {query.trim() && chip === 'all'
                    ? <button className={styles.resultRow} onClick={() => submit(query)}><span className={styles.resultTyped}>Go to <strong>{query.trim().toUpperCase()}</strong></span></button>
                    : 'No matches found'}
                </div>
              )}
            </div>

            <div className={styles.dialogFoot}>
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>↵</kbd> select</span>
              <span><kbd>Tab</kbd> category</span>
              <span><kbd>esc</kbd> close</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
})

export default SymbolSearch
