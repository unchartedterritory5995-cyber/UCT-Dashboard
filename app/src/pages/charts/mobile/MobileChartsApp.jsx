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
export default function MobileChartsApp({ widgets, onRemove, onColorChange, onOptsChange, onAddWidget }) {
  const { groupSyms, setGroupSym, chartsTheme } = useWorkspace()

  // null | 'symbol' | 'tf' | 'type' | 'indicators' | 'alert' | 'more'
  const [sheet, setSheet] = useState(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  // A non-chart widget opened as a full-screen page (by id, so a layout change
  // can never re-point it at a different widget).
  const [screenWidgetId, setScreenWidgetId] = useState(null)
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
  const screenWidget = screenWidgetId ? (widgets || []).find((w) => w.id === screenWidgetId) : null

  const color = chartWidget?.color || 'A'
  const sym = groupSyms[color] || 'SPY'
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

  // ★ Watchlist — the scan→tap→chart loop, one tap from the chart. Opens the
  // layout's first watchlist widget; with none saved, adds one and opens it as
  // soon as it hydrates into `widgets`.
  const watchlistWidget = useMemo(() => (widgets || []).find((w) => w.type === 'watchlist'), [widgets])
  const handleOpenWatchlist = useCallback(() => {
    if (watchlistWidget) { setScreenWidgetId(watchlistWidget.id); return }
    setPendingWatchlistOpen(true)
    onAddWidget('watchlist')
  }, [watchlistWidget, onAddWidget])
  // Render-time state adjustment (the you-might-not-need-an-effect pattern):
  // the moment the added watchlist hydrates into `widgets`, consume the pending
  // flag and open it — React re-renders before committing, no effect pass.
  if (pendingWatchlistOpen && watchlistWidget) {
    setPendingWatchlistOpen(false)
    setScreenWidgetId(watchlistWidget.id)
  }

  const stockChartProps = useMemo(() => ({
    chartId: chartWidget?.id || null,
    toolbarApiRef,
    // Clean canvas by default on phone: the drawing toolbar starts collapsed
    // (chevron to expand) unless this browser has explicitly chosen otherwise.
    toolbarDefaultCollapsed: true,
  }), [chartWidget?.id])

  return (
    <div className={`${wsStyles.mobileWorkspace} ${styles.shell}`} data-testid="mobile-charts-app" data-charts-theme={chartsTheme}>
      {chartWidget ? (
        <>
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

            {/* Full-screen widget page — rendered OVER the chart so the chart
                never unmounts (returning from the watchlist is instant). */}
            {screenWidget && (
              <div className={styles.widgetScreen}>
                <div className={styles.screenHeader}>
                  <button type="button" className={styles.screenBack} onClick={() => setScreenWidgetId(null)}>
                    <UIcon name="chevronRight" size={15} gold={false} style={{ transform: 'rotate(180deg)' }} />
                    Chart
                  </button>
                  <span className={styles.screenTitle}>{MENU_LABEL[screenWidget.type] || screenWidget.type}</span>
                </div>
                <div className={styles.screenBody}>
                  <WidgetHost
                    key={screenWidget.id}
                    widget={screenWidget}
                    onRemove={() => { onRemove(screenWidget.id); setScreenWidgetId(null) }}
                    onColorChange={(c) => onColorChange(screenWidget.id, c)}
                    onOptsChange={(o) => onOptsChange(screenWidget.id, o)}
                  />
                </div>
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
          />
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
        onOpenWidget={setScreenWidgetId}
        onAddWidget={(t) => { onAddWidget(t) }}
        onOpenSettings={openSettings}
        onSetAlert={() => setSheet('alert')}
      />
    </div>
  )
}
