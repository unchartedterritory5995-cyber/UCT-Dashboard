import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import CompanyLogo from '../../../components/CompanyLogo'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import { POPULAR_RESULTS, CHIPS, INDICES_PRESET, matchQ, rowIdentity } from '../../../components/chart/symbolSearchModel'
import uctMark from '../../../components/intro/assets/compass-mark.png'
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
  /* ⭐ THE CATEGORY FILTER THE API ALREADY SUPPORTED. `/api/ticker-search` has
     taken a `type` param since it was written and the desktop dropdown has had
     chips for it; the phone — the surface where a long ambiguous list costs the
     most — had no control at all. */
  const [chip, setChip] = useState('all')
  const [breadthAll, setBreadthAll] = useState([])
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  // Focus once the sheet has painted (mount = open; the Sheet unmounts us on close).
  useEffect(() => {
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [])

  // The UCT breadth catalog, fetched once — the Breadth chip filters this list
  // rather than the ticker index, exactly as the desktop dropdown does.
  useEffect(() => {
    if (breadthAll.length) return undefined
    let alive = true
    fetch('/api/breadth-symbols')
      .then((r) => (r.ok ? r.json() : { symbols: [] }))
      .then((d) => {
        if (!alive) return
        setBreadthAll((d.symbols || []).map((x) => ({
          ticker: String(x.symbol || '').toUpperCase(),
          name: x.name || x.label || '',
          type: 'breadth', breadth: true, group_label: x.group,
        })).filter((r) => r.ticker))
      })
      .catch(() => { /* leave empty — the chip then shows nothing, never a crash */ })
    return () => { alive = false }
  }, [breadthAll.length])

  // Debounced predictive fetch — the same endpoint + cadence the desktop
  // SymbolSearch uses (150ms, aborting the in-flight request on re-key).
  // The empty-query case never reaches here: handleChange clears results
  // synchronously in the event handler.
  useEffect(() => {
    const q = query.trim()
    if (!q) return undefined
    // Indices and Breadth are closed, client-side lists on both surfaces — no
    // round trip can improve an answer we already hold in full.
    if (chip === 'index') { setResults(INDICES_PRESET.filter((r) => matchQ(r, q))); return undefined }
    if (chip === 'breadth') { setResults(breadthAll.filter((r) => matchQ(r, q))); return undefined }
    const typeParam = CHIPS.find((c) => c.key === chip)?.type || ''
    const t = setTimeout(async () => {
      try {
        abortRef.current?.abort()
        const ctl = new AbortController()
        abortRef.current = ctl
        const url = `/api/ticker-search?q=${encodeURIComponent(q)}&limit=20${typeParam ? `&type=${typeParam}` : ''}`
        const r = await fetch(url, { signal: ctl.signal, credentials: 'include' })
        if (!r.ok) return
        const data = await r.json()
        let arr = Array.isArray(data?.results) ? data.results : []
        // Belt and braces, mirroring the desktop: an older backend that ignores
        // `type` must not make the chip look broken.
        if (typeParam && arr.some((x) => x.type)) arr = arr.filter((x) => x.type === typeParam)
        setResults(arr)
      } catch { /* aborted / offline — keep whatever is showing */ }
    }, 150)
    return () => clearTimeout(t)
  }, [query, chip, breadthAll])

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

  /* ⛔ THE ROW NOW SAYS WHAT THE SYMBOL IS. It used to render a logo, a ticker
     and a name and drop everything else the endpoint returned — so a DELISTED
     ticker was visually identical to a live one, and tapping it produced a dead
     chart with nothing having warned you. `rowIdentity` is the same function the
     desktop dropdown uses, so the two surfaces cannot drift again. */
  const row = (r, keyPrefix = '') => {
    const { exchange, badge } = rowIdentity(r)
    return (
      <button key={`${keyPrefix}${r.ticker}`} type="button"
        className={`${styles.resultRow} ${badge?.kind === 'delisted' ? styles.resultRowDelisted : ''}`}
        onClick={() => commit(r.ticker)}>
        {r.breadth
          ? <img src={uctMark} alt="" width={30} height={30} className={styles.resultMark} />
          : <CompanyLogo sym={r.ticker} size={30} round />}
        <span className={styles.resultTicker}>{r.ticker}</span>
        <span className={styles.resultName}>{r.name || ''}</span>
        <span className={styles.resultTags}>
          {exchange && <span className={styles.resultExch}>{exchange}</span>}
          {badge && (
            <span className={`${styles.symBadge} ${styles[`symBadge_${badge.kind}`] || ''}`}>{badge.text}</span>
          )}
        </span>
      </button>
    )
  }

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

      <div className={styles.symChipRow} role="tablist" aria-label="Filter symbols by category">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={chip === c.key}
            className={`${styles.symChip} ${chip === c.key ? styles.symChipActive : ''}`}
            onClick={() => { haptics.tap(); setChip(c.key) }}
          >{c.label}</button>
        ))}
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
            {results.map((r) => row(r))}
            {results.length === 0 && !TICKERISH.test(q) && (
              <div className={styles.emptyHint}>No matches.</div>
            )}
          </>
        ) : (
          <>
            {recents.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Recent</div>
                {recents.map((sy) => row({ ticker: sy }, 'r-'))}
              </>
            )}
            <div className={styles.sectionLabel}>Popular</div>
            {(chip === 'index' ? INDICES_PRESET
              : chip === 'breadth' ? breadthAll
              : chip === 'all' ? POPULAR_RESULTS
              : POPULAR_RESULTS.filter((r) => r.type === CHIPS.find((c) => c.key === chip)?.type)
            ).map((r) => row(r, 'p-'))}
          </>
        )}
      </div>
    </>
  )
}
