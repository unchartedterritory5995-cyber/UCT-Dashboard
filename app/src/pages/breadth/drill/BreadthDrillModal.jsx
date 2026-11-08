import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from '../../../context/AuthContext'
import usePreferences from '../../../hooks/usePreferences'
import { useFlagged } from '../../../hooks/useFlagged'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { widgetOwnChrome, chartTypeCanvasEntry } from '../../charts/widgetChrome'
import { uctDefaultTabSettings } from '../../charts/chartTabs'
import { chartTemplateSettings } from '../../../components/chart/chartTemplateApply'
import useDrillWorkspace from './drillWorkspace'
import { DrillSourceContext } from './DrillSourceContext'
import BreadthDrillBoard from './BreadthDrillBoard'
import PopoutWindow from '../../charts/popout/PopoutWindow'
import PopoutShell from '../../charts/popout/PopoutShell'
import WidgetHost from '../../charts/WidgetHost'
import {
  DRILL_BOARD_PREF, LIST_WIDGET_ID, CHART_WIDGET_ID, MODE_SPLIT, SCAN_MODES, SCAN_LAYOUTS,
  parseBoard, serializeBoard,
} from './drillBoardPrefs'
import WhatElseOpenPrompt from '../../../components/instruments/WhatElseOpenPrompt'
import useScanDeck from './scan/useScanDeck'
import useDayFacts from './scan/useDayFacts'
import { dayContext, stepDate } from './scan/scanDeckModel'
import { ScanHeader, ScanRail, ScanStage } from './scan/ScanDeckParts'
import styles from './BreadthDrillModal.module.css'

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
const GLOBAL_TEMPLATE_ID = 'global'
function scanSeedOpts() {
  return { settings: uctDefaultTabSettings(), scanTemplate: SCAN_TEMPLATE_ID }
}

// Colour groups for the 4-up layout: A is the selected stock (the list's group),
// B–D are the next three names in the list.
const FOUR_UP = ['B', 'C', 'D']

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

function daysUntil(iso, from) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const f = /^(\d{4})-(\d{2})-(\d{2})/.exec(from || '')
  const b = f ? Date.UTC(+f[1], +f[2] - 1, +f[3]) : Date.now()
  return Math.round((a - b) / 86400000)
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
  const [board, setBoard] = useState(() => parseBoard(prefs?.[DRILL_BOARD_PREF], scanSeedOpts()))
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
  const widgetCanvasById = useMemo(() => {
    const out = {}
    for (const w of board.widgets) {
      const entry = widgetOwnChrome(w, chartsTheme)
      if (entry) out[w.id] = entry
    }
    return out
  }, [board.widgets, chartsTheme])
  const widgetCanvasByType = useMemo(
    () => ({ chart: chartTypeCanvasEntry(prefs?.chart_settings, chartsTheme) }),
    [prefs?.chart_settings, chartsTheme],
  )

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
  const [pickedSym, setSelectedSym] = useState(firstSym)
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
  // A filter, a group pick or a new list can leave the pick on a name that is no
  // longer shown; the selection then falls to the first shown name.
  const selectedSym = pickedSym && order.includes(pickedSym) ? pickedSym : (order[0] || null)
  const selIdx = selectedSym ? order.indexOf(selectedSym) : -1
  const selectedRow = selectedSym ? deck.rowBySym[selectedSym] || null : null

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

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const flagSelected = useCallback(() => { if (selectedSym) toggleFlag(selectedSym) }, [selectedSym, toggleFlag])
  const skipSelected = useCallback(() => {
    if (!selectedSym) return
    const wasSkipped = deck.review.skipped.has(selectedSym)
    deck.review.toggleSkip(selectedSym)
    if (!wasSkipped) go(1)
  }, [selectedSym, deck.review, go])

  // ── Mode + layout ───────────────────────────────────────────────────────────
  const mode = board.mode || 'scan'
  const layout = board.layout || '1'
  const setMode = useCallback((m) => {
    onBoardChange(b => ({ ...b, mode: m, split: MODE_SPLIT[m] ?? b.split }))
  }, [onBoardChange])
  const setLayout = useCallback((l) => onBoardChange(b => ({ ...b, layout: l })), [onBoardChange])

  // 4-up: publish the next three names into colour groups B–D.
  useEffect(() => {
    if (layout !== '4' || !order.length) return
    const base = Math.max(0, selIdx)
    // setGroupSym bails on an unchanged value, so re-running this is free.
    FOUR_UP.forEach((c, i) => {
      const s = order[(base + i + 1) % order.length]
      if (s) baseWorkspace.setGroupSym(c, s)
    })
  }, [layout, order, selIdx, baseWorkspace])

  // ── Chart template ──────────────────────────────────────────────────────────
  const chartWidget = board.widgets.find(w => w.id === CHART_WIDGET_ID)
  const savedTemplates = useMemo(() => {
    let arr = prefs?.chart_templates
    if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { arr = [] } }
    return Array.isArray(arr) ? arr.filter(t => t && t.name && t.settings) : []
  }, [prefs?.chart_templates])
  const templates = useMemo(() => [
    { id: SCAN_TEMPLATE_ID, label: 'Breadth Scan (built-in)' },
    { id: GLOBAL_TEMPLATE_ID, label: 'My /charts settings' },
    ...savedTemplates.map(t => ({ id: `t:${t.id || t.name}`, label: t.name, tpl: t })),
  ], [savedTemplates])
  const templateId = chartWidget?.opts?.scanTemplate && templates.some(t => t.id === chartWidget.opts.scanTemplate)
    ? chartWidget.opts.scanTemplate
    : (chartWidget?.opts?.settings ? SCAN_TEMPLATE_ID : GLOBAL_TEMPLATE_ID)
  const applyTemplate = useCallback((id) => {
    const t = templates.find(x => x.id === id)
    if (!t) return
    const settings = id === SCAN_TEMPLATE_ID ? uctDefaultTabSettings()
      : id === GLOBAL_TEMPLATE_ID ? null
        : chartTemplateSettings(t.tpl)
    onBoardChange(b => ({
      ...b,
      widgets: b.widgets.map(w => (w.id === CHART_WIDGET_ID ? { ...w, opts: { ...w.opts, settings, scanTemplate: id } } : w)),
    }))
  }, [templates, onBoardChange])

  // Extra chart cells share the main chart's look; their own edits live for this
  // open only (the main chart is the one the board remembers).
  const [extraOpts, setExtraOpts] = useState({})
  const extraWidgets = useMemo(() => {
    if (!chartWidget || withdrawn) return []
    const baseOpts = { ...chartWidget.opts }
    if (layout === 'dw') {
      return [{ id: 'drill-chart-w', type: 'chart', color: 'A', opts: extraOpts['drill-chart-w'] || { ...baseOpts, tf: 'W' } }]
    }
    if (layout === '4') {
      return FOUR_UP.map(c => {
        const id = `drill-chart-${c}`
        return { id, type: 'chart', color: c, opts: extraOpts[id] || baseOpts }
      })
    }
    return []
  }, [chartWidget, layout, extraOpts, withdrawn])
  const extraCells = extraWidgets.map(w => (
    <WidgetHost
      key={w.id}
      widget={w}
      merged
      onOptsChange={(opts) => setExtraOpts(p => ({ ...p, [w.id]: opts }))}
      onReplaceWidget={(id, next) => setExtraOpts(p => ({ ...p, [id]: next.opts }))}
    />
  ))

  // ── Day context + navigation ───────────────────────────────────────────────
  const colKey = drill?.colKey || null
  const drillDate = drill?.date || null
  const drillLive = !!drill?.live
  const ctx = useMemo(
    () => (colKey ? dayContext(rows, colKey, drillDate, { live: drillLive }) : null),
    [rows, colKey, drillDate, drillLive],
  )
  const prevTarget = rows && onNavigate ? stepDate(rows, drillDate, drillLive, -1) : null
  const nextTarget = rows && onNavigate ? stepDate(rows, drillDate, drillLive, 1) : null
  const step = useCallback((dir) => {
    const t = dir < 0 ? prevTarget : nextTarget
    if (t && colKey) onNavigate?.({ colKey, ...t })
  }, [prevTarget, nextTarget, colKey, onNavigate])
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
    mode: board.mode || 'scan',
  }), [drill, latestDate, onRetry, deck.shownItems, deck.groupMeta, board.mode])

  // Escape closes — but NOT while a widget menu is open (its own Escape handler
  // runs first on `document`; see BreadthDrillModal.a11y.test.jsx).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (document.querySelector(WIDGET_MENU_SELECTOR)) return
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
  const facts = useDayFacts(selectedSym, drill?.live ? null : drill?.date)
  const colLabelByDrillKey = useMemo(
    () => Object.fromEntries((drillCols || []).map(c => [c.drillKey, c.label])),
    [drillCols],
  )
  const alsoLabels = useMemo(
    () => (selectedRow?.also || []).map(k => colLabelByDrillKey[k]).filter(Boolean),
    [selectedRow, colLabelByDrillKey],
  )
  const earnDays = selectedRow?.nextEarnings ? daysUntil(selectedRow.nextEarnings, drill?.live ? null : drill?.date) : null
  const earningsSoon = earnDays != null && earnDays >= 0 && earnDays <= 5
    ? (earnDays === 0 ? 'TODAY' : `IN ${earnDays}D`) : null

  const wrapChartPane = useCallback((node) => (
    <ScanStage
      layout={layout} onLayout={setLayout} layouts={SCAN_LAYOUTS}
      templates={templates} templateId={templateId} onTemplate={applyTemplate}
      extraCells={extraCells}
      row={selectedRow} facts={facts} alsoLabels={alsoLabels} earningsSoon={earningsSoon}
      flagged={selectedSym ? isFlagged(selectedSym) : false} onFlag={flagSelected}
      skipped={selectedSym ? deck.review.skipped.has(selectedSym) : false} onSkip={skipSelected}
      onPrev={() => go(-1)} onNext={() => go(1)}
      canPrev={selIdx > 0} canNext={order.length > 0 && selIdx < order.length - 1}
      reviewed={deck.review.count} total={total} onResetReview={deck.review.reset}
    >{node}</ScanStage>
  ), [layout, setLayout, templates, templateId, applyTemplate, extraCells, selectedRow, facts, alsoLabels,
    earningsSoon, selectedSym, isFlagged, flagSelected, deck.review, skipSelected, go, selIdx, order.length, total])

  return (
    // ⛔ The dialog role belongs to the PANEL, not the backdrop.
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
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
          date={source.date}
          live={source.live}
          drillCols={drillCols}
          colKey={drill?.colKey}
          onPickMetric={onNavigate ? pickMetric : null}
          onStep={onNavigate ? step : null}
          canPrev={!!prevTarget}
          canNext={!!nextTarget}
          ctx={ctx}
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

        {popNotice && <div className={styles.notice}>{popNotice}</div>}

        {/* TERM-093 instrument: admins only, renders nothing while its flag is unset. */}
        <WhatElseOpenPrompt occasion="wf_c13_breadth_drill" />

        <WorkspaceContext.Provider value={workspace}>
          <DrillSourceContext.Provider value={source}>
            <BreadthDrillBoard
              board={shownBoard}
              onBoardChange={onBoardChange}
              onPopOut={popOut}
              poppedIds={poppedIds}
              mobilePane={mobilePane}
              hosted
              listTop={drill?.items?.length ? <ScanRail deck={deck} mode={mode} total={total} /> : null}
              wrapChartPane={wrapChartPane}
            />

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
  )
}
