import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChartPane from '../../../components/chart/pane/ChartPane'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import WidgetHost from '../WidgetHost'
import { useWorkspace } from '../WorkspaceContext'
import UIcon from '../../../components/ui/UIcon'
import { labelMap } from '../../../widgets/registry'
import MobileSymbolStrip from './MobileSymbolStrip'
import MobileChartToolbar from './MobileChartToolbar'
import MobileSymbolSheet from './MobileSymbolSheet'
import MobileTfSheet from './MobileTfSheet'
import MobileChartTypeSheet from './MobileChartTypeSheet'
import MobileIndicatorSheet from './MobileIndicatorSheet'
import MobileAlertSheet from './MobileAlertSheet'
import MobileMoreSheet from './MobileMoreSheet'
import { pushRecent } from './mobileRecents'
import wsStyles from '../ChartsWorkspace.module.css'
import styles from './MobileCharts.module.css'

const MENU_LABEL = labelMap('menu')

/** Index of the chart this shell binds: the FIRST chart widget of the saved
 *  layout, or -1 when the layout has none. Exported so the landing rail can
 *  test the rule itself (ported from MobileWorkspace's defaultActiveIndex —
 *  same hydration discipline: DERIVED every render, never a state initializer,
 *  because `widgets` arrives EMPTY on first render and only lands once
 *  usePreferences resolves). */
export function chartWidgetIndex(widgets) {
  return (widgets || []).findIndex((w) => w.type === 'chart')
}

/* MobileChartsApp — the phone /charts experience (≤640px).
 *
 * TradingView-mobile shape: a full-bleed chart between a tappable symbol strip
 * and a thumb-zone toolbar, with every picker a bottom sheet. It is a VIEW over
 * the same saved workspace the desktop grid edits: the first chart widget's
 * tf/settings are read and written through the same onOptsChange, tickers ride
 * the widget's color group, and chartId = widget.id (WidgetHost's main-tab
 * groupId) so alert scoping agrees across devices. Non-chart widgets open as
 * full-screen pages OVER the chart (it never unmounts — returning is free).
 *
 * The chart is ChartPane composed DIRECTLY (density="mini" + showTfBar={false}
 * = candles only) — the GridChartCell precedent: never ChartWidget, which is
 * desktop workspace chrome.
 */
/* `tablet` (ChartsWorkspace's coarse-pointer 641–1024px branch): the same
 * shell in TWO PANES — chart column + a DOCKED companion panel where the
 * phone shows a full-screen page. Same state, same handlers; only the
 * presentation and the tap-to-chart rule change (a docked panel never covers
 * the chart, so it stays open while the chart retargets beside it). */
export default function MobileChartsApp({ widgets, onRemove, onColorChange, onOptsChange, onAddWidget, tablet = false }) {
  const { groupSyms, setGroupSym, chartsTheme } = useWorkspace()

  // null | 'symbol' | 'tf' | 'type' | 'indicators' | 'alert' | 'more'
  const [sheet, setSheet] = useState(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  // A non-chart widget opened as a full-screen page. Stored WITH the chart's
  // symbol at open time ({id, symAtOpen}) so the tap-to-chart loop below can
  // tell "this page retargeted the chart" from "nothing happened". Keyed by id,
  // so a layout change can never re-point the page at a different widget.
  const [screen, setScreen] = useState(null)
  // The toolbar's ★ tapped with no watchlist widget in the layout: one is
  // added, and this flag opens it the moment it lands in `widgets` (the add is
  // async through the layout save path, so the id isn't knowable at tap time).
  const [pendingWatchlistOpen, setPendingWatchlistOpen] = useState(false)

  const paneRef = useRef(null)
  // Filled by StockChart with the mounted ChartToolbar's imperative API — the
  // door the ƒx sheet uses to open the real IndicatorLibraryDialog.
  const toolbarApiRef = useRef(null)

  // The global FABs (voice orb bottom-right, feedback "?" bottom-left) anchor
  // just above the tab bar — exactly where the chart toolbar now lives. Stamp
  // the root while this shell is mounted so their CSS steps them up over it
  // (FloatingOrb.module.css / FeedbackWidget.module.css read this attribute).
  useEffect(() => {
    document.documentElement.setAttribute('data-mobile-chart-shell', '1')
    return () => document.documentElement.removeAttribute('data-mobile-chart-shell')
  }, [])

  const chartIdx = chartWidgetIndex(widgets)
  const chartWidget = chartIdx >= 0 ? widgets[chartIdx] : null
  const otherWidgets = useMemo(() => (widgets || []).filter((w) => w.type !== 'chart'), [widgets])
  const screenWidget = screen ? (widgets || []).find((w) => w.id === screen.id) : null

  const color = chartWidget?.color || 'A'
  const sym = groupSyms[color] || 'SPY'

  // Every page-open records the chart's symbol at that moment.
  const openWidgetScreen = useCallback((id) => {
    setScreen({ id, symAtOpen: groupSyms[chartWidget?.color || 'A'] || 'SPY' })
  }, [groupSyms, chartWidget?.color])

  // ⭐ THE TAP-TO-CHART LOOP (TradingView's watchlist behavior). A page that
  // shares the chart's color group retargets the chart when a row is tapped —
  // so the moment the chart's symbol moves while a page is open, return to the
  // chart to show it. A page on a DIFFERENT color group never moves the
  // chart's symbol, so it stays open — correct by construction, no widget-type
  // list to maintain. (Render-time state adjustment, same pattern as the
  // pending-watchlist open below.)
  if (!tablet && screen && sym !== screen.symAtOpen) {
    setScreen(null)
  }

  // Tablet lands with the companion panel already useful: the first watchlist
  // widget docks itself once the layout hydrates (once — closing it sticks).
  // Same render-time adjustment pattern as the rules above.
  const [panelAutoOpened, setPanelAutoOpened] = useState(false)
  const firstWatchlist = (widgets || []).find((w) => w.type === 'watchlist')
  if (tablet && !panelAutoOpened && firstWatchlist && screen === null) {
    setPanelAutoOpened(true)
    setScreen({ id: firstWatchlist.id, symAtOpen: sym })
  }
  const tf = chartWidget?.opts?.tf || 'D'
  const opts = chartWidget?.opts || null

  // Settings ride the SAME per-widget blob the desktop main tab edits.
  const stored = opts?.settings || null
  const handleStore = useCallback((next) => {
    if (!chartWidget) return
    onOptsChange(chartWidget.id, { ...(chartWidget.opts || {}), settings: next })
  }, [chartWidget, onOptsChange])
  // Resolved settings for the sheets (chart type, MA slots). Same memoized
  // resolution ChartPane runs internally — the duplicate call costs nothing.
  const { cs, write } = useChartSurfaceSettings({ stored, onStore: handleStore, chartsTheme })

  const handleTf = useCallback((code) => {
    if (!chartWidget || code === tf) return
    onOptsChange(chartWidget.id, { ...(chartWidget.opts || {}), tf: code })
  }, [chartWidget, tf, onOptsChange])

  const handleSymbolPick = useCallback((s) => {
    const raw = String(s || '').trim()
    if (!raw) return
    // Theme-index pseudo-tickers ("$IDX:<slug>") carry a lowercase slug —
    // uppercase only real symbols. (pushRecent refuses synthetics itself.)
    const t = raw.startsWith('$') ? raw : raw.toUpperCase()
    setGroupSym(color, t)
    pushRecent(t)
    setSheet(null)
  }, [color, setGroupSym])

  const openSettings = useCallback(() => paneRef.current?.openSettings(), [])
  const browseLibrary = useCallback(() => { toolbarApiRef.current?.openIndicatorLibrary?.() }, [])

  // Toolbar ƒx badge: how many MA overlay slots are live (the same `enabled`
  // flag MobileIndicatorSheet toggles) — chart state visible without opening
  // the sheet.
  const indicatorCount = useMemo(
    () => (Array.isArray(cs?.overlays) ? cs.overlays.filter((o) => o?.enabled).length : 0),
    [cs],
  )

  // Share chart image — TradingView's camera button, through the native iOS
  // share sheet (navigator.share with a file). The PNG comes from the SAME
  // takeScreenshot() recipe the desktop "Save to Notebook" uses, via the
  // toolbarApi bridge. Fallback where file-share is unsupported: a plain
  // download. A cancelled share sheet rejects with AbortError — swallowed.
  const handleShareSnapshot = useCallback(async () => {
    try {
      const blob = await toolbarApiRef.current?.getSnapshotBlob?.()
      if (!blob) return
      const file = new File([blob], `${sym}-${tf}.png`, { type: 'image/png' })
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { /* share cancelled / chart not ready — nothing to clean up */ }
  }, [sym, tf])

  // ★ Watchlist — the scan→tap→chart loop, one tap from the chart. Opens the
  // layout's first watchlist widget; with none saved, adds one and opens it as
  // soon as it hydrates into `widgets`.
  const watchlistWidget = useMemo(() => (widgets || []).find((w) => w.type === 'watchlist'), [widgets])
  const handleOpenWatchlist = useCallback(() => {
    if (watchlistWidget) { openWidgetScreen(watchlistWidget.id); return }
    setPendingWatchlistOpen(true)
    onAddWidget('watchlist')
  }, [watchlistWidget, onAddWidget, openWidgetScreen])
  // Render-time state adjustment (the you-might-not-need-an-effect pattern):
  // the moment the added watchlist hydrates into `widgets`, consume the pending
  // flag and open it — React re-renders before committing, no effect pass.
  if (pendingWatchlistOpen && watchlistWidget) {
    setPendingWatchlistOpen(false)
    setScreen({ id: watchlistWidget.id, symAtOpen: sym })
  }

  // Add-widget from the Tools sheet opens what you just added — the same
  // pending pattern, generalized: remember how many of that type existed at
  // tap time, and when a NEW one hydrates, open it as a page. (Adding a chart
  // is exempt: the shell binds the first chart; a page would be a mirror.)
  const [pendingAdd, setPendingAdd] = useState(null) // {type, count} at tap time
  const handleAddFromSheet = useCallback((t) => {
    if (t !== 'chart') {
      setPendingAdd({ type: t, count: (widgets || []).filter((w) => w.type === t).length })
    }
    onAddWidget(t)
  }, [widgets, onAddWidget])
  if (pendingAdd) {
    const ofType = (widgets || []).filter((w) => w.type === pendingAdd.type)
    if (ofType.length > pendingAdd.count) {
      setPendingAdd(null)
      setScreen({ id: ofType[ofType.length - 1].id, symAtOpen: sym })
    }
  }

  const stockChartProps = useMemo(() => ({
    chartId: chartWidget?.id || null,
    toolbarApiRef,
    // Clean canvas by default on phone: the drawing toolbar starts collapsed
    // (chevron to expand) unless this browser has explicitly chosen otherwise.
    toolbarDefaultCollapsed: true,
    // The » back-to-live chip when panned into history (phone/tablet only).
    showGoLive: true,
    // Phase 10 — the clean canvas. ChartPane force-enables these for the
    // desktop workspace; the spread order lets the shell take them back:
    // the symbol strip already shows the live price, so the legend becomes
    // what it is on TradingView mobile — a crosshair INSPECTION tool, not
    // permanent furniture — and the TC2000 range bar stays desktop (the TF
    // sheet owns timeframes here).
    verticalLegend: false,
    alwaysShowLegend: false,
    showRangeSelector: false,
  }), [chartWidget?.id])

  // The widget page's shared pieces (used by BOTH presentations):
  // phone = full-screen overlay with a back button; tablet = docked panel with
  // a close ✕. Same WidgetHost mount either way — `merged` keeps the desktop
  // drag/close bar (with its accidental-remove ✕) off touch; removal is the
  // deliberate trash button in the header.
  const pageBody = screenWidget && (
    <div className={styles.screenBody}>
      <WidgetHost
        key={screenWidget.id}
        widget={screenWidget}
        merged
        onRemove={() => { onRemove(screenWidget.id); setScreen(null) }}
        onColorChange={(c) => onColorChange(screenWidget.id, c)}
        onOptsChange={(o) => onOptsChange(screenWidget.id, o)}
      />
    </div>
  )
  const pageTrash = screenWidget && (
    <button
      type="button"
      className={styles.screenAction}
      aria-label={`Remove ${MENU_LABEL[screenWidget.type] || screenWidget.type} from layout`}
      onClick={() => { onRemove(screenWidget.id); setScreen(null) }}
    >
      <UIcon name="trash" size={16} gold={false} />
    </button>
  )

  return (
    <div
      className={`${wsStyles.mobileWorkspace} ${styles.shell} ${tablet ? styles.tabletShell : ''}`}
      data-testid="mobile-charts-app"
      data-shell-mode={tablet ? 'tablet' : 'phone'}
      data-charts-theme={chartsTheme}
    >
      {chartWidget ? (
        <>
          <div className={styles.chartCol}>
          <MobileSymbolStrip sym={sym} onOpenSearch={() => setSheet('symbol')} />
          <div className={styles.chartArea}>
            <div className={styles.paneWrap}>
              <ChartPane
                ref={paneRef}
                sym={sym}
                tf={tf}
                onSymbolChange={handleSymbolPick}
                onTfChange={handleTf}
                density="mini"
                showTfBar={false}
                stored={stored}
                onStore={handleStore}
                chartId={chartWidget.id}
                chartsTheme={chartsTheme}
                stockChartProps={stockChartProps}
              />
            </div>

            {/* Phone: the widget page is a full-screen overlay OVER the chart
                (it never unmounts — returning is instant). */}
            {!tablet && screenWidget && (
              <div className={styles.widgetScreen}>
                <div className={styles.screenHeader}>
                  <button type="button" className={styles.screenBack} onClick={() => setScreen(null)}>
                    <UIcon name="chevronRight" size={15} gold={false} style={{ transform: 'rotate(180deg)' }} />
                    Chart
                  </button>
                  <span className={styles.screenTitle}>{MENU_LABEL[screenWidget.type] || screenWidget.type}</span>
                  {pageTrash}
                </div>
                {pageBody}
              </div>
            )}
          </div>
          <MobileChartToolbar
            tf={tf}
            onOpenTf={() => setSheet('tf')}
            onOpenType={() => setSheet('type')}
            onOpenIndicators={() => setSheet('indicators')}
            onOpenWatchlist={handleOpenWatchlist}
            onOpenMore={() => setSheet('more')}
            indicatorCount={indicatorCount}
          />
          </div>

          {/* Tablet: the same page DOCKS beside the chart — TradingView-iPad
              style. Tapping a watchlist row retargets the chart NEXT TO it
              (the tap-to-chart bounce is phone-only; nothing here covers the
              chart). ✕ closes the panel; ★ or the Tools sheet reopens it. */}
          {tablet && screenWidget && (
            <aside className={styles.sidePanel} aria-label={MENU_LABEL[screenWidget.type] || screenWidget.type}>
              <div className={styles.screenHeader}>
                <span className={styles.panelTitle}>{MENU_LABEL[screenWidget.type] || screenWidget.type}</span>
                {pageTrash}
                <button
                  type="button"
                  className={styles.screenAction}
                  aria-label="Close panel"
                  onClick={() => setScreen(null)}
                >
                  <UIcon name="x" size={15} gold={false} />
                </button>
              </div>
              {pageBody}
            </aside>
          )}
        </>
      ) : (
        /* The saved layout has no chart widget (the user removed it on desktop).
           One tap restores one; the rest of the layout is reachable via More
           once a chart exists. */
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No chart in this layout yet.</div>
          <button type="button" className={styles.emptyBtn} onClick={() => onAddWidget('chart')}>
            Open a chart
          </button>
        </div>
      )}

      <MobileSymbolSheet open={sheet === 'symbol'} onClose={closeSheet} onPick={handleSymbolPick} />
      <MobileTfSheet
        open={sheet === 'tf'}
        onClose={closeSheet}
        tf={tf}
        onTf={handleTf}
        customTfs={Array.isArray(cs?.header?.customTimeframes) ? cs.header.customTimeframes : []}
      />
      <MobileChartTypeSheet
        open={sheet === 'type'}
        onClose={closeSheet}
        chartType={cs?.chartType || 'candles'}
        onPick={(t) => write({ ...cs, chartType: t, preset: 'custom' })}
      />
      <MobileIndicatorSheet
        open={sheet === 'indicators'}
        onClose={closeSheet}
        cs={cs}
        onWrite={write}
        onBrowseLibrary={browseLibrary}
        onOpenSettings={openSettings}
      />
      <MobileAlertSheet open={sheet === 'alert'} onClose={closeSheet} sym={sym} />
      <MobileMoreSheet
        open={sheet === 'more'}
        onClose={closeSheet}
        sym={sym}
        widgets={otherWidgets}
        onOpenWidget={openWidgetScreen}
        onAddWidget={handleAddFromSheet}
        onOpenSettings={openSettings}
        onSetAlert={() => setSheet('alert')}
        onShareSnapshot={handleShareSnapshot}
      />
    </div>
  )
}
