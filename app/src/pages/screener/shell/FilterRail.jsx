import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import FilterControl from './FilterControl'
import TypeFilterControl from './TypeFilterControl'
import styles from './ScannerShell.module.css'

// A glyph per filter category — makes the collapsed rail scannable at a glance.
// Keys are the category keys from filters.py::CATEGORIES; anything unmapped falls
// back to a neutral tag.
const CAT_ICON = {
  type: 'markets', descriptive: 'info', fundamental: 'dollar', performance: 'chart',
  technical: 'sliders', momentum: 'bolt', single_candle: 'ind-series',
  multi_candle: 'ind-series', pattern: 'patterns', ownership: 'user',
  events: 'calendar', context: 'globe', flow: 'flow',
  my_lists: 'star', my_scans: 'screener',
}

const openKey = k => `uct.screener.rail.${k}`
const readOpen = k => { try { return localStorage.getItem(openKey(k)) !== '0' } catch { return true } }

export default function FilterRail({ meta, activeFilters, onChange, onClear, variant = 'rail',
  matchCount, matchCountEmpty, matchCountLoading }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(() =>
    Object.fromEntries((meta?.categories || []).map(c => [c.key, readOpen(c.key)])))
  const searchRef = useRef(null)
  const railRootRef = useRef(null)

  const needle = q.trim().toLowerCase()
  // meta is optional-chained throughout so this hook stays stable even when
  // meta is momentarily null (before the initial fetch resolves) — the early
  // return below must come AFTER every hook, never between them.
  const byCat = useMemo(() => {
    const m = new Map((meta?.categories || []).map(c => [c.key, []]))
    for (const f of meta?.filters || []) {
      if (needle && !f.label.toLowerCase().includes(needle)) continue
      if (m.has(f.category)) m.get(f.category).push(f)
    }
    return m
  }, [meta, needle])

  // The flat, VISIBLE-ORDER list of filters — exactly what the JSX below
  // renders (same category/open/needle logic), so arrow-key navigation can
  // never highlight a filter the member cannot see on screen.
  const visibleFlat = useMemo(() => {
    const out = []
    for (const cat of (meta?.categories || [])) {
      const list = byCat.get(cat.key) || []
      if (needle && !list.length) continue
      const isOpen = needle ? true : open[cat.key]
      if (isOpen) out.push(...list)
    }
    return out
  }, [meta, byCat, open, needle])

  // ⭐ KEYBOARD-DRIVEN FILTER EDITING — the piece of Wave A's "A9 — Screening"
  // that was genuinely missing (live match-count and saved-screen addressing
  // both already shipped separately; see the roadmap's own §4 correction).
  // `activeKey` is the keyboard-highlighted filter — never a mouse hover —
  // so a member can find a filter and land keyboard focus INSIDE its control
  // (a native <select>'s own arrow keys / Enter finish the edit) without a
  // click. Mirrors Settings.jsx's `/`-focuses-search + arrow-nav idiom
  // exactly rather than inventing a second convention for the same gesture.
  // Seeded to the first visible filter so the rail opens already highlighting
  // something — Enter with nothing typed is a valid, complete flow.
  const [activeKey, setActiveKey] = useState(() => visibleFlat[0]?.key ?? null)

  // A new query always re-anchors the highlight to the first match, so
  // type-then-Enter (no arrow keys at all) is a complete, valid flow.
  //
  // ⭐ ADJUSTED DURING RENDER, NOT IN AN EFFECT — React's own documented
  // "adjusting state when a prop changes" pattern. Comparing `needle` against
  // its previous value here lets the highlight land correctly in the SAME
  // render the query changes in, rather than painting the stale highlight for
  // one frame and correcting it a tick later the way a `useEffect` reset would.
  const [prevNeedle, setPrevNeedle] = useState(needle)
  if (needle !== prevNeedle) {
    setPrevNeedle(needle)
    setActiveKey(visibleFlat[0]?.key ?? null)
  }

  // ⭐ `/` FOCUSES THE FILTER SEARCH — the same GitHub/Settings.jsx convention
  // this app already uses on `/settings` (its own rail search), not a new
  // one invented here. Desktop `rail` variant ONLY: the `sheet` variant is a
  // modal a touch member opens by hand, and a page-global keydown reaching a
  // hidden/unmounted instance would do nothing, or steal focus from the
  // wrong surface once it IS open — which the dialog check below also guards.
  useEffect(() => {
    if (variant !== 'rail') return undefined
    const inTextControl = () => {
      const el = document.activeElement
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    // ⛔ EVERY MODAL IN THIS APP (`Sheet.jsx`) RENDERS `role="dialog"` —
    // Structure library, Methodology, the mobile Filters sheet, chart review,
    // BuilderSheet. A generic check here covers all of them without threading
    // a prop for each one through ScannerShell, and without this rail having
    // to know any of their names. Ripping keyboard focus out of an open
    // dialog into a hidden background input is a real bug, not a cosmetic one
    // — ScreenerReviewOverlay's own arrow-key handler ignores a keydown whose
    // target is a text input, so stealing focus into this search box would
    // silently break chart-review navigation until the member clicked away.
    const dialogOpen = () => document.querySelector('[role="dialog"]') !== null
    const onKey = e => {
      if (e.key === '/' && !inTextControl() && !dialogOpen()) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant])

  if (!meta) return null

  const toggle = key => setOpen(prev => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(openKey(key), next[key] ? '1' : '0') } catch { /* private mode */ }
    return next
  })
  const activeIn = key => (meta.filters || [])
    .filter(f => f.category === key && activeFilters[f.key]).length
  const activeTotal = Object.keys(activeFilters).length

  // Node lookup by filter key — iterated rather than built as a CSS selector
  // string, so a key never needs escaping and this never depends on whether
  // the runtime supports `CSS.escape`.
  const filterNode = key => {
    const root = railRootRef.current
    if (!root || !key) return null
    for (const el of root.querySelectorAll('[data-filter-key]')) {
      if (el.dataset.filterKey === key) return el
    }
    return null
  }

  const moveActive = dir => {
    if (!visibleFlat.length) return
    const i = visibleFlat.findIndex(f => f.key === activeKey)
    const next = visibleFlat[(i === -1 ? 0 : i + dir + visibleFlat.length) % visibleFlat.length]
    setActiveKey(next.key)
    filterNode(next.key)?.scrollIntoView({ block: 'nearest' })
  }

  // Enter is the hand-off: it moves REAL keyboard focus into the highlighted
  // filter's own control (its <select>, or its first custom-range input, or
  // — for the type-set control — its Include/Exclude toggle). From there the
  // browser's native control does the rest: arrow keys change a <select>'s
  // value, Enter commits it. This search box only ever decides WHICH filter
  // is in view; it never sets a filter's value itself.
  //
  // ⛔ `:not([data-coldesc])` — a filter that carries a `desc` in columnDefs.js
  // renders ColumnDesc's "What X means" info trigger BEFORE the real control
  // in document order (FilterControl.jsx). A bare first-focusable query would
  // land Enter on that tooltip button instead of the filter, for every
  // described column, silently — this is the exact filter that keeps Enter
  // landing on the CONTROL rather than on whichever button happens to be
  // painted first.
  const jumpToActive = () => {
    if (!activeKey) return
    filterNode(activeKey)?.querySelector('select, input, button:not([data-coldesc])')?.focus()
  }

  const onSearchKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); jumpToActive() }
    else if (e.key === 'Escape') {
      e.preventDefault()
      if (q) setQ('')
      else searchRef.current?.blur()
    }
  }

  return (
    <div ref={railRootRef} className={variant === 'sheet' ? styles.railSheet : styles.rail} data-testid="filter-rail">
      <div className={styles.railSearchRow}>
        <UIcon name="search" size={12} />
        <input ref={searchRef} className={styles.railSearch}
          placeholder={variant === 'rail' ? 'Find a filter…  ( / )' : 'Find a filter…'} value={q}
          aria-label="Find a filter" onChange={e => setQ(e.target.value)}
          onKeyDown={onSearchKeyDown} />
        {activeTotal > 0 && (
          <button type="button" className={styles.railClear} onClick={onClear}>Clear {activeTotal}</button>
        )}
      </div>
      {/* The distribution basis note + per-control percentile bands were removed
          by owner request; the rail is the search + grouped controls. */}
      {/* PACKET-AB CP1 (fingerprint bc19457cf): a fast preview-count badge fed
          by the cheap /api/screener/count endpoint, decoupled from and never
          replacing ShellToolbar's own full-scan-derived status line. Same
          wording as that line so the two can never read as disagreeing.
          ⛔ Deliberately NO aria-live here -- tools/screener_ui_stress.py's
          existing check reads the FIRST [aria-live="polite"] element in DOM
          order, which is ShellToolbar's status line; giving this badge the
          same attribute would silently redirect that check to the wrong
          element (it would keep passing while watching nothing real). */}
      {(matchCountLoading || matchCount != null) && (
        <div className={`${styles.railMatchCount} ${matchCountEmpty ? styles.railMatchCountEmpty : ''}`}>
          {matchCountLoading && matchCount == null
            ? 'Scanning…'
            : `${(matchCount ?? 0).toLocaleString()} matches`}
        </div>
      )}
      {(meta.categories || []).map(cat => {
        const list = byCat.get(cat.key) || []
        if (needle && !list.length) return null
        const isOpen = needle ? true : open[cat.key]
        const n = activeIn(cat.key)
        return (
          <section key={cat.key} className={styles.railGroup}>
            <button type="button" className={styles.railHead} aria-expanded={isOpen}
              onClick={() => toggle(cat.key)}>
              <span className={styles.railHeadIcon}>
                <UIcon name={CAT_ICON[cat.key] || 'tag'} size={14} gold={false} />
              </span>
              <span className={styles.railHeadLabel}>{cat.label}</span>
              {n > 0 && <span className={styles.railPip}>{n}</span>}
              <span className={styles.railChev}>
                <UIcon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} gold={false} />
              </span>
            </button>
            {isOpen && list.map(f => (
              <div key={f.key} data-filter-key={f.key}
                className={f.key === activeKey ? styles.railFilterActive : undefined}>
                {f.control === 'typeset' ? (
                  <TypeFilterControl filter={f}
                    value={activeFilters[f.key] || null}
                    onChange={v => onChange(f.key, v)} />
                ) : (
                  <FilterControl filter={f}
                    value={activeFilters[f.key] || null}
                    basis={meta.distribution_basis || null}
                    onChange={v => onChange(f.key, v)} />
                )}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
