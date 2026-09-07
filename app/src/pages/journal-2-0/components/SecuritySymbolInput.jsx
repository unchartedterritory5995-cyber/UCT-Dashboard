// app/src/pages/journal-2-0/components/SecuritySymbolInput.jsx
//
// Seam 17 remainder (Journal Symbol Input Assist V1, 2026-09-06): a small,
// ALWAYS-VISIBLE symbol autocomplete for AddPositionModal.jsx / AddTradeModal
// .jsx's bare "Symbol *" text field. Owner-directed shape: type -> search
// assistance -> optional canonical selection -> free-form still possible.
//
// This is ASSISTIVE identity UX, not hard validation. Historical/manual
// trade logging must stay permissive: a delisted, renamed, or otherwise
// uncovered symbol is never blocked -- provider/search coverage is not
// authoritative proof a symbol is invalid (Identity Normalization V1's own
// deliberate choice not to make active-universe existence a write
// requirement). This component owns ONLY form-input behavior (controlled
// text input, debounce/search, suggestion list, keyboard nav, selection,
// dismissal, loading/no-results/failed state) -- never position/trade
// creation, financial validation, provider normalization, or accounting.
//
// Reuses the exact canonical `/api/ticker-search` contract SymbolSearch.jsx
// and CommandPalette.jsx already use -- no new search backend, no new
// identity authority, no frontend dot/hyphen logic (the backend/Entity
// Master is the only canonicalization authority; see Seam 1/Seam 16).
// SymbolSearch.jsx itself is a click-to-open MODAL/dialog, not a form
// field -- its shape doesn't fit here, but its debounce/AbortController/
// keyboard-nav conventions do, and are mirrored below.
import { useState, useRef, useEffect, useId } from 'react'
import CompanyLogo from '../../../components/CompanyLogo'
import styles from './SecuritySymbolInput.module.css'

const DEBOUNCE_MS = 200
const MAX_SUGGESTIONS = 8

// SEARCH FOUND MATCHES / SEARCH FOUND NO MATCH / SEARCH REQUEST FAILED are
// kept as three DISTINCT states (never collapsed) -- Section VIII's own
// requirement, since "nothing matched" and "the search itself broke" are
// different facts a member-facing disclosure should never conflate. None of
// the three ever blocks the input: a failed search silently degrades to the
// component's bare-input capability, matching SymbolSearch.jsx's own
// catch-branch degradation ("Go to {typed}" survives a network failure).
export default function SecuritySymbolInput({
  value,
  onChange,
  placeholder = 'e.g. NVDA',
  disabled = false,
  autoFocus = false,
  className,
  id,
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [searchState, setSearchState] = useState('idle') // idle | loading | found | empty | failed
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const abortRef = useRef(null)
  // Belt-and-suspenders alongside AbortController (mirrors CommandPalette.
  // jsx's own reqIdRef): a real fetch() honors the abort signal, but this
  // guard means correctness never depends on that -- a stale response can
  // never land even if something in the chain ignores the signal.
  const reqIdRef = useRef(0)
  const listboxId = useId()
  const reactId = useId()
  const inputId = id || reactId

  // Reset to idle the moment the field goes empty (cleared, or never typed
  // into) -- done here, during render (React's sanctioned "adjust state
  // during render" pattern, mirrors CompanyLogo.jsx's own prevSym reset),
  // not inside the debounce effect below: a setState call that runs
  // unconditionally on every effect firing is exactly what
  // react-hooks/set-state-in-effect flags, and showDropdown already can't
  // render while empty regardless -- this just keeps stale suggestions from
  // flashing if the field is cleared then retyped before the next debounce.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (!(value || '').trim()) {
      setSuggestions([])
      setSearchState('idle')
      setActiveIdx(-1)
    }
  }

  // Debounced search. AbortController gives the same stale-response
  // protection SymbolSearch.jsx relies on -- a fast second keystroke must
  // never let the FIRST request's late response overwrite the second's.
  useEffect(() => {
    const q = (value || '').trim()
    if (!q) return undefined
    setSearchState('loading')
    if (abortRef.current) abortRef.current.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    const myReqId = ++reqIdRef.current
    const t = setTimeout(() => {
      fetch(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=${MAX_SUGGESTIONS}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) => {
          if (reqIdRef.current !== myReqId) return
          const arr = Array.isArray(j?.results) ? j.results.slice(0, MAX_SUGGESTIONS) : []
          setSuggestions(arr)
          setSearchState(arr.length ? 'found' : 'empty')
          setActiveIdx(-1)
        })
        .catch((err) => {
          if (reqIdRef.current !== myReqId) return
          if (err?.name === 'AbortError') return
          // Best-effort: a broken search never blocks typing. No
          // suggestions, no disclosure -- the bare-input capability this
          // degrades to is exactly what shipped before this component
          // existed.
          setSuggestions([])
          setSearchState('failed')
          setActiveIdx(-1)
        })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(t); ctl.abort() }
  }, [value])

  // Dismiss on outside click (mirrors SymbolSearch.jsx's backdrop-click and
  // TickerActions.jsx's own convention for closing a floating panel).
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open])

  const selectSuggestion = (r) => {
    const canonical = (r?.ticker || '').trim().toUpperCase()
    if (canonical) onChange(canonical)
    setOpen(false)
    setActiveIdx(-1)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      if (!suggestions.length) return
      e.preventDefault()
      setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      if (!suggestions.length) return
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      // Only a keyboard-highlighted suggestion is honored -- typed text
      // with nothing arrowed-to just submits as-is (the free-form path),
      // mirroring SymbolSearch.jsx's own "typed beats an un-navigated
      // hover" rule so Enter never surprises a member who was just typing.
      if (open && activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault()
        selectSuggestion(suggestions[activeIdx])
      }
      // else: no preventDefault -- let Enter behave normally (this field
      // is not inside a <form>, so this is a no-op either way today).
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActiveIdx(-1)
      }
    }
  }

  // 'failed' deliberately excluded: a broken search must degrade to the
  // bare-input capability, not an empty floating panel below the field.
  const showDropdown = open && (value || '').trim() && searchState !== 'idle' && searchState !== 'failed'
  const activeOptionId = activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={!!showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showDropdown ? activeOptionId : undefined}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => { if ((value || '').trim()) setOpen(true) }}
        onKeyDown={handleKeyDown}
        className={className || styles.input}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
      />

      {showDropdown && (
        <div className={styles.dropdown}>
          {searchState === 'loading' && suggestions.length === 0 && (
            <div className={styles.status}>Searching…</div>
          )}
          {searchState === 'found' && (
            <ul id={listboxId} role="listbox" className={styles.list}>
              {suggestions.map((r, i) => (
                <li
                  key={r.ticker || i}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`${styles.option} ${i === activeIdx ? styles.optionActive : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => { e.preventDefault(); selectSuggestion(r) }}
                >
                  <span className={styles.optionLogo}>
                    <CompanyLogo sym={r.ticker} name={r.name || r.ticker} size={20} round />
                  </span>
                  <span className={styles.optionMain}>
                    <span className={styles.optionSym}>{r.ticker}</span>
                    {r.name && <span className={styles.optionName}>{r.name}</span>}
                  </span>
                  {r.delisted && <span className={styles.optionBadge}>Delisted</span>}
                </li>
              ))}
            </ul>
          )}
          {searchState === 'empty' && (
            <div className={styles.status}>
              Not found in current search — you can still use this symbol.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
