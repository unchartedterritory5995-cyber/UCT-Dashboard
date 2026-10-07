import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import StructureProvenance from '../../../components/screener/StructureProvenance'
import MethodologyPanel from '../../../components/screener/MethodologyPanel'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import { prefetchBars } from '../../../utils/prefetchBars'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { FiltersSheet } from '../../../components/mobile'
import { SkeletonTable } from '../../../components/Skeleton'
import UIcon from '../../../components/ui/UIcon'
import useScreenerMeta from '../hooks/useScreenerMeta'
import useScreenerScan from '../hooks/useScreenerScan'
import { scanErrorText } from './scanErrorText'
import useColumnPresets from '../hooks/useColumnPresets'
import useScreenerCount from '../hooks/useScreenerCount'
import FilterChips from '../FilterChips'
import { joinedScanReceipts } from '../ScanFilterChip'
import CoverageLine from '../../../components/provenance/CoverageLine'
import ChartsGallery from '../ChartsGallery'
import ScreensManager from '../ScreensManager'
import { COLUMN_DEFS } from '../columnDefs'
import useScreenSpec from './useScreenSpec'
import FilterRail from './FilterRail'
import CriteriaBox from './CriteriaBox'
import PromoteButton from './PromoteButton'
import UniverseBar from './UniverseBar'
import ShellToolbar from './ShellToolbar'
import VirtualResults, { LIVE_WINDOW } from './VirtualResults'
import ResultCards from './ResultCards'
import { exportScreen } from './csvExport'
import { exportQuota, downloadExport } from '../../../lib/dataExport'
import { LIVE_SORTABLE, sortRowsLive } from './liveSort'
import ScreenerReviewOverlay from './ScreenerReviewOverlay'
import FlaggedActions from './FlaggedActions'
import SaveScanButton from './SaveScanButton'
import SaveForkDialog from './SaveForkDialog'
import PresetChips from './PresetChips'
import useScreenerHubSection from '../../../hub/sections/screenerSection'
import SaveToNotebookButton from '../../journal-2-0/components/SaveToNotebookButton'
import { buildScreenerCapture } from './notebookCapture'
import { SkipLinkPortal } from '../../../components/skipLinks'
import styles from './ScannerShell.module.css'

const densityKey = 'uct.screener.density'

/**
 * ⭐ THE HUB'S DOOR ONTO THE SAVED-SCREEN PICKER (R-13) — A SEAM, NOT A SECOND PICKER.
 *
 * `ScreensManager` keeps its menu in private `open` state and exposes no prop for it, and that
 * file belongs to another workstream. So the seam lives HERE, in the component that renders it:
 * `root` is the element this shell wraps the manager in, and the trigger is the manager's own
 * "Screener ▾" button (renamed from "Screens ▾" in #167) — the same control a member taps. Opening the member's own door is what
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

/** The one identifier ChartsGallery puts on a card, and therefore the only handle the cursor
 *  paint below has. It lives in that file, which is not this workstream's to change — the rail
 *  reds if it moves. */
const galleryCardSelector = (ticker) => `[data-testid="gallery-card-${ticker}"]`

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
  const { meta, error: metaError, retry: retryMeta } = useScreenerMeta()
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
  const { presets: columnPresets, save: saveColumnPreset, remove: removeColumnPreset } = useColumnPresets()
  // PACKET-AB CP1 (fingerprint bc19457cf) -- same scanSpec, a materially cheaper
  // and faster preview count fed into FilterRail as a fast signal ahead of the
  // heavier scan above. Never replaces `result`/`isLoading` above.
  const { count: matchCount, empty: matchCountEmpty, isLoading: matchCountLoading, asOf: matchCountAsOf } =
    useScreenerCount(scanSpec)

  const [rows, setRows] = useState([])
  // null until the first scan answers — so the count shows nothing (not a
  // flashed "0 names") before the pool size is known.
  const [total, setTotal] = useState(null)
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
  const [reviewOpen, setReviewOpen] = useState(false)
  // Packet O CP1 (signed 2026-09-22, fingerprint fd57fe079)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [exportState, setExportState] = useState({})
  // AC-11 / UC-4: the save-time fork dialog -- a second entry point onto
  // saving, beside SaveScanButton's quick "name it and go" door. This one
  // asks WHAT the save becomes (frozen list / re-runnable screen / standing
  // alert) before doing anything.
  const [saveForkOpen, setSaveForkOpen] = useState(false)

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

  // FT-041/042: the metered server export. `exportQuota()` is null while the
  // server door is dark (404) or the plan is free (402) -- then the toolbar keeps
  // today's in-browser CSV and shows no Excel button.
  const [serverExport, setServerExport] = useState(null)
  useEffect(() => {
    let live = true
    exportQuota().then(q => { if (live) setServerExport(q) })
    return () => { live = false }
  }, [])

  const handleServerExport = async (format) => {
    setExportState({ busy: true })
    try {
      const out = await downloadExport('/api/exports/screener', {
        method: 'POST', format, body: { ...s.baseSpec, columns: visibleColumns } })
      setExportState({ note: `Exported ${out.rows.toLocaleString()} rows (${format.toUpperCase()})` })
      exportQuota().then(setServerExport)
    } catch (e) {
      setExportState({ error: `${e?.message || 'Export failed.'} Nothing was downloaded.` })
    } finally {
      setTimeout(() => setExportState({}), 6000)
    }
  }

  const handleExport = async () => {
    if (serverExport) return handleServerExport('csv')
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

  /* TERM-047 — THE SCAN FILTER'S OWN RECEIPT, BESIDE THE ROWS IT FILTERED.
   *
   * A `My Scans` filter joins the screen to that scan's LAST SWEEP, so a symbol
   * the sweep could not compute is silently absent from these rows — the exact
   * "a screen that loses symbols looks like a quiet market" case CoverageLine
   * exists for. The BACKEND already returns all four counts (`/api/screener/meta`
   * → the scan category's `scans[].latest`, off `scan_store.latest_coverage_for`),
   * and the filter chip beside this showed only three of them. Nothing here is
   * computed: the receipt is handed to CoverageLine whole, and CoverageLine owns
   * the refusal when its arithmetic does not close.
   *
   * WHICH SWEEP IS DECIDED IN ONE PLACE — `joinReceipt` (ScanFilterChip.jsx),
   * which the chip's applied branch also asks: only a join that APPLIED on this
   * request, and only when the meta's latest is the SAME sweep (`as_of`) the join
   * used. A stale meta, a never-swept scan or an unapplied join renders nothing
   * here, never a zeroed receipt.
   *
   * A plain screen (no scan filter) has no four-count receipt on the wire —
   * `/api/screener/scan` returns `total` and, for a ranked screen, a
   * matched/ranked pair — so no line is drawn for it, and none is invented. */
  const scanReceipts = useMemo(() => joinedScanReceipts({
    scans: (meta?.filters || []).find(f => f.key === 'scan')?.scans,
    scanJoins: result?.scan_joins,
  }), [meta, result])

  const retry = () => setRetryNonce(n => n + 1)

  /* G-040 ruling 1 — "Save to Notebook" freezes the result set AS SHOWN: the rows in
   * display order with the live cells the table painted, the visible columns, the
   * total, the seal's as-of and any scan-filter coverage. Built on press, once. */
  const buildNotebookCapture = useCallback(() => buildScreenerCapture({
    meta, filters: s.filters, visibleColumns, displayRows, livePrices: prices,
    spec: { filters: s.filters, sort: s.sort, view: s.view, columns: s.columns, rank: s.rank },
    total, snapshotDate: result?.snapshot_date, snapshot: result?.snapshot, scanReceipts,
  }), [meta, s.filters, s.sort, s.view, s.columns, s.rank, visibleColumns, displayRows,
    prices, total, result, scanReceipts])
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

  /* ⭐ R-15, THE THIRD RENDERER. `ChartsGallery` takes no `itemProps` and is not this
   * workstream's file, so the cursor is painted the other way `useHubCursor` offers:
   * `paintCursor`, "the imperative path, for markup you do not own".
   *
   * ⛔ THE NODES ARE MAPPED BY TICKER, NOT BY POSITION. `paintCursor` reads `nodes[i]` as the
   * node for `items[i]`, and the gallery paginates INTERNALLY at 24 with `page` in private
   * state — so the 24 cards on screen are some contiguous slice whose offset this file cannot
   * see. Handing it the cards in DOM order would paint the wrong row on every page but the
   * first. Looking each row's own card up by ticker (`ticker` is the row's primary key, and
   * `identityKey` in the section) is correct whatever page the gallery is on; rows that are not
   * on the current page resolve to `null`, which `paintCursor` skips.
   *
   * ⚠️ AND THAT IS THE HONEST LIMIT OF IT: a cursor sitting on a row the gallery has not paged
   * to is still invisible here, because there is no seam to reach page 2 (the same measured gap
   * `screenerSection.js` records for `scrollTo` in this view). Painting what IS on screen is
   * strictly better than painting nothing; it is not the whole answer. */
  const galleryRef = useRef(null)
  const { paintCursor } = hub.cursor
  useEffect(() => {
    if (s.view !== 'charts') return
    const root = galleryRef.current
    if (!root) return
    paintCursor(displayRows.map(r => root.querySelector(galleryCardSelector(r.ticker))))
  }, [s.view, displayRows, paintCursor])

  /* Keyboard door to "Save these results to Notebook" (ruling P5 / Q7): that button is the last
   * control in the toolbar, 339 Tab presses from the top at 1200 px. The skip link below is
   * portaled into the app shell's skip-link slot, so it is the second Tab stop; Enter lands
   * on a hidden target just before the button. Rail: ScannerShell.skipToSave.test.jsx. */
  const saveAnchorRef = useRef(null)
  const skipToSave = (e) => {
    e.preventDefault()
    saveAnchorRef.current?.focus()
  }

  const rail = meta && (
    <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
      onClear={s.clearFilters} variant={isPhone ? 'sheet' : 'rail'}
      matchCount={matchCount} matchCountEmpty={matchCountEmpty}
      matchCountLoading={matchCountLoading} matchCountAsOf={matchCountAsOf}
      criteriaSlot={<CriteriaBox logic={s.logic} onApply={s.setLogic} />} />
  )

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ''}`}>
      {!embedded && (
        <SkipLinkPortal>
          <a href="#screener-save" className={styles.skipLink} onClick={skipToSave}>Skip to save results</a>
        </SkipLinkPortal>
      )}
      {!isPhone && <div className={styles.railSlot}>{rail}</div>}
      <div className={styles.main}>
        {/* Universe = the base pool the scan runs against (UCT Universe / a
            watchlist / a union combo). Emits the existing `list` filter, so it
            needs no new endpoint; a signed-out member sees only UCT Universe. */}
        <div className={styles.universeRow}>
          <UniverseBar meta={meta} activeList={s.filters?.list} activeUniverse={s.filters?.universe}
            onSetFilter={s.setFilter} total={total} isLoading={isLoading}
            hasFilters={Object.keys(s.filters).some(k => k !== 'universe' && k !== 'list')} />
          {/* Screener dropdown (preset scans + saved screens/scans) — moved next
              to the Universe controls so building a scan reads left→right. The
              wrapper is the joystick hub's scans-door seam (scansDoorRef +
              data-hub-scans-door); here it adds a real box, not display:contents. */}
          <span ref={scansDoorRef} data-hub-scans-door="" className={styles.screenerDoor}>
            <ScreensManager currentSpec={s.baseSpec} onApply={s.applySpec}
              onUseScan={(hash, name) => {
                // useScreenSpec exposes `filters` as the raw map keyed by filter
                // key — no hook change needed for this escape hatch.
                const cur = s.filters?.scan
                const have = cur ? (Array.isArray(cur.value) ? cur.value : [cur.value]) : []
                const value = have.includes(hash) ? have : [...have, hash]
                s.setFilter('scan', { op: 'in', value: value.length === 1 ? value[0] : value, label: name })
              }} />
          </span>
          {/* One-click preset scans, right in the scan bar — each runs within the
              pool chosen to its left. */}
          <PresetChips currentSpec={s.baseSpec} onApply={s.applySpec} />
        </div>
        <ShellToolbar meta={meta} view={s.view} onView={s.setView}
          visibleColumns={visibleColumns} allColumns={allColumns}
          onColumns={s.setColumns} onResetColumns={() => s.setColumns(null)}
          presets={columnPresets}
          onApplyPreset={p => s.setColumns(p.columns)}
          onDeletePreset={removeColumnPreset}
          onSavePreset={name => saveColumnPreset(name, visibleColumns)}
          density={density} onDensity={onDensity}
          snapshot={result?.snapshot} snapshotDate={result?.snapshot_date}
          total={total} shown={rows.length} isLoading={isLoading}
          onExport={handleExport} exportState={exportState}
          onExportXlsx={serverExport ? () => handleServerExport('xlsx') : null}
          reviewBar={displayRows.length > 0 ? (
            /* ⛔ THE LOADED PAGE, NOT `total`. The toolbar can read "3,745
             * matches" while 100 rows have arrived; a review can only walk what
             * the member can see, so the button's own count is the honest number
             * and it deliberately differs from the match count beside it.
             * Opens the IN-SCREENER review overlay (below) — no navigation to
             * /charts; the member flips through the charts here, keyboard-driven. */
            <button type="button" className={styles.toolBtn} data-testid="review-charts" onClick={() => setReviewOpen(true)}>
              <UIcon name="chart" size={13} /> Review charts <b>{displayRows.length}</b>
            </button>
          ) : null}
          libraryBar={(
            <>
              <button type="button" className={styles.toolBtn} onClick={() => setLibOpen(true)}>
                <UIcon name="book" size={12} /> Structure library
              </button>
              {/* Packet O CP1 (signed 2026-09-22, fingerprint fd57fe079) -- same
                  toolBtn + Sheet idiom as "Structure library" above. */}
              <button type="button" className={styles.toolBtn} onClick={() => setMethodologyOpen(true)}>
                <UIcon name="book" size={12} /> Methodology
              </button>
            </>
          )}
          saveBar={<>
            <SaveScanButton spec={s.baseSpec}
              hasFilters={Object.keys(s.filters).length > 0} />
            <PromoteButton spec={s.baseSpec} disabled={!result || !total} />
            {/* AC-11 / UC-4: asks what this screen should BECOME -- a frozen
                list, a re-runnable screen, or a standing alert -- rather than
                SaveScanButton's always-a-definition quick save. */}
            <button type="button" className={styles.toolBtn} onClick={() => setSaveForkOpen(true)}>
              <UIcon name="save" size={13} /> Save…
            </button>
            {!embedded && (
              <span ref={saveAnchorRef} id="screener-save" tabIndex={-1} className="sr-only"
                data-screener-save-anchor="">Save results to Notebook</span>
            )}
            <SaveToNotebookButton widgetId="screener" buildCapture={buildNotebookCapture}
              label="Screener results" ariaLabel="Save these results to Notebook"
              disabled={!result || total == null} />
          </>} />
        <div className={styles.underbar}>
          <button type="button" className={styles.railToggle} onClick={() => setSheetOpen(true)}>
            <UIcon name="gear" size={12} /> Filters{Object.keys(s.filters).length ? ` · ${Object.keys(s.filters).length}` : ''}
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
          {/* Appears only once something is flagged; moves the flagged set into a
              watchlist. Self-contained (owns useFlagged); safe to always mount. */}
          <FlaggedActions />
        </div>
        {scanReceipts.length > 0 && (
          <div className={styles.scanCoverage} data-testid="scan-join-coverage">
            {scanReceipts.map(r => (
              <section key={r.def_hash} className={styles.scanCoverageItem}
                aria-label={`Coverage of the scan filter ${r.label}`}>
                <p className={styles.scanCoverageLabel}>Scan filter: {r.label}</p>
                <CoverageLine coverage={r.latest} />
              </section>
            ))}
          </div>
        )}
        {/* Quality pass 2026-10-05: a failed filter-registry read was silent -- the rail and
            the chips simply did not render. */}
        {metaError && !meta && (
          <div className={styles.scanError} role="alert" data-testid="screener-meta-failed">
            The screener&apos;s filter list couldn&apos;t be loaded, so filters, views and lists are
            unavailable right now.
            <button type="button" className="btn btn-secondary btn-sm" onClick={retryMeta}>Retry</button>
          </div>
        )}
        {error && (
          <div className={styles.scanError} role="alert">
            {scanErrorText(error)}
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
          <div className={styles.gridScroll} ref={galleryRef}>
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
      {/* Packet O CP1 (signed 2026-09-22, fingerprint fd57fe079) */}
      <Sheet open={methodologyOpen} onClose={() => setMethodologyOpen(false)} variant="auto"
        title="Methodology" ariaLabel="Methodology" maxWidth={880}>
        {methodologyOpen && <MethodologyPanel />}
      </Sheet>
      <FiltersSheet open={sheetOpen} onClose={() => setSheetOpen(false)}
        onClear={s.clearFilters} onApply={() => setSheetOpen(false)}
        title="Scan Filters" activeCount={Object.keys(s.filters).length}
        applyLabel="Show results">
        {meta && (
          <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
            onClear={s.clearFilters} variant="sheet"
            matchCount={matchCount} matchCountEmpty={matchCountEmpty}
            matchCountLoading={matchCountLoading} matchCountAsOf={matchCountAsOf}
            criteriaSlot={<CriteriaBox logic={s.logic} onApply={s.setLogic} />} />
        )}
      </FiltersSheet>
      {/* In-screener chart review — walks displayRows' tickers (the order shown)
          one chart at a time, keyboard-driven, without leaving the screener. */}
      <ScreenerReviewOverlay symbols={displayRows.map(r => r.ticker)}
        open={reviewOpen} onClose={() => setReviewOpen(false)} />
      {/* AC-11 / UC-4: the save-time fork — mounted only while open, same
          `open &&`-belt-and-braces idiom as the Sheets above. */}
      <SaveForkDialog open={saveForkOpen} onClose={() => setSaveForkOpen(false)}
        spec={s.baseSpec} />
    </div>
  )
}
