import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { widgetOwnChrome, chartTypeCanvasEntry } from '../../charts/widgetChrome'
import WidgetHost from '../../charts/WidgetHost'
import { ChartHostOverlayContext } from '../../charts/widgets/chartHostOverlay'
import MobileChartsApp from '../../charts/mobile/MobileChartsApp'
import useDrillWorkspace from '../../breadth/drill/drillWorkspace'
import styles from './FocusScreener.module.css'
import {
  SCREENER_CHART_GROUP, SCREENER_CHART_PREF, parseScreenerWidgets, serializeChartWidget,
} from './screenerChartPrefs'

// ⭐ THE SCREENER'S CHART IS THE /charts CHART WIDGET (owner, 2026-10-18: "full 100% chart parity
// in the screener so it's just a tool to access the same stuff in the same format").
//
// Not a second chart with features switched off: the real ChartWidget under WidgetHost, inside a
// workspace host built exactly like the breadth drill's (useDrillWorkspace: "one component, many
// hosts"). Every timeframe, drawing tool, indicator, chart tab, hotkey, compare, replay, settings
// gear and theme is the one /charts has, and any change to that widget reaches the screener.
//
// The selected row drives colour group A, as a watchlist drives a chart on /charts. The one thing
// the screener adds is the row's setup pivot, through ChartHostOverlayContext.
//
// On a PHONE (`phone`, the Focus phone sheet) it is the /charts PHONE chart instead: /charts does not
// show the desktop widget on a phone either, it shows MobileChartsApp (symbol strip, clean canvas,
// bottom toolbar, indicator / type / alert / tools sheets), bound to the same chart widget.
const noop = () => {}
export default function ScreenerChartWidget({ sym, priceLines = null, phone = false }) {
  const { prefs, setPrefMerged, loading } = usePreferences()
  const chartsTheme = prefs?.charts_theme || 'default'
  // The member's own /charts chart (named default chart widget, else the first with settings,
  // else the chart_settings seed): what a member who has never opened this chart starts from.
  const { ownChartSource } = useChartSurfaceSettings()
  const seedOf = (p, own) => parseScreenerWidgets(p?.[SCREENER_CHART_PREF], own ? { settings: own } : {})
  // [chart, ...extras]: the chart, plus any widget the phone chart's toolbar added.
  const [board, setBoard] = useState(() => seedOf(prefs, ownChartSource))
  const widget = board[0]

  const widgetCanvasById = useMemo(() => {
    const entry = widgetOwnChrome(widget, chartsTheme)
    return entry ? { [widget.id]: entry } : {}
  }, [widget, chartsTheme])
  const widgetCanvasByType = useMemo(
    () => ({ chart: chartTypeCanvasEntry(prefs?.chart_settings, chartsTheme) }),
    [prefs?.chart_settings, chartsTheme],
  )
  const workspace = useDrillWorkspace({ initialSym: sym, chartsTheme, widgetCanvasByType, widgetCanvasById })

  // Selection → colour group A. A ticker the member types into the chart's own search moves the
  // chart (as on /charts); the next row selection takes it back.
  const { setGroupSym } = workspace
  useEffect(() => { if (sym) setGroupSym(SCREENER_CHART_GROUP, sym) }, [sym, setGroupSym])

  const overlay = useMemo(
    () => ({
      priceLinesFor: (shown) => (shown && shown === sym && priceLines?.length ? priceLines : null),
      // No pause on a step: the rows on screen are warm in memory (prewarmVisibleList), so the
      // /charts 90 ms scan debounce would only add latency to every ↑/↓ here.
      symbolDebounceMs: 0,
    }),
    [sym, priceLines],
  )

  const onOptsChange = useCallback((opts) => setBoard(b => [{ ...b[0], opts }, ...b.slice(1)]), [])
  // The slot is the screener's chart: a header action that swaps the widget keeps it a chart and
  // keeps only what this host persists (its opts).
  const onReplaceWidget = useCallback((_id, next) => {
    if (next?.type === 'chart' && next.opts) setBoard(b => [{ ...b[0], opts: next.opts }, ...b.slice(1)])
  }, [])

  // Debounced persist, mirroring the workspace's 500 ms layout save; nothing is written until the
  // member changes something, and the last change is flushed on unmount.
  const saveTimer = useRef(null)
  const boardRef = useRef(board)
  const dirty = useRef(false)
  // A structured value goes through setPrefMerged, not the plain whole-value write (see the
  // usePreferences.additionsOnly rail): the write lands on the freshest cached preferences, so another tab's save is not
  // overwritten from a stale snapshot. The key is a literal so the rail can see it.
  const save = useCallback(() => setPrefMerged('screener_chart_widget',
    () => serializeChartWidget(boardRef.current[0], boardRef.current.slice(1))), [setPrefMerged])
  useEffect(() => {
    if (boardRef.current === board) return undefined
    boardRef.current = board
    dirty.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { dirty.current = false; save() }, 500)
    return undefined
  }, [board, save])
  // Mounted before the preferences answered (a cold page load): seed once more from them, unless
  // the member has already changed something here. Set through boardRef so it is not a save.
  const seededLoaded = useRef(!loading)
  useEffect(() => {
    if (seededLoaded.current || loading) return
    seededLoaded.current = true
    if (dirty.current) return
    const next = seedOf(prefs, ownChartSource)
    boardRef.current = next
    // Once per mount, when an external store (the preferences) answers: the documented
    // "synchronise with an external system" case, not a render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoard(next)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    clearTimeout(saveTimer.current)
    if (dirty.current) save()
  }, [save])

  // The phone shell's widget doors, as /charts wires them: ★ adds a watchlist and opens it as a
  // page over the chart, Tools ▸ add opens what was added, a page's trash removes it.
  const onPhoneOptsChange = useCallback((id, opts) => setBoard(b => b.map(w => (w.id === id ? { ...w, opts } : w))), [])
  const onAddWidget = useCallback((type) => {
    if (!type || type === 'chart') return
    setBoard(b => (b.length > 12 ? b : [...b, { id: `screener-${type}-${Date.now().toString(36)}`, type, color: SCREENER_CHART_GROUP, opts: {} }]))
  }, [])
  const onRemoveWidget = useCallback((id) => setBoard(b => (id === b[0].id ? b : b.filter(w => w.id !== id))), [])
  return (
    <WorkspaceContext.Provider value={workspace}>
      <ChartHostOverlayContext.Provider value={overlay}>
        {phone ? (
          <div className={styles.phoneChartHost}>
            <MobileChartsApp widgets={board} onOptsChange={onPhoneOptsChange}
              onColorChange={noop} onRemove={onRemoveWidget} onAddWidget={onAddWidget} />
          </div>
        ) : (
          <WidgetHost widget={widget} onOptsChange={onOptsChange} onReplaceWidget={onReplaceWidget}
            onColorChange={noop} />
        )}
      </ChartHostOverlayContext.Provider>
    </WorkspaceContext.Provider>
  )
}
