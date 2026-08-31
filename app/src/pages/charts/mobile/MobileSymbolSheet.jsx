import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import CompanyLogo from '../../../components/CompanyLogo'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import { POPULAR_RESULTS } from '../../../components/chart/SymbolSearch'
import { listRecents } from './mobileRecents'
import styles from './MobileCharts.module.css'

// Same shape the desktop dropdown accepts as a typeable ticker (SymbolSearch's
// "Go to X" fallback): letters, digits, dot, hyphen — never spaces.
const TICKERISH = /^[A-Z][A-Z0-9.-]{0,9}$/

/* Full-screen symbol search — the phone door onto /api/ticker-search. Opens
 * with the keyboard up (16px input so iOS never zooms), shows Recents +
 * Popular while empty, live results while typing, and always offers a
 * "Go to X" row so any symbol works even before the ranked list knows it.
 *
 * All search state lives in SearchBody, which the Sheet unmounts on close —
 * every open starts from a fresh query with no reset effects.
 */
export default function MobileSymbolSheet({ open, onClose, onPick, className = '' }) {
  return (
    <Sheet open={open} onClose={onClose} variant="fullscreen" ariaLabel="Symbol search" className={`${styles.searchPanel} ${className}`}>
      <SearchBody onClose={onClose} onPick={onPick} />
    </Sheet>
  )
}

function SearchBody({ onClose, onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  // Focus once the sheet has painted (mount = open; the Sheet unmounts us on close).
  useEffect(() => {
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [])

  // Debounced predictive fetch — the same endpoint + cadence the desktop
  // SymbolSearch uses (150ms, aborting the in-flight request on re-key).
  // The empty-query case never reaches here: handleChange clears results
  // synchronously in the event handler.
  useEffect(() => {
    const q = query.trim()
    if (!q) return undefined
    const t = setTimeout(async () => {
      try {
        abortRef.current?.abort()
        const ctl = new AbortController()
        abortRef.current = ctl
        const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`, { signal: ctl.signal, credentials: 'include' })
        if (!r.ok) return
        const data = await r.json()
        setResults(Array.isArray(data?.results) ? data.results : [])
      } catch { /* aborted / offline — keep whatever is showing */ }
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  const handleChange = (e) => {
    const v = e.target.value.toUpperCase()
    setQuery(v)
    if (!v.trim()) setResults([])
  }

  const commit = (ticker) => {
    haptics.tap()
    onPick(ticker)
  }

  const q = query.trim().toUpperCase()
  const exactShown = results.some((r) => r.ticker === q)
  const recents = q ? [] : listRecents()

  const row = (ticker, name, keyPrefix = '') => (
    <button key={`${keyPrefix}${ticker}`} type="button" className={styles.resultRow} onClick={() => commit(ticker)}>
      <CompanyLogo sym={ticker} size={30} round />
      <span className={styles.resultTicker}>{ticker}</span>
      <span className={styles.resultName}>{name || ''}</span>
    </button>
  )

  return (
    <>
      <div className={styles.searchHead}>
        <div className={styles.searchInputWrap}>
          <UIcon name="search" size={16} gold={false} />
          <input
            ref={inputRef}
            className={styles.searchInput}
            value={query}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q) {
                // Follow the visual order: the "Go to X" row leads when the exact
                // ticker isn't in the ranked results; otherwise the top result
                // (the backend ranks exact matches first).
                const target = (!exactShown && TICKERISH.test(q)) ? q : results[0]?.ticker
                if (target) commit(target)
              }
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Search symbol"
            aria-label="Search symbol"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="text"
          />
        </div>
        <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
      </div>

      <div className={styles.sheetList}>
        {q ? (
          <>
            {!exactShown && TICKERISH.test(q) && (
              <button type="button" className={styles.resultRow} onClick={() => commit(q)}>
                <span className={styles.rowIcon}><UIcon name="chevronRight" size={16} gold={false} /></span>
                <span className={styles.resultTicker}>{q}</span>
                <span className={styles.resultName}>Go to {q}</span>
              </button>
            )}
            {results.map((r) => row(r.ticker, r.name))}
            {results.length === 0 && !TICKERISH.test(q) && (
              <div className={styles.emptyHint}>No matches.</div>
            )}
          </>
        ) : (
          <>
            {recents.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Recent</div>
                {recents.map((s) => row(s, null, 'r-'))}
              </>
            )}
            <div className={styles.sectionLabel}>Popular</div>
            {POPULAR_RESULTS.map((r) => row(r.ticker, r.name, 'p-'))}
          </>
        )}
      </div>
    </>
  )
}
