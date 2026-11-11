import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from '../../../context/AuthContext'
import usePreferences from '../../../hooks/usePreferences'
import { useFlagged } from '../../../hooks/useFlagged'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { widgetOwnChrome, chartTypeCanvasEntry } from '../../charts/widgetChrome'
import { uctDefaultTabSettings } from '../../charts/chartTabs'
import useDrillWorkspace from './drillWorkspace'
import { DrillSourceContext } from './DrillSourceContext'
import BreadthDrillBoard from './BreadthDrillBoard'
import PopoutWindow from '../../charts/popout/PopoutWindow'
import PopoutShell from '../../charts/popout/PopoutShell'
import WidgetHost from '../../charts/WidgetHost'
import {
  DRILL_BOARD_PREF, LIST_WIDGET_ID, CHART_WIDGET_ID, MODE_SPLIT, SCAN_MODES,
  parseBoard, serializeBoard,
} from './drillBoardPrefs'
import useScanDeck from './scan/useScanDeck'
import { dayContext, stepDate } from './scan/scanDeckModel'
import { ScanHeader } from './scan/ScanDeckParts'
import ScanGrid from './scan/ScanGrid'
import { FilterButton, FilterChips } from './scan/ScanFilters'
import { DRILL_POPOVER_ATTR } from './scan/scanFacets'
import JoinedDateNav from './JoinedDateNav'
import { resetDrillSort } from './drillListCols'
import { followAppTheme } from './drillTheme'
import styles from './BreadthDrillModal.module.css'
import { longHistoryCache, loadLongHistory, mergeHistory } from './longHistory'


const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// The portaled menus a widget can have open above this modal. Kept in sync with
// `WidgetHeader.jsx` by a rail that reads that file, not by memory.
export const WIDGET_MENU_SELECTOR = '[data-wtab-add-menu],[data-float-tab-menu]'

const POPUP_BLOCKED_MSG = 'Your browser blocked the pop-out window. Allow pop-ups for this site and try again.'

// The built-in scan look: the same settings a brand-new /charts chart tab starts
// with (price, the four default averages, volume) and none of a member's own
// indicator panes. Before this, the drill chart inherited the member's whole
// /charts stack and the price pane got a fifth of the height.
const SCAN_TEMPLATE_ID = 'scan'
function scanSeedOpts() {
  return { settings: uctDefaultTabSettings(), scanTemplate: SCAN_TEMPLATE_ID }
}

/** Keys the scan window answers, unless focus is somewhere that owns typing:
 *  a text field, a select, or a chart (whose type-to-search takes letters). */
function scanKeyTarget(e) {
  const t = e.target
  if (!t || typeof t.closest !== 'function') return true
  if (t.isContentEditable) return false
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return false
  if (t.closest('[role="region"]')) return false
  return true
}

// The breadth cell drill — the Scan Deck.
//
// The overlay, header, rail and chart frame are owned here. The list and the
// chart(s) are still the REAL charts-workspace widgets (Watchlists in scan mode,
// ChartWidget) inside a complete WorkspaceContext — only their /charts header
// bar is hidden (`hosted`), because this window owns identity, layout and close.

export default function BreadthDrillModal({ drill, latestDate, onRetry, onClose, rows = null, drillCols = null, onNavigate = null }) {
  const { prefs, setPref } = usePreferences()
  // Same expression ChartsWorkspace uses, deliberately — not a near-equivalent.
  const chartsTheme = prefs?.charts_theme || 'default'

  // ── Board state, seeded from the stored pref ────────────────────────────────
  // Seeded ONCE per open. A later pref round-trip must not stomp the board the
  // user is currently dragging.
  // The app theme (Slate, Graphite, Light…). The chart and the list wear it
  // until the member changes their look themselves (see drillTheme.js).
  const appTheme = prefs?.theme ?? null
  const [board, setBoard] = useState(() => followAppTheme(
    parseBoard(prefs?.[DRILL_BOARD_PREF], scanSeedOpts()), appTheme, scanSeedOpts().settings))
  // Re-skin on an app-theme switch, and notice when the member takes over a
  // widget's look (followAppTheme marks it and stops following). Adjusted while
  // rendering, not in an effect: followAppTheme returns the same board once it
  // is settled, so this settles in one extra pass.
  const followed = followAppTheme(board, appTheme, scanSeedOpts().settings)
  if (followed !== board) setBoard(followed)
  // Once per open, before the list first reads its columns: % Chg, biggest first.
  useState(() => { resetDrillSort(); return null })
  // MVP trial withdrawal block (2026-09-30-mvp-preregistration-ravi.md; NOW-gate clause 4):
  // while TERMINAL_NEXT_ENABLED is off, a user TAGGED into the terminal-next cohort sees the
  // drill WITHOUT its chart. Members are never tagged, so they see it exactly as before.
  // ⛔ DISPLAY ONLY: `board` (the saved state, persisted below) keeps the chart, so switching
  // back on restores it untouched. Never write `shownBoard` anywhere.
  const withdrawn = (useContext(AuthContext)?.cohortsWithdrawn || []).includes('terminal-next')
  const shownBoard = useMemo(
    () => (withdrawn ? { ...board, widgets: board.widgets.filter((w) => w.id === LIST_WIDGET_ID) } : board),
    [board, withdrawn],
  )
  const onBoardChange = useCallback((fn) => {
    setBoard(prev => (typeof fn === 'function' ? fn(prev) : fn))
  }, [])

  // ── Pop-out ─────────────────────────────────────────────────────────────────
  // ⛔ NOT persisted: a popped window dies with its opener, so restoring a
  // "popped" flag on the next open would leave a widget that renders nowhere.
  // ── Phone: one pane at a time ───────────────────────────────────────────────
  const [mobilePane, setMobilePane] = useState('list')

  const [poppedIds, setPoppedIds] = useState([])
  const [popNotice, setPopNotice] = useState(null)
  const popOut = useCallback((id) => {
    setPoppedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [])
  const dock = useCallback((id) => {
    setPoppedIds(prev => prev.filter(x => x !== id))
  }, [])
  useEffect(() => {
    if (!popNotice) return
    const t = setTimeout(() => setPopNotice(null), 6000)
    return () => clearTimeout(t)
  }, [popNotice])

  // Debounced persist, mirroring the workspace's own 500ms layout save.
  const saveTimer = useRef(null)
  const boardRef = useRef(board)
  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setPref(DRILL_BOARD_PREF, serializeBoard(boardRef.current))
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [board, setPref])
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      setPref(DRILL_BOARD_PREF, serializeBoard(boardRef.current))
    }
  }, [setPref])

  // ── The workspace value ─────────────────────────────────────────────────────
  const widgetCanvasByType = useMemo(
    () => ({ chart: chartTypeCanvasEntry(prefs?.chart_settings, chartsTheme) }),
    [prefs?.chart_settings, chartsTheme],
  )
  // ONE canvas for the whole window: the chart's (its own settings when it has
  // them, else the member's /charts default). The list is given the same entry,
  // so list and chart read as one panel rather than two widgets side by side.
  const widgetCanvasById = useMemo(() => {
    const out = {}
    for (const w of board.widgets) {
      const entry = widgetOwnChrome(w, chartsTheme)
      if (entry) out[w.id] = entry
    }
    const chartEntry = out[CHART_WIDGET_ID] || widgetCanvasByType.chart
    if (chartEntry) out[LIST_WIDGET_ID] = chartEntry
    return out
  }, [board.widgets, chartsTheme, widgetCanvasByType])
  const drillCanvas = widgetCanvasById[CHART_WIDGET_ID]?.canvas || widgetCanvasByType.chart?.canvas || null

  const firstSym = drill?.items?.[0]?.t || null
  const baseWorkspace = useDrillWorkspace({
    initialSym: firstSym,
    chartsTheme,
    widgetCanvasByType,
    widgetCanvasById,
  })

  // On a PHONE, picking a row must show you the chart. Done by wrapping
  // setGroupSym: this is a USER ACTION. `matchMedia` is read at event time.
  const lastSymRef = useRef(null)
  // The selected stock, mirrored from colour group A at the ONE door every writer
  // uses (the list, the scan keys, the first-row seed). Read from here rather
  // than from the workspace value, which carries refs and must not be read
  // during render.
  const [pickedSym, setSelectedSym] = useState(null)
  const workspace = useMemo(() => ({
    ...baseWorkspace,
    setGroupSym: (color, sym) => {
      baseWorkspace.setGroupSym(color, sym)
      if (color !== 'A') return
      setSelectedSym(sym || null)
      const prev = lastSymRef.current
      lastSymRef.current = sym
      if (!prev || !sym || sym === prev) return
      try {
        if (window.matchMedia('(max-width: 640px)').matches) setMobilePane('chart')
      } catch { /* no matchMedia — stay put rather than guess */ }
    },
  }), [baseWorkspace])

  // ── The scan deck ───────────────────────────────────────────────────────────
  const deck = useScanDeck(drill)
  const order = useMemo(() => deck.shownRows.map(r => r.sym), [deck.shownRows])
  // The top of the list as it opens (sorted by % Chg, biggest gain first).
  const topSym = useMemo(() => {
    let best = null
    for (const r of deck.shownRows) {
      const p = Number.isFinite(r.pct) ? r.pct : -Infinity
      if (!best || p > best.p) best = { sym: r.sym, p }
    }
    return best?.sym || null
  }, [deck.shownRows])
  // Every new list (another day, another metric) opens on its top stock, never
  // on the name that happened to be picked in the last one.
  const listKey = `${drill?.label || ''}|${drill?.date || ''}|${drill?.live ? 'live' : ''}`
  const [pickListKey, setPickListKey] = useState(listKey)
  if (pickListKey !== listKey) { setPickListKey(listKey); setSelectedSym(null) }
  // A filter or a group pick can leave the pick on a name that is no longer
  // shown; the selection then falls back to the top stock.
  const selectedSym = pickedSym && order.includes(pickedSym) ? pickedSym : (topSym || order[0] || null)
  const selIdx = selectedSym ? order.indexOf(selectedSym) : -1

  // Keep the chart (colour group A) on the effective selection. Not via the
  // wrapped setter: a fallback is not a user pick, so it must not flip a phone to
  // the chart pane. setGroupSym bails on an unchanged value.
  const setSym = workspace.setGroupSym
  useEffect(() => {
    if (selectedSym) baseWorkspace.setGroupSym('A', selectedSym)
  }, [selectedSym, baseWorkspace])

  const { markSeen } = deck.review
  useEffect(() => { if (selectedSym && selIdx >= 0) markSeen(selectedSym) }, [selectedSym, selIdx, markSeen])

  const go = useCallback((delta) => {
    if (!order.length) return
    const from = selIdx < 0 ? (delta > 0 ? -1 : order.length) : selIdx
    const next = Math.max(0, Math.min(order.length - 1, from + delta))
    if (order[next] && order[next] !== selectedSym) setSym('A', order[next])
  }, [order, selIdx, selectedSym, setSym])

  const { toggle: toggleFlag } = useFlagged()
  const flagSelected = useCallback(() => { if (selectedSym) toggleFlag(selectedSym) }, [selectedSym, toggleFlag])
  const skipSelected = useCallback(() => {
    if (!selectedSym) return
    const wasSkipped = deck.review.skipped.has(selectedSym)
    deck.review.toggleSkip(selectedSym)
    if (!wasSkipped) go(1)
  }, [selectedSym, deck.review, go])

  // ── Mode + layout ───────────────────────────────────────────────────────────
  const mode = board.mode || 'focus'
  const setMode = useCallback((m) => {
    onBoardChange(b => ({ ...b, mode: m, split: MODE_SPLIT[m] ?? b.split }))
  }, [onBoardChange])

  // ── Day context + navigation ───────────────────────────────────────────────
  const colKey = drill?.colKey || null
  const drillDate = drill?.date || null
  const drillLive = !!drill?.live
  // The page holds only its own window (90 sessions), so the count chart's
  // 6M / 1Y ranges ask for a longer history, once, the first time one is picked.
  const [longRows, setLongRows] = useState(() => longHistoryCache.rows)
  const wantDays = useCallback(() => {
    if (longHistoryCache.rows) return
    loadLongHistory().then((r) => { if (r) setLongRows(r) })
  }, [])
  const ctxRows = useMemo(() => mergeHistory(rows, longRows), [rows, longRows])
  const ctx = useMemo(
    () => (colKey ? dayContext(ctxRows, colKey, drillDate, { live: drillLive, spark: 252 }) : null),
    [ctxRows, colKey, drillDate, drillLive],
  )
  const prevTarget = rows && onNavigate ? stepDate(rows, drillDate, drillLive, -1) : null
  const nextTarget = rows && onNavigate ? stepDate(rows, drillDate, drillLive, 1) : null
  const step = useCallback((dir) => {
    const t = dir < 0 ? prevTarget : nextTarget
    if (t && colKey) onNavigate?.({ colKey, ...t })
  }, [prevTarget, nextTarget, colKey, onNavigate])
  // The date box: the same control (and calendar) the chart widget and the
  // Monitor header use. A picked day snaps to the nearest session on or before
  // it; a picked year opens that year's last session.
  const settledDates = useMemo(() => (rows || []).filter(r => !r?._live && r?.date).map(r => r.date), [rows])
  const goDate = useCallback((iso) => {
    const hit = settledDates.find(d => d <= iso) || settledDates[settledDates.length - 1]
    if (hit && colKey) onNavigate?.({ colKey, date: hit, live: false })
  }, [settledDates, colKey, onNavigate])
  const goYear = useCallback((y) => goDate(`${y}-12-31`), [goDate])
  const dateNav = onNavigate && settledDates.length ? (
    <JoinedDateNav
      topDate={drillLive ? settledDates[0] : drillDate}
      minDate={settledDates[settledDates.length - 1]}
      maxDate={settledDates[0]}
      canForward={!!nextTarget}
      onStep={step}
      onPickDate={goDate}
      onPickYear={goYear}
    />
  ) : null
  const pickMetric = useCallback((key) => {
    onNavigate?.({ colKey: key, date: drillDate, live: drillLive })
  }, [onNavigate, drillDate, drillLive])

  // ── The drill payload ───────────────────────────────────────────────────────
  // The list gets the FILTERED items; loading/error read the raw drill, so a
  // filter that matches nothing is never mistaken for a list still loading.
  const source = useMemo(() => ({
    items: drill?.items ? deck.shownItems : [],
    label: drill?.label ?? '',
    date: drill?.date ?? null,
    live: !!drill?.live,
    asOf: drill?.asOf ?? null,
    latestDate: latestDate ?? null,
    loading: drill?.items == null && !drill?.error,
    error: drill?.error ?? null,
    onRetry: onRetry ?? null,
    groupMeta: deck.groupMeta,
    mode: board.mode || 'focus',
    // The Scan Deck owns grouping (Groups mode) and the count (masthead), so the
    // list drops its own List|Grouped bar and footer.
    deckHosted: true,
    // The scan filters (the list's title row draws them) and the full count, so
    // the footer can say "12 of 38".
    filters: deck.filters,
    total: drill?.items?.length ?? 0,
  }), [drill, latestDate, onRetry, deck.shownItems, deck.groupMeta, deck.filters, board.mode])

  // Escape closes — but NOT while a widget menu is open (its own Escape handler
  // runs first on `document`; see BreadthDrillModal.a11y.test.jsx).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (document.querySelector(WIDGET_MENU_SELECTOR)) return
      // The date box calendar closes itself on Escape; the window stays.
      if (document.querySelector('[role="dialog"][aria-label="Go to date"]')) return
      if (document.querySelector(`[${DRILL_POPOVER_ATTR}]`)) return
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Scan keys: J/K next/prev, F flag, X skip, [ ] previous/next session.
  // Plain letters only — Shift+F stays the watchlist's own flag key, and no
  // modifier combination is claimed. Ignored while focus is in a chart or a field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (!scanKeyTarget(e)) return
      const k = e.key
      if (k === 'j' || k === 'J') { e.preventDefault(); go(1) }
      else if (k === 'k' || k === 'K') { e.preventDefault(); go(-1) }
      else if (k === 'f') { e.preventDefault(); flagSelected() }
      else if (k === 'x') { e.preventDefault(); skipSelected() }
      else if (k === '[') { e.preventDefault(); step(-1) }
      else if (k === ']') { e.preventDefault(); step(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, flagSelected, skipSelected, step])

  // ── Focus ───────────────────────────────────────────────────────────────────
  const dialogRef = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus()
    }
  }, [])

  // Tab must not escape into the page behind the overlay.
  const onDialogKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const all = Array.from(root.querySelectorAll(FOCUSABLE))
    // jsdom reports offsetParent null for every element; fall back to the
    // unfiltered set rather than strand a keyboard user.
    const visible = all.filter(el => el.offsetParent !== null)
    const nodes = visible.length ? visible : all
    if (!nodes.length) { e.preventDefault(); root.focus(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const here = root.ownerDocument.activeElement
    if (e.shiftKey && (here === first || here === root)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus() }
  }, [])

  const total = drill?.items?.length ?? 0

  return (
    // ⛔ The dialog role belongs to the PANEL, not the backdrop.
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        style={drillCanvas ? { '--drill-canvas': drillCanvas } : undefined}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${source.label} constituents`}
        onKeyDown={onDialogKeyDown}
        onClick={e => e.stopPropagation()}
      >
        <ScanHeader
          label={source.label}
          count={drill?.items ? total : null}
          live={source.live}
          drillCols={drillCols}
          colKey={drill?.colKey}
          onPickMetric={onNavigate ? pickMetric : null}
          dateNav={dateNav}
          ctx={ctx}
          onWantDays={wantDays}
          summary={deck.summary}
          mode={mode}
          modes={SCAN_MODES}
          onMode={setMode}
          onClose={onClose}
        >
          <div className={styles.paneToggle} role="group" aria-label="Show list or chart">
            <button type="button" className={mobilePane === 'list' ? styles.paneOn : undefined}
              onClick={() => setMobilePane('list')} aria-pressed={mobilePane === 'list'}>List</button>
            <button type="button" className={mobilePane === 'chart' ? styles.paneOn : undefined}
              onClick={() => setMobilePane('chart')} aria-pressed={mobilePane === 'chart'}>Chart</button>
          </div>
        </ScanHeader>

        <div className={styles.panel}>
        {popNotice && <div className={styles.notice}>{popNotice}</div>}

        <WorkspaceContext.Provider value={workspace}>
          <DrillSourceContext.Provider value={source}>
            {mode === 'grid' ? (
              <ScanGrid
                rows={deck.shownRows}
                dir={deck.dir}
                // Clicking a card selects it (and points Focus at it) without leaving the grid.
                onSelect={(sym) => setSym('A', sym)}
                chartSettings={board.widgets.find(w => w.id === CHART_WIDGET_ID)?.opts?.settings || null}
                // The enlarged chart's settings gear (and its legend edits) write the
                // Focus chart's look, which every card draws with.
                onChartSettingsChange={(next) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === CHART_WIDGET_ID ? { ...x, opts: { ...x.opts, settings: next } } : x)) }))}
                toolbarStart={(
                  <>
                    <FilterButton filters={deck.filters} total={total} shown={deck.shownRows.length} />
                    <FilterChips filters={deck.filters} className={styles.gridChips} />
                  </>
                )}
              />
            ) : (
            <BreadthDrillBoard
              board={shownBoard}
              onBoardChange={onBoardChange}
              onPopOut={popOut}
              poppedIds={poppedIds}
              mobilePane={mobilePane}
              hosted
            />
            )}

            {/* Ejected widgets, rendered from the SAME board state inside the SAME
                providers so a popped list still drives the chart. */}
            {shownBoard.widgets.filter(w => poppedIds.includes(w.id)).map(w => (
              <PopoutWindow
                key={w.id}
                title={`UCT — ${w.id === LIST_WIDGET_ID ? source.label || 'Breadth' : 'Chart'}`}
                width={w.id === LIST_WIDGET_ID ? 620 : 1100}
                height={800}
                onClose={() => dock(w.id)}
                onBlocked={() => { dock(w.id); setPopNotice(POPUP_BLOCKED_MSG) }}
              >
                <PopoutShell theme={chartsTheme}>
                  <WidgetHost
                    widget={w}
                    onColorChange={(c) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === w.id ? { ...x, color: c } : x)) }))}
                    onOptsChange={(opts) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === w.id ? { ...x, opts } : x)) }))}
                    onReplaceWidget={(id, next) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === id ? next : x)) }))}
                    onDock={() => dock(w.id)}
                    floating
                  />
                </PopoutShell>
              </PopoutWindow>
            ))}
          </DrillSourceContext.Provider>
        </WorkspaceContext.Provider>
        </div>
      </div>
    </div>
  )
}
