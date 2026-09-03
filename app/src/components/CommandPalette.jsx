import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import CompanyLogo from './CompanyLogo'
import UIcon from './ui/UIcon'
import styles from './CommandPalette.module.css'

const TICKER_LIKE = /^[A-Z0-9.\-]{1,10}$/

/**
 * Global Ctrl/Cmd+K command palette — S2's first slice (security/company
 * discovery + navigation only; see the 2026-09-03 narrow-slice authorization).
 * Mounted once in Layout.jsx so it works from anywhere in the authed shell.
 *
 * Settings.jsx already owns a PAGE-SCOPED ⌘K ("jump to any setting") via a
 * bubble-phase window listener. This one listens on the CAPTURE phase and
 * stops propagation on match, so it wins the shortcut everywhere including
 * /settings — mirroring SymbolSearch.jsx's own capture-phase Escape handling,
 * the codebase's existing pattern for exactly this kind of precedence.
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const inputRef = useRef(null)
  const openerRef = useRef(null)
  const openRef = useRef(false)
  const abortRef = useRef(null)
  const debounceRef = useRef(null)
  const reqIdRef = useRef(0)
  const navByArrowRef = useRef(false)

  useEffect(() => { openRef.current = open }, [open])

  const close = () => setOpen(false)

  // ── Global hotkey — registered ONCE for the component's lifetime. ──────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        if (openRef.current) {
          close()
        } else {
          openerRef.current = document.activeElement
          setOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // ── Focus the input the moment the dialog opens; reset state on close. ──
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      setQuery('')
      setResults([])
      setActiveIdx(0)
      setError(false)
      if (abortRef.current) abortRef.current.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const opener = openerRef.current
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus()
      }
    }
  }, [open])

  // ── Escape-closes + Tab-trap, capture phase (mirrors SymbolSearch.jsx). ──
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') {
        // Single-field palette — keep focus pinned to the input rather than
        // leaking Tab through to the page underneath.
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  // ── Debounced search against the existing /api/ticker-search — no new
  //    backend, no chip filter (defaults to all types). ──────────────────
  useEffect(() => {
    if (!open) return undefined
    navByArrowRef.current = false
    setActiveIdx(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      setResults([])
      setLoading(false)
      setError(false)
      return undefined
    }
    const myReqId = ++reqIdRef.current
    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setLoading(true)
      setError(false)
      fetch(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`, { signal: ac.signal })
        .then(r => r.json())
        .then(data => {
          if (reqIdRef.current !== myReqId) return
          setResults(Array.isArray(data?.results) ? data.results : [])
          setLoading(false)
        })
        .catch(err => {
          if (err?.name === 'AbortError') return
          if (reqIdRef.current !== myReqId) return
          setError(true)
          setLoading(false)
        })
    }, 150)
    return () => clearTimeout(debounceRef.current)
  }, [query, open])

  const qUpper = query.trim().toUpperCase()
  const displayRows = useMemo(() => {
    if (!qUpper) return []
    const hasExact = results.some(r => String(r.ticker).toUpperCase() === qUpper)
    if (hasExact || !TICKER_LIKE.test(qUpper)) return results
    return [...results, { ticker: qUpper, name: null, _typed: true }]
  }, [results, qUpper])

  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, displayRows.length - 1)))
  }, [displayRows.length])

  const selectRow = (row) => {
    if (!row) return
    navigate(`/research/${encodeURIComponent(row.ticker)}`)
    close()
  }

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      navByArrowRef.current = true
      setActiveIdx(i => Math.min(displayRows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      navByArrowRef.current = true
      setActiveIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Zero-network-wait guarantee: unless the user explicitly arrowed to a
      // different row, Enter always goes to the typed value directly.
      if (navByArrowRef.current && displayRows[activeIdx]) {
        selectRow(displayRows[activeIdx])
      } else if (qUpper) {
        selectRow({ ticker: qUpper })
      }
    }
  }

  if (!open) return null

  const listboxId = 'uct-cmdk-listbox'
  const activeRowId = displayRows[activeIdx] ? `uct-cmdk-row-${activeIdx}` : undefined

  return createPortal(
    <div className={styles.backdrop} onClick={close}>
      <div
        className={styles.dialog}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}><UIcon name="search" size={15} /></span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search a security or company…"
            aria-label="Search a security or company"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={displayRows.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeRowId}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className={styles.searchSpinner} aria-hidden="true" />}
          <kbd className={styles.hintKey}>Esc</kbd>
        </div>

        <div className={styles.resultList} id={listboxId} role="listbox" aria-label="Search results">
          {!qUpper && (
            <div className={styles.resultEmpty}>Type a ticker or company name to jump to its research page.</div>
          )}
          {qUpper && displayRows.length === 0 && !loading && (
            <div className={styles.resultEmpty}>No matches for &quot;{query.trim()}&quot;.</div>
          )}
          {displayRows.map((r, i) => (
            <button
              key={`${r.ticker}-${i}`}
              id={`uct-cmdk-row-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`${styles.resultRow} ${i === activeIdx ? styles.resultActive : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => selectRow(r)}
            >
              {r._typed ? (
                <span className={styles.resultTyped}>Go to <strong>{r.ticker}</strong></span>
              ) : (
                <>
                  <span className={styles.resultLogo}>
                    <CompanyLogo sym={r.ticker} name={r.name || r.ticker} size={22} round />
                  </span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultSym}>{r.ticker}</span>
                    {r.name && <span className={styles.resultName}>{r.name}</span>}
                  </span>
                  {r.exchange && <span className={styles.resultExch}>{r.exchange}</span>}
                </>
              )}
            </button>
          ))}
          {error && <div className={styles.resultError}>Search is briefly unavailable — Enter still opens the typed symbol.</div>}
        </div>

        <div className={styles.dialogFoot}>
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
