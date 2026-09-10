import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import StructureProvenance from '../../../components/screener/StructureProvenance'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import { prefetchBars } from '../../../utils/prefetchBars'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { FiltersSheet } from '../../../components/mobile'
import { SkeletonTable } from '../../../components/Skeleton'
import UIcon from '../../../components/ui/UIcon'
import useScreenerMeta from '../hooks/useScreenerMeta'
import useScreenerScan from '../hooks/useScreenerScan'
import FilterChips from '../FilterChips'
import ChartsGallery from '../ChartsGallery'
import ScreensManager from '../ScreensManager'
import { COLUMN_DEFS } from '../columnDefs'
import useScreenSpec from './useScreenSpec'
import FilterRail from './FilterRail'
import ShellToolbar from './ShellToolbar'
import VirtualResults, { LIVE_WINDOW } from './VirtualResults'
import ResultCards from './ResultCards'
import { exportScreen } from './csvExport'
import { LIVE_SORTABLE, sortRowsLive } from './liveSort'
import ReviewChartsButton from '../../charts/review/ReviewChartsButton'
import useScreenerHubSection from '../../../hub/sections/screenerSection'
import styles from './ScannerShell.module.css'

const densityKey = 'uct.screener.density'

/**
 * ⭐ THE HUB'S DOOR ONTO THE SAVED-SCREEN PICKER (R-13) — A SEAM, NOT A SECOND PICKER.
 *
 * `ScreensManager` keeps its menu in private `open` state and exposes no prop for it, and that
 * file belongs to another workstream. So the seam lives HERE, in the component that renders it:
 * `root` is the element this shell wraps the manager in, and the trigger is the manager's own
 * "Screens ▾" button — the same control a member taps. Opening the member's own door is what
 * makes this a seam rather than a second authority over what a saved screen is; a copy of the
 * picker mounted from the hub would be two menus disagreeing the day one of them changed.
 *
 * ⛔ IT OPENS; IT NEVER TOGGLES. The trigger is `onClick={() => setOpen(o => !o)}`, so clicking
 * it while the menu is already up would CLOSE the picker the member just asked for. The
 * already-open case is real: the hub's own press lands as a document `mousedown` first, which
 * `ScreensManager`'s outside-click handler acts on, and the ordering of compatibility mouse
 * events after a touch is not ours to rely on. So the menu is asked for by its ARIA role — the
 * one thing about that markup this file is entitled to know — and a menu already on screen is
 * left alone.
 *
 * ⛔ THE TRIGGER IS THE WRAPPER'S FIRST BUTTON, and that is pinned rather than assumed:
 * `ScreensManager` renders it as the first child of `.saveMenuWrap`, ahead of the popover, so
 * document order settles it. If that ever stops being true this reaches the wrong control
 * silently — which is why `screenerScansDoor.test.jsx` drives the REAL manager and asserts the
 * REAL menu opened, and fails by name rather than by a green no-op.
 *
 * @param {Element|null|undefined} root  The element wrapping `ScreensManager`.
 * @returns {boolean} whether the picker is open (or was already) as a result of this call.
 */
export function openScansPicker(root) {
  if (!root || typeof root.querySelector !== 'function') return false
  if (root.querySelector('[role="menu"]')) return true
  const trigger = root.querySelector('button')
  if (!trigger) return false
  trigger.click()
  return true
}

// ScannerShell — the drop-in replacement for ScannerPro (same `embedded` prop).
// Composes every landed shell piece into one orchestrator: honest loading/
// empty/error states (all present at once by construction — no `!data ?
// <spinner> : <table>` binary), the live-sort honesty chip, the loud CSV
// export path, and the desktop-rail / phone-sheet split.
//
// ⛔ MOUNTS AHEAD OF THE CANDIDATE-BOARD GATE, DELIBERATELY (Wave 4 Task 7).
// `ScreensManager` — and through it the My-scans definition detail
// (`ScanResults` → `CoverageLine`, the four-outcome coverage receipt) — lives
// inside THIS component, in the `saveBar` slot below. `Screener.jsx` renders
// `<ScannerShell/>` in the FIRST arm of its tab ternary (`pageTab ===
// 'scanner'`), ahead of the `/api/candidates` chain (`error ? … : !data ?
// <SkeletonTable/> : …`) — verified in that file. A saved formula's scan
// receipt reads its own store, has nothing to do with the 7 AM candidate
// board's feed, and must never go blank because that unrelated fetch failed.
export default function ScannerShell({ embedded = false }) {
  const { meta } = useScreenerMeta()
  const isPhone = useIsPhone()
  const viewColumnsFor = useMemo(() => {
    const map = Object.fromEntries((meta?.views || []).map(v => [v.key, v.columns]))
    return key => map[key] || map.overview || null
  }, [meta])
  const s = useScreenSpec({ viewColumnsFor })
  // Retry must change the spec's JSON or useScreenerScan's key-diff refires
  // nothing. `_retry` rides the spec; Pydantic v2 ignores unknown fields, so
  // the server never sees it as anything but noise. Zero is omitted so the
  // steady-state spec (and the URL codec, which never reads it) is untouched.
  const [retryNonce, setRetryNonce] = useState(0)
  const scanSpec = useMemo(
    () => (retryNonce ? { ...s.scanSpec, _retry: retryNonce } : s.scanSpec),
    [s.scanSpec, retryNonce])
  const { result, isLoading, error } = useScreenerScan(scanSpec)

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!result) return
    setTotal(result.total)
    setRows(prev => (result.page === 1 ? result.rows : [...prev, ...result.rows]))
  }, [result])

  const liveTickers = useMemo(() => rows.slice(0, LIVE_WINDOW).map(r => r.ticker), [rows])
  const { prices } = useRealtimePrices(liveTickers)
  useEffect(() => { if (rows.length) prefetchBars(rows.slice(0, 30).map(r => r.ticker), 'D') }, [rows])

  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem(densityKey) || 'compact' } catch { return 'compact' }
  })
  const onDensity = d => { setDensity(d); try { localStorage.setItem(densityKey, d) } catch { /* ok */ } }
  const [liveSortOn, setLiveSortOn] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [exportState, setExportState] = useState({})

  // ⛔⛔ THE SERVER'S OWN ANSWER OUTRANKS A FABRICATED ONE. `s.visibleColumns` is
  // null until `meta` lands (`viewColumnsFor` builds its map from `meta.views`),
  // and `/api/screener/meta` is the whole filter registry while the scan is a
  // SEPARATE request — so the scan routinely wins that race. This used to fall
  // straight to `['ticker']`, and a member watching 3,745 rows arrive behind ONE
  // column reads that as a broken screener; measured on prod twice, 2026-08-29.
  //
  // `result.view_columns` is what the query ACTUALLY selected (`query.py` L1170,
  // echoed L1280) and it arrives WITH the rows it describes, so the two can
  // never disagree — `exportCsv.js` L35 has always read it for exactly that
  // reason. Deriving the list from `meta` a second time was the second
  // authority; this makes the fallback ask the side that ran the query.
  //
  // ⚠️ ORDER IS DELIBERATE. `s.visibleColumns` stays FIRST so a member's own
  // Columns/view choice still wins the moment meta is known — the echo is a
  // fallback for the unanswered window, not a new owner of the list. `['ticker']`
  // survives for the case where nobody has answered at all, where there are no
  // rows for it to misdescribe.
  const visibleColumns = s.visibleColumns || result?.view_columns || ['ticker']
  const allColumns = useMemo(() => {
    const keys = new Set(Object.keys(COLUMN_DEFS))
    for (const v of meta?.views || []) v.columns.forEach(c => keys.add(c))
    for (const f of meta?.filters || []) if (f.column) keys.add(f.column)
    return [...keys].map(k => ({ key: k, label: COLUMN_DEFS[k]?.label || k }))
  }, [meta])

  const handleExport = async () => {
    setExportState({ busy: true })
    try {
      const labels = Object.fromEntries(visibleColumns.map(c => [c, COLUMN_DEFS[c]?.label || c]))
      const out = await exportScreen({ spec: { ...s.baseSpec, columns: visibleColumns },
        columns: visibleColumns, labels, snapshotDate: result?.snapshot_date })
      setExportState({ note: `Exported ${out.rows.toLocaleString()} rows${out.truncated ? ' (capped at 5,000)' : ''}` })
    } catch {
      setExportState({ error: 'Export failed — nothing downloaded. Try again.' })
    } finally {
      setTimeout(() => setExportState({}), 6000)
    }
  }

  /* ⭐ THE ORDER ON SCREEN, DECIDED ONCE, FOR EVERY RENDERER.
   *
   * This used to live inside `VirtualResults`, which made it true of the
   * desktop table and of nothing else: the live-sort toggle sits in the
   * underbar, which the PHONE also renders, so a member could turn on
   * "Re-sort loaded rows live" and watch `ResultCards` ignore it.
   *
   * ⛔ AND "REVIEW CHARTS" NEEDS THIS LIST, NOT `rows`. The review publishes the
   * order the member is looking at; if the display order is computed inside a
   * child, the surface that has to name it cannot see it, and re-deriving it
   * here would be a second authority over one list. */
  const displayRows = useMemo(
    () => (liveSortOn ? sortRowsLive(rows, s.sort, prices) : rows),
    [liveSortOn, rows, s.sort, prices])

  const retry = () => setRetryNonce(n => n + 1)
  const isEmpty = result && total === 0
  const hasMore = rows.length < total
  const liveSortEligible = LIVE_SORTABLE.has(s.sort?.key)

  /* ⭐ THE JOYSTICK HUB'S SCREENER SECTION (Phase 3 §3.3), registered from HERE because this is
   * the component that owns `displayRows` — the array AS RENDERED. Registering `rows` instead
   * would make the hub cursor and the list on screen disagree the moment the live re-sort is on,
   * which is the same reason the sort was lifted into this file in the first place.
   *
   * `resultsRef` is the consumer the `scrollToIndex` seams in `VirtualResults` / `ResultCards`
   * were built for and have been waiting on since Phase 1. `hubMount` is the section's own
   * mount point: its feedback toast (which must outlive the control that fires it) plus the
   * auth-guarded bridge its Flag/Alert actions reach through. Everything else — the cursor, the
   * fan, the chip — lives in `hub/sections/screenerSection.js`. */
  /* R-13: the seam above, bound to the element this shell wraps `ScreensManager` in. Stable
   * identity so the section's fan does not change every render. */
  const scansDoorRef = useRef(null)
  const openScans = useCallback(() => { openScansPicker(scansDoorRef.current) }, [])

  const hub = useScreenerHubSection({
    displayRows, filters: s.filters, prices, hasMore, loadMore: s.loadMore,
    onOpenScans: openScans,
  })

  const rail = meta && (
    <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
      onClear={s.clearFilters} variant={isPhone ? 'sheet' : 'rail'} />
  )

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ''}`}>
      {!isPhone && <div className={styles.railSlot}>{rail}</div>}
      <div className={styles.main}>
        <ShellToolbar meta={meta} view={s.view} onView={s.setView}
          visibleColumns={visibleColumns} allColumns={allColumns}
          onColumns={s.setColumns} onResetColumns={() => s.setColumns(null)}
          density={density} onDensity={onDensity}
          snapshot={result?.snapshot} snapshotDate={result?.snapshot_date}
          total={total} shown={rows.length} isLoading={isLoading}
          onExport={handleExport} exportState={exportState}
          reviewBar={(
            /* ⛔ THE LOADED PAGE, NOT `total`. The toolbar can read "3,745
             * matches" while 100 rows have arrived; a review can only walk what
             * the member can see, so the button's own count is the honest number
             * and it deliberately differs from the match count beside it. */
            <ReviewChartsButton
              symbols={displayRows.map(r => r.ticker)}
              source="screener"
              label="Screener"
              /* ⛔ THE ORDERING IS NAMED, INCLUDING THE LIVE FLAG. A review taken
               * under the live re-sort walked a different list from one taken
               * under snapshot order, and the session records which — the same
               * distinction the "snapshot order" chip makes on screen. */
              sort={s.sort?.key
                ? `${s.sort.key}:${s.sort.dir || 'desc'}${liveSortOn ? ':live' : ''}`
                : null}
            />
          )}
          /* ⛔ THE WRAPPER IS THE SEAM'S ANCHOR, and `display:contents` is load-bearing: the
             toolbar's `.toolGroup` is a flex row and `.saveMenuWrap` positions the popover
             against itself, so the wrapper must add a queryable node and NO box. */
          saveBar={<span ref={scansDoorRef} data-hub-scans-door="" style={{ display: 'contents' }}>
            <ScreensManager currentSpec={s.baseSpec} onApply={s.applySpec}
            onUseScan={(hash, name) => {
              // useScreenSpec already exposes `filters` as the raw map keyed
              // by filter key (see shell/useScreenSpec.js's return object) —
              // no hook change was needed for this escape hatch.
              const cur = s.filters?.scan
              const have = cur ? (Array.isArray(cur.value) ? cur.value : [cur.value]) : []
              const value = have.includes(hash) ? have : [...have, hash]
              s.setFilter('scan', { op: 'in', value: value.length === 1 ? value[0] : value,
                                    label: name })
            }} />
          </span>} />
        <div className={styles.underbar}>
          <button type="button" className={styles.railToggle} onClick={() => setSheetOpen(true)}>
            <UIcon name="gear" size={12} /> Filters{Object.keys(s.filters).length ? ` · ${Object.keys(s.filters).length}` : ''}
          </button>
          <button type="button" className={styles.toolBtn} onClick={() => setLibOpen(true)}>
            <UIcon name="book" size={11} /> Structure library
          </button>
          <FilterChips meta={meta} activeFilters={s.filters}
            onRemove={key => s.setFilter(key, null)} onClear={s.clearFilters}
            scanJoins={result?.scan_joins} onReplace={(k, v) => s.setFilter(k, v)} />
          {liveSortEligible && (
            <span className={styles.sortHonesty}>
              {!liveSortOn && <span className={styles.snapChip}>snapshot order</span>}
              <button type="button" className={styles.toolBtn} aria-pressed={liveSortOn}
                onClick={() => setLiveSortOn(v => !v)}>
                <UIcon name="bolt" size={11} /> Re-sort loaded rows live
              </button>
            </span>
          )}
        </div>
        {error && (
          <div className={styles.scanError} role="alert">
            Scan failed — {String(error.message || error)}.
            <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>Retry</button>
          </div>
        )}
        {!result && isLoading ? (
          <SkeletonTable rows={12} cols={6} />
        ) : isEmpty ? (
          <div className={styles.empty}>
            No stocks match the current filters. Remove a chip above or Reset — the
            toolbar and views stay live.
          </div>
        ) : s.view === 'charts' ? (
          <div className={styles.gridScroll}>
            <ChartsGallery rows={displayRows} livePrices={prices} />
            {hasMore && (
              <div className={styles.loadMoreRow}>
                <button type="button" className={styles.loadMoreBtn} disabled={isLoading}
                  onClick={s.loadMore}>{isLoading ? 'Loading…' : 'Load more'}</button>
              </div>
            )}
          </div>
        ) : isPhone ? (
          <ResultCards ref={hub.resultsRef} itemProps={hub.cursor.itemProps}
            rows={displayRows} columns={visibleColumns} livePrices={prices}
            hasMore={hasMore} onLoadMore={s.loadMore} isLoading={isLoading} />
        ) : (
          <VirtualResults ref={hub.resultsRef} itemProps={hub.cursor.itemProps}
            rows={displayRows} columns={visibleColumns} sort={s.sort}
            onSort={s.setSort} livePrices={prices}
            density={density} view={s.view} hasMore={hasMore}
            onLoadMore={s.loadMore} isLoading={isLoading} />
        )}
      </div>
      {hub.hubMount}
      {/* THE DOOR TO THE RESEARCH. The base library holds ~210 criteria across 26
          structures -- verbatim source sentences, our own numbers labelled as
          ours, and refusals naming what a house declined to publish. It reached
          no screen until this button. Rendered only while open so a screener
          load never pays for a fetch nobody asked for.

          MEASURED, not assumed: `Sheet` already returns null while closed
          (Sheet.jsx L120), so it is SHEET that keeps the panel unmounted, and
          this `libOpen &&` is belt-and-braces -- deleting it changes no
          behaviour today and no test reds. It stays because it makes the
          intent local: if Sheet ever keeps children mounted to animate an
          exit, the property survives here. Do not read it as the guard. */}
      {/* ⛔ `ariaLabel` IS NOT A DUPLICATE OF `title`. Sheet renders `title`
          into a plain <div> and names the dialog from `ariaLabel` ALONE —
          `aria-label={ariaLabel || undefined}`, Sheet.jsx L142, with no
          aria-labelledby wiring, exactly as its own header comment says. Passing
          only `title` therefore opened an `aria-modal` dialog with NO accessible
          name: a screen reader announced "dialog" and nothing else, on the one
          panel in the screener whose entire job is telling a member who said
          what. Verified against Sheet.jsx, not assumed. */}
      <Sheet open={libOpen} onClose={() => setLibOpen(false)} variant="auto"
        title="Structure library" ariaLabel="Structure library" maxWidth={880}>
        {libOpen && <StructureProvenance />}
      </Sheet>
      <FiltersSheet open={sheetOpen} onClose={() => setSheetOpen(false)}
        onClear={s.clearFilters} onApply={() => setSheetOpen(false)}
        title="Scan Filters" activeCount={Object.keys(s.filters).length}
        applyLabel="Show results">
        {meta && (
          <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
            onClear={s.clearFilters} variant="sheet" />
        )}
      </FiltersSheet>
    </div>
  )
}
