import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChartPane from '../../../components/chart/pane/ChartPane'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import WidgetHost from '../WidgetHost'
import { useWorkspace } from '../WorkspaceContext'
import UIcon from '../../../components/ui/UIcon'
import { labelMap } from '../../../widgets/registry'
import MobileSymbolStrip from './MobileSymbolStrip'
import ReviewNavControl, { VARIANTS as NAV_VARIANTS } from '../review/ReviewNavControl'
import useReviewSession from '../review/useReviewSession'
import ReviewFeed from '../review/ReviewFeed'
import MobileChartToolbar from './MobileChartToolbar'
import MobileSymbolSheet from './MobileSymbolSheet'
import MobileTfSheet from './MobileTfSheet'
import useChartHubSection from '../../../hub/sections/chartSection'
import MobileChartTypeSheet, { selectedTypeKey, chartTypePatch } from './MobileChartTypeSheet'
import MobileIndicatorSheet from './MobileIndicatorSheet'
import MobileAlertSheet from './MobileAlertSheet'
import MobileMoreSheet from './MobileMoreSheet'
import MobileLayoutsSheet from './MobileLayoutsSheet'
import MobileBoardsSheet from './MobileBoardsSheet'
import MobileObjectsSheet from './MobileObjectsSheet'
import useChartDrawings from '../../../components/chart/useChartDrawings'
// The ACTIVE board's name for the Tools row's subtitle. Read here rather than
// inside the row so the sheet stays the only thing that mounts the manager.
import useTracings from '../../../components/chart/useTracings'
import { tracingLabel } from '../../../components/chart/drawingsStore'
import { pushRecent } from './mobileRecents'
import { isInstanceTombstone } from '../../../components/chart/instanceShape'
import { CARVED_OUT_ROWS } from '../../../components/chart/indicatorCatalog'
import { liveOverlayList } from '../../../components/chart/chartDefaults'
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
export default function MobileChartsApp({
  widgets, onRemove, onColorChange, onOptsChange, onAddWidget, tablet = false,
  /* MOB-01 — passed straight through to MobileLayoutsSheet. These are ChartsWorkspace's
     OWN handlers; this component never touches /api/charts/layouts itself. */
  layoutsMine = [], layoutsPrebuilt = [], layoutsActive = null, layoutsLoading = false,
  layoutsSavedFlash = false, isAdmin = false,
  onApplyLayout, onApplyUctDefault, onSaveLayout, onSaveLayoutAs, onDeleteLayout,
}) {
  const { groupSyms, setGroupSym, chartsTheme } = useWorkspace()

  // null | 'symbol' | 'tf' | 'type' | 'indicators' | 'alert' | 'more' | 'layouts'
  const [sheet, setSheet] = useState(null)
  // Wave 10: a legend-chip tap opens the indicator sheet ALREADY INSIDE that
  // study's editor — {kind:'study', defId, instanceId}. Cleared with the sheet
  // so the next plain ƒx open starts at the list, not a stale editor.
  const [sheetEditing, setSheetEditing] = useState(null)
  const closeSheet = useCallback(() => { setSheet(null); setSheetEditing(null) }, [])
  const legendStudyTap = useCallback((target) => {
    setSheetEditing(target)
    setSheet('indicators')
  }, [])
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
  const { tracings: _boards, activeId: _activeBoardId } = useTracings()
  const _activeBoard = _boards.find((t) => t.id === _activeBoardId)

  // The global FABs (voice orb bottom-right, feedback "?" bottom-left) anchor
  // just above the tab bar — exactly where the chart toolbar now lives. Stamp
  // the root while this shell is mounted so their CSS steps them up over it
  // (FloatingOrb.module.css / FeedbackWidget.module.css read this attribute).
  useEffect(() => {
    document.documentElement.setAttribute('data-mobile-chart-shell', '1')
    return () => document.documentElement.removeAttribute('data-mobile-chart-shell')
  }, [])

  // The pickers portal to <body>, OUTSIDE the shell's [data-charts-theme]
  // token subtree — on Sunrise that left hard-dark sheets over a light chart.
  // `.uctSunSheet` (a GLOBAL class — Sheet's className lands on the panel) is
  // a second selector on the workspace's own sunrise token block, so the
  // sheets flip with the exact palette the strip/toolbar use.
  const sheetTheme = chartsTheme === 'sunrise' ? 'uctSunSheet' : ''

  const chartIdx = chartWidgetIndex(widgets)
  const chartWidget = chartIdx >= 0 ? widgets[chartIdx] : null
  const otherWidgets = useMemo(() => (widgets || []).filter((w) => w.type !== 'chart'), [widgets])
  const screenWidget = screen ? (widgets || []).find((w) => w.id === screen.id) : null

  const color = chartWidget?.color || 'A'
  const sym = groupSyms[color] || 'SPY'
  // The objects on THIS symbol — the recovery surface's data, straight from the
  // store the canvas draws from.
  const _objDrawings = useChartDrawings(sym)
  const _hiddenObjects = _objDrawings.drawings.reduce((n, d) => n + (d.hidden ? 1 : 0), 0)

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

  /* MOB-REVIEW · the transport control for an in-progress review.
   *
   * ⛔ It renders ONLY when a review session exists. A chart opened from search
   * or a deep link has no ordered set behind it, and a "1 / 1" chip there would
   * be furniture pretending to be context. */
  const review = useReviewSession(groupSyms?.[color] || null, { tf })
  const [feedOpen, setFeedOpen] = useState(false)
  // Placement probe: `?navprobe=rail|pill|edge` forces a variant with a synthetic
  // position so the three candidates can be MEASURED on hardware against the real
  // chart. Never reachable without the param.
  const navProbe = (() => {
    try {
      const v = new URLSearchParams(window.location.search).get('navprobe')
      return NAV_VARIANTS.includes(v) ? v : null
    } catch { return null }
  })()
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

  // ── The joystick hub's Chart controller (§3.5) ───────────────────────────
  // Mounted HERE, right after `handleTf`, because that is the setter it drives: the hub's tap,
  // double-tap and timeframe scrub all resolve through the page's own writer rather than a second
  // path into `opts.tf`. `customTfs` is the SAME expression MobileTfSheet is given below, so the
  // gesture and the picker step the same ladder. Everything it mounts is gated on
  // `useHubEligible` inside `hubMount`, so on a desktop or in a bare test render it is nothing.
  // ⭐ D-01 — the hub's Draw bubble, through `StockChart`'s own toolbar API.
  //
  // ⛔ NOT `expandDrawToolbar()`. That door (the Tools sheet's "Draw on chart", below) REVEALS the
  // drawbar and arms nothing, which is the whole reason D-01 was deferred: on a fan, a bubble that
  // opens a toolbar is not the action "Draw". `selectTool` is the same door with the arm attached
  // and it RETURNS FALSE rather than no-opping (unknown tool id, or a read-only mount), so the
  // seam can say it did nothing instead of appearing to work.
  //
  // ⛔ TRENDLINE IS THE TOOL THE ROW NAMES — deferred.md D-01 is titled "Draw (trendline tool)"
  // and master-spec v1.1 §241 reads "Draw (trendline tool active)". It is not a default chosen
  // here.
  const drawTrendline = useCallback(() => (
    toolbarApiRef.current?.selectTool?.('trendline') === true
  ), [])

  const chartHub = useChartHubSection({
    tf,
    symbol: sym,
    customTfs: Array.isArray(cs?.header?.customTimeframes) ? cs.header.customTimeframes : [],
    onTf: handleTf,
    onDraw: drawTrendline,
  })

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
  // Tools → "Draw on chart": the discoverable door onto the drawing toolbar,
  // which starts collapsed on phone (clean canvas, a chevron nobody new would
  // find). Expands through the toolbar's own persisting setter.
  const drawOnChart = useCallback(() => { toolbarApiRef.current?.expandDrawToolbar?.() }, [])

  // Toolbar ƒx badge: live MA overlay slots (the `enabled` flag
  // MobileIndicatorSheet toggles) PLUS library indicators — an engine
  // instance's EXISTENCE is what "enabled" means there (chartDefaults's
  // instance model). Wave-3 crawl found the badge undercounting a chart
  // running RSI/MACD sub-panes. Wave 4: TOMBSTONES are not instances — a
  // toggled-off study leaves its off-marker in the array, and counting it
  // would show a badge for a study drawing nothing — and the carved-out
  // rows (Volume Profile) draw with no instance at all, so they count off
  // their settings slice.
  const indicatorCount = useMemo(() => {
    // ⛔ THROUGH `liveOverlayList`, so the badge counts what the CHART draws. A
    // moving average the member removed keeps its slot (the merge is positional —
    // see `chartDefaults`'s tombstone header) and would otherwise still be counted
    // here, which is the badge-counting-ghosts defect this block already guards
    // against for tombstoned instances two lines down.
    const mas = liveOverlayList(cs?.overlays).filter((o) => o?.enabled).length
    const studies = Array.isArray(cs?.indicatorInstances)
      ? cs.indicatorInstances.filter((i) => i && typeof i === 'object' && !isInstanceTombstone(i)).length
      : 0
    const carved = CARVED_OUT_ROWS.filter((r) => cs?.indicators?.[r.id]?.enabled === true).length
    return mas + studies + carved
  }, [cs])

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

  /* THE LIST — the review's OWN set, as charts.
   *
   * ⚰️ THIS USED TO OPEN THE WATCHLIST WIDGET, and that was only ever right for
   * one of the five sources a review can have. A review entered from a scan or
   * a screener has no list surface on the phone at all, so the gesture showed an
   * UNRELATED watchlist when one happened to be in the layout and fell through
   * to the More sheet when one did not — a control labelled with the review's
   * position, opening something that is not the review.
   *
   * ⛔ ONE GESTURE, ONE ANSWER, WHATEVER THE SOURCE: `ReviewFeed` shows the
   * ordered set the review is actually walking. The watchlist page is unchanged
   * and still one tap away through its own widget — going BACK to it is a
   * different intent (leaving the review) from looking ACROSS the set. */
  const openReviewList = useCallback(() => { setFeedOpen(true) }, [])

  /* ⛔ THROUGH THE SESSION, never straight to the symbol. Tapping a card MOVES
   * THE REVIEW to that index, so the transport control's "12 / 47" and the chart
   * are the same fact; setting the symbol alone would leave the position chip
   * describing where the member used to be. */
  const goToReview = review.goTo
  const pickFromFeed = useCallback((index) => {
    const t = goToReview(index)
    if (t) setGroupSym(color, t)
    setFeedOpen(false)
  }, [goToReview, color, setGroupSym])
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
    // Wave 8: drawing tools present as MobileDrawBar (labeled bottom strip);
    // the desktop ChartToolbar hides entirely on this shell.
    mobileDrawBar: true,
    // Phase 10 — the clean canvas. ChartPane force-enables these for the
    // desktop workspace; the spread order lets the shell take them back:
    // the symbol strip already shows the live price, so the legend becomes
    // what it is on TradingView mobile — a crosshair INSPECTION tool, not
    // permanent furniture — and the TC2000 range bar stays desktop (the TF
    // sheet owns timeframes here).
    verticalLegend: false,
    alwaysShowLegend: false,
    showRangeSelector: false,
    // Wave 10: tap a study's legend chip → its mobile editor (TradingView's
    // tap-the-legend-name). Stable callback, so the memo key stays the widget.
    onLegendStudyTap: legendStudyTap,
  }), [chartWidget?.id, legendStudyTap])

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
      {chartHub.hubMount}
      {chartWidget ? (
        <>
          <div className={styles.chartCol}>
          <MobileSymbolStrip sym={sym} onOpenSearch={() => setSheet('symbol')} />
          <div className={styles.chartArea}>
            {(review.position.total > 0 || navProbe) && (
              <ReviewNavControl
                variant={navProbe || 'pill'}
                label={navProbe ? '12 / 47' : review.position.label}
                sourceLabel={review.session?.label || ''}
                canPrev={navProbe ? true : review.position.canPrev}
                canNext={navProbe ? true : review.position.canNext}
                onPrev={() => { const t = review.prev(); if (t) setGroupSym(color, t) }}
                onNext={() => { const t = review.next(); if (t) setGroupSym(color, t) }}
                onOpenList={openReviewList}
              />
            )}
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

      {/* ⛔ MOUNTED ONLY WHILE OPEN, and only with a session behind it. Each card
          can hold a live chart; a feed rendered closed would be N charts nobody
          asked for, which is the exact budget this surface exists to respect. */}
      {feedOpen && review.session && (
        <ReviewFeed
          session={review.session}
          tf={tf}
          onOpen={pickFromFeed}
          onClose={() => setFeedOpen(false)}
        />
      )}

      <MobileSymbolSheet open={sheet === 'symbol'} onClose={closeSheet} onPick={handleSymbolPick} className={sheetTheme} />
      <MobileTfSheet
        open={sheet === 'tf'}
        onClose={closeSheet}
        tf={tf}
        onTf={handleTf}
        customTfs={Array.isArray(cs?.header?.customTimeframes) ? cs.header.customTimeframes : []}
        className={sheetTheme}
      />
      <MobileChartTypeSheet
        open={sheet === 'type'}
        onClose={closeSheet}
        chartType={selectedTypeKey(cs)}
        onPick={(t) => write({ ...cs, ...chartTypePatch(t), preset: 'custom' })}
        className={sheetTheme}
      />
      <MobileIndicatorSheet
        open={sheet === 'indicators'}
        onClose={closeSheet}
        cs={cs}
        onWrite={write}
        onBrowseLibrary={browseLibrary}
        onOpenSettings={openSettings}
        className={sheetTheme}
        initialEditing={sheetEditing}
      />
      <MobileAlertSheet open={sheet === 'alert'} onClose={closeSheet} sym={sym} className={sheetTheme} />
      <MobileLayoutsSheet
        open={sheet === 'layouts'}
        onClose={closeSheet}
        mine={layoutsMine}
        prebuilt={layoutsPrebuilt}
        active={layoutsActive}
        isAdmin={isAdmin}
        loading={layoutsLoading}
        savedFlash={layoutsSavedFlash}
        onApply={onApplyLayout}
        onApplyUctDefault={onApplyUctDefault}
        onSaveCurrent={onSaveLayout}
        onSaveAs={onSaveLayoutAs}
        onDelete={onDeleteLayout}
        className={sheetTheme}
      />
      <MobileMoreSheet
        open={sheet === 'more'}
        onClose={closeSheet}
        sym={sym}
        widgets={otherWidgets}
        onOpenWidget={openWidgetScreen}
        onAddWidget={handleAddFromSheet}
        onOpenLayouts={() => setSheet('layouts')}
        activeLayoutName={layoutsActive?.name || null}
        onOpenBoards={() => setSheet('boards')}
        onOpenObjects={() => setSheet('objects')}
        hiddenObjectCount={_hiddenObjects}
        activeBoardName={_activeBoard ? tracingLabel(_activeBoard) : null}
        onOpenSettings={openSettings}
        onSetAlert={() => setSheet('alert')}
        onShareSnapshot={handleShareSnapshot}
        onDrawOnChart={drawOnChart}
        className={sheetTheme}
      />
      <MobileBoardsSheet
        open={sheet === 'boards'}
        onClose={closeSheet}
        sym={sym}
        className={sheetTheme}
      />
      {/* The recovery surface. ⛔ It reads the SAME store the canvas draws from
          (`useChartDrawings(sym)`), never a copy — a manager that could disagree
          with the chart about what exists is worse than none. */}
      <MobileObjectsSheet
        open={sheet === 'objects'}
        onClose={closeSheet}
        sym={sym}
        drawings={_objDrawings.drawings}
        onToggleHidden={(id, hidden) => _objDrawings.updateDrawing(id, { hidden })}
        onToggleLocked={(id, locked) => _objDrawings.updateDrawing(id, { locked })}
        onDelete={(id) => _objDrawings.removeDrawing(id)}
        onShowAll={() => {
          for (const d of _objDrawings.drawings) if (d.hidden) _objDrawings.updateDrawing(d.id, { hidden: false })
        }}
        className={sheetTheme}
      />
    </div>
  )
}
