import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChartPane from '../../../components/chart/pane/ChartPane'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import ShareToFloor from '../../../components/community/ShareToFloor'
import { useWorkspace } from '../WorkspaceContext'
import useWatchlistAlerts from '../../../hooks/useWatchlistAlerts'
import AiSearchWidget from './AiSearchWidget'
import UIcon from '../../../components/ui/UIcon'
import LeverageInverseControl from './LeverageInverseControl'
import styles from '../ChartsWorkspace.module.css'
import ChartTabStrip from './ChartTabStrip'
import {
  sanitizeChartTabs, chartTabList, addChartTab, closeChartTab,
  setActiveChartTab, renameChartTab, patchChartTab,
} from '../chartTabs'

// The whole chart shell — identity row, timeframe bar, meta strip, settings
// modal, focus surface, StockChart — is ChartPane. What is left here is the
// WORKSPACE: color groups, chart tabs, the crosshair bus, hotkey arbitration,
// the right-click menu and the workspace-only chrome (leverage picker, add-tab,
// Share to the Floor).
export default function ChartWidget({ color, opts, onOptsChange, chartId = null }) {
  const { groupSyms, setGroupSym, crosshairBus, aiSearchBus, chartsTheme, activeChartRef, periodSortMode, onPeriodSelected: wsOnPeriodSelected, onPeriodCancel: wsOnPeriodCancel, replayCutoff } = useWorkspace()
  const { createAlert } = useWatchlistAlerts()
  // Imperative handle on the pane: the right-click menu opens its settings
  // modal, and the leverage picker routes its symbol change through it so the
  // chart refocuses exactly as a search pick does.
  const paneRef = useRef(null)

  // ── Multi-tab context ───────────────────────────────────────────────────────
  // A Chart widget can hold multiple INDEPENDENT chart profiles as tabs. Tab 0
  // ("main") uses the global chart_settings exactly like a tab-less widget always
  // has; extra tabs each carry their own settings/tf/color-group, fully isolated.
  // `activeColor`/`activeTf`/the active settings blob below drive everything the
  // rendered chart reads, and every settings write is routed to the active tab.
  const { tabs: extraTabs, active: activeTabIdx } = sanitizeChartTabs(opts)
  const isMainTab = activeTabIdx === 0
  const activeExtra = isMainTab ? null : (extraTabs[activeTabIdx - 1] || null)
  const activeColor = isMainTab ? color : (activeExtra?.color || color)

  // ⭐ PHASE C TASK 12 — THE CHART ID THIS SURFACE PUBLISHES.
  //
  // `WidgetHost` supplies the slot's persisted id; a chart TAB is an
  // independent chart profile with its own settings blob, so it gets its own
  // identity rather than sharing the slot's — otherwise two tabs in one widget
  // would share an alert set while showing different charts.
  //
  // ⛔ NOT `widgetIdRef` BELOW. That one is `w${Math.random()}`, minted per
  // MOUNT: scoping an alert to it would bind the alert to a chart that ceases
  // to exist on the next refresh. Both ids the producers hand down here are
  // persisted (`charts_workspace_layout`, and the tab's own `id`).
  //
  // ⚠️ A HOST THAT PASSES NONE STAYS GLOBAL, which is what every alert created
  // before this producer existed already is.
  const paneChartId = !chartId
    ? null
    : (isMainTab || !activeExtra ? chartId : `${chartId}:${activeExtra.id}`)

  // Debounce the linked ticker (~90ms): during a fast arrow-scan through a watchlist,
  // the group sym changes many times/sec — without this every intermediate ticker
  // runs the full StockChart fetch/framing pipeline and the charts fall behind. The
  // chart settles on the ticker you land on when the scan pauses.
  const groupSym = groupSyms[activeColor] || 'SPY'
  const [sym, setSym] = useState(groupSym)
  useEffect(() => {
    const t = setTimeout(() => setSym(groupSym), 90)
    return () => clearTimeout(t)
  }, [groupSym])

  // Thematic-ETF pseudo-ticker ("$IDX:<slug>" — see useThemeIndexBars, which the
  // pane owns): a synthetic index has no leveraged/inverse family, so that
  // control is hidden for one.
  const isThemeIndex = typeof sym === 'string' && sym.startsWith('$IDX:')

  // ── Crosshair sync across EVERY chart widget ──
  // Stable per-widget id so we ignore our own broadcasts. Deliberately NOT
  // scoped by color group or symbol (owner request 2026-07-29): two charts need
  // no link at all to mirror each other's crosshair. The vertical line maps by
  // ET calendar day so it works across timeframes, and the horizontal one tracks
  // the source cursor's price level (see chart/crosshairSync.js). The bus still
  // carries the emitter's color — kept for any future opt-in scoping — it just
  // isn't filtered on. Matches the multi-chart grid, which was already global.
  const widgetIdRef = useRef(null)
  if (!widgetIdRef.current) widgetIdRef.current = `w${Math.random().toString(36).slice(2, 9)}`

  const reportCrosshair = useCallback((payload) => {
    crosshairBus?.emit(activeColor, widgetIdRef.current, payload)
  }, [crosshairBus, activeColor])

  // Hand the bus straight to StockChart, which applies each payload
  // imperatively. Deliberately NOT React state: a setState per mouse move
  // re-rendered this widget and the whole StockChart subtree just to move one
  // line, and that render cost is what made the linked crosshair step/skip.
  // Identity is stable per bus, so the subscription isn't torn down on renders.
  // `sym` is in the deps purely so a ticker switch re-subscribes, which makes
  // StockChart's teardown clear any crosshair still drawn for the old symbol
  // (the state-based path did that with a null push on [sym]).
  const subscribeCrosshair = useCallback((cb) => {
    if (!crosshairBus) return () => {}
    return crosshairBus.subscribe(({ sourceId, payload }) => {
      if (sourceId !== widgetIdRef.current) cb(payload)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crosshairBus, sym])

  // ── Hotkey dedupe: only the last-hovered chart widget handles keydowns ──
  // null-means-all preserves the legacy behavior until the first hover; after
  // that, one TF keypress retimes exactly one chart (and settings toggles fire
  // ONE pref POST instead of one per mounted widget). Callback + ref = zero
  // re-renders on hover crossings.
  const markActive = useCallback(() => {
    if (activeChartRef) activeChartRef.current = widgetIdRef.current
  }, [activeChartRef])
  const hotkeysIsActive = useCallback(() => {
    const a = activeChartRef?.current
    return a == null || a === widgetIdRef.current
  }, [activeChartRef])
  // If THIS widget is active when it unmounts (closed via ✕ / New Layout /
  // mode switch), revert to null-means-all — otherwise every surviving
  // widget's hotkeys go dead until the pointer crosses another chart.
  useEffect(() => () => {
    if (activeChartRef && activeChartRef.current === widgetIdRef.current) {
      activeChartRef.current = null
    }
  }, [activeChartRef])

  const tf = isMainTab ? (opts?.tf || 'D') : (activeExtra?.tf || 'D')
  const setTf = useCallback((nextTf) => {
    if (nextTf === tf) return
    if (isMainTab) onOptsChange?.({ ...(opts || {}), tf: nextTf })
    else if (activeExtra) onOptsChange?.(patchChartTab(opts, activeExtra.id, { tf: nextTf }))
  }, [opts, tf, onOptsChange, isMainTab, activeExtra])

  // EVERY chart surface in the workspace owns its OWN settings, so editing one
  // widget (or tab) never touches another or the dashboard. The global blob is
  // only the SEED/default: a widget/tab that hasn't been edited yet inherits it
  // (so existing layouts look identical), and NEW widgets start from it; the
  // moment you change a setting it's stored on that surface's own blob in `opts`
  // and diverges. Main tab → opts.settings; extra tab → its chartTabs[i].settings.
  const activeStoredSettings = isMainTab ? (opts?.settings || null) : (activeExtra?.settings || null)
  // Identity-stable write sink for the active surface. MUST be useCallback, not
  // an inline arrow at the ChartPane call site: it flows through
  // useChartSurfaceSettings' `write` into StockChart as onSettingsPersist, which
  // several of StockChart's useEffects/useMemo key off — an inline literal would
  // be a new identity every render (including on every live-price tick and 60s
  // clock re-render), tearing down and re-attaching StockChart's keydown/pointer
  // listeners for no reason.
  const persistActiveSettings = useCallback((next) => {
    if (isMainTab) onOptsChange?.({ ...(opts || {}), settings: next })
    else if (activeExtra) onOptsChange?.(patchChartTab(opts, activeExtra.id, { settings: next }))
  }, [isMainTab, activeExtra, opts, onOptsChange])
  // The pane resolves these same inputs for itself; this call is here only for
  // menuVars, which the workspace's OWN chrome needs (the right-click menu and
  // the leverage picker are rendered outside the pane and must match the chart
  // canvas). Both calls memoize off the same identities, so the duplicate costs
  // nothing per render.
  // `cs` is pulled out alongside menuVars for the leverage menu's candle colors
  // (master fec7c5e4). ChartWidget lost its own `chartCs` when settings
  // resolution moved into ChartPane, so it reads them back through the same hook
  // rather than reaching into the pane.
  const { menuVars, cs: chartCs } = useChartSurfaceSettings({
    stored: activeStoredSettings,
    onStore: persistActiveSettings,
    chartsTheme,
  })

  // Every ticker change routes through here; the pane adds the refocus so the
  // user can type the next ticker without re-clicking the chart.
  const handleSymbolChange = useCallback((s) => {
    if (!s) return
    setGroupSym(activeColor, s)
  }, [activeColor, setGroupSym])

  // ── Tab handlers (all go through the pure chartTabs reducer) ──
  const tabList = useMemo(() => chartTabList(opts), [opts])
  const tabColors = useMemo(
    () => Object.fromEntries(extraTabs.map(t => [t.id, t.color])),
    [extraTabs],
  )
  const handleAddTab = useCallback(() => {
    onOptsChange?.(addChartTab(opts, { color: activeColor, tf: 'D' }))
  }, [opts, activeColor, onOptsChange])
  const handleSelectTab = useCallback((idx) => {
    onOptsChange?.(setActiveChartTab(opts, idx))
  }, [opts, onOptsChange])
  const handleCloseTab = useCallback((id) => {
    onOptsChange?.(closeChartTab(opts, id))
  }, [opts, onOptsChange])
  const handleRenameTab = useCallback((id, name) => {
    onOptsChange?.(renameChartTab(opts, id, name))
  }, [opts, onOptsChange])
  const handleCycleTabColor = useCallback((id) => {
    const t = extraTabs.find(x => x.id === id)
    if (!t) return
    const order = ['A', 'B', 'C', 'D']
    const next = order[(order.indexOf(t.color) + 1) % order.length]
    onOptsChange?.(patchChartTab(opts, id, { color: next }))
  }, [opts, extraTabs, onOptsChange])

  // ── Right-click context menu (charts-workspace only) ──
  // Providing onBarContextMenu makes StockChart route the right-click HERE instead
  // of the app-wide GlobalAddPositionProvider menu, so the workspace gets its own
  // clean menu: Set alert · Reset view · Chart settings · AI search (on a bar).
  const [ctxMenu, setCtxMenu] = useState(null)   // {x,y,price,bar,currentPrice,resetView,openSettings}
  const [ctxToast, setCtxToast] = useState(null)
  const [tempAi, setTempAi] = useState(null)     // {query,x,y} — transient AI popup when no AI widget exists
  const closeCtx = useCallback(() => setCtxMenu(null), [])

  const handleBarContextMenu = useCallback((p) => {
    try { p.event?.preventDefault?.() } catch { /* noop */ }
    // Clamp so the ~230px×~180px menu stays on screen.
    const x = Math.min(p.clientX, window.innerWidth - 236)
    const y = Math.min(p.clientY, window.innerHeight - 190)
    setCtxMenu({ x: Math.max(6, x), y: Math.max(6, y), rawX: p.clientX, rawY: p.clientY,
      price: p.clickPrice, bar: p.bar, currentPrice: p.currentPrice,
      resetView: p.resetView, openSettings: p.openSettings,
      clearDrawings: p.clearDrawings, hasDrawings: p.hasDrawings })
  }, [])

  useEffect(() => {
    if (!ctxToast) return undefined
    const t = setTimeout(() => setCtxToast(null), 1800)
    return () => clearTimeout(t)
  }, [ctxToast])

  const handleSetAlert = useCallback(() => {
    const price = ctxMenu?.price
    if (!Number.isFinite(price)) { closeCtx(); return }
    const dir = (Number.isFinite(ctxMenu?.currentPrice) && price < ctxMenu.currentPrice) ? 'below' : 'above'
    try { createAlert(sym, price, dir); setCtxToast(`Alert set: ${sym} ${dir} $${price.toFixed(2)}`) }
    catch { setCtxToast('Could not set alert') }
    closeCtx()
  }, [ctxMenu, sym, createAlert, closeCtx])

  const barDateStr = useCallback((t) => {
    if (typeof t === 'string') return t                 // daily 'YYYY-MM-DD'
    if (typeof t === 'number' && Number.isFinite(t)) {
      try { return new Date(t * 1000).toISOString().slice(0, 10) } catch { /* noop */ }
    }
    return null
  }, [])

  const handleAiSearch = useCallback(() => {
    const bar = ctxMenu?.bar
    const d = barDateStr(bar?.t)
    if (!d) { closeCtx(); return }
    const query = `What were the major news headlines and catalysts that moved ${sym} on ${d}? Give the specific % move that day, the driving story, and any analyst actions.`
    const menuX = ctxMenu.rawX, menuY = ctxMenu.rawY
    closeCtx()
    // Route to a mounted AI Search widget if one exists, else a transient popup.
    const delivered = aiSearchBus?.request?.(query)
    if (!delivered) {
      const x = Math.max(8, Math.min(menuX, window.innerWidth - 388))
      const y = Math.max(8, Math.min(menuY, window.innerHeight - 452))
      setTempAi({ query, x, y })
    }
  }, [ctxMenu, sym, barDateStr, aiSearchBus, closeCtx])

  return (
    <>
      <ChartPane
        ref={paneRef}
        sym={sym}
        tf={tf}
        onSymbolChange={handleSymbolChange}
        onTfChange={setTf}
        stored={activeStoredSettings}
        onStore={persistActiveSettings}
        chartsTheme={chartsTheme}
        onActivate={markActive}
        stockChartProps={{
          onCrosshairMove: reportCrosshair,
          subscribeCrosshair,
          hotkeysActive: hotkeysIsActive,
          onBarContextMenu: handleBarContextMenu,
          // ⭐ WHICH CHART (Phase C Task 12). `ChartPane` spreads
          // `stockChartProps` onto `StockChart`, which forwards it to
          // `ChartToolbar` → `IndicatorAlertPopover` → the `?scope=` request.
          chartId: paneChartId,
          // Custom-Period Sort: drag-to-highlight mode + the completed selection,
          // tagged with THIS chart's symbol for the config popover's % readout.
          periodSelect: !!periodSortMode,
          onPeriodSelected: periodSortMode
            ? (start, end, pct) => wsOnPeriodSelected?.(sym, start, end, pct)
            : undefined,
          onPeriodCancel: periodSortMode ? wsOnPeriodCancel : undefined,
          // Replay mode: hide every bar after this ISO date (null = normal chart).
          replayCutoff: replayCutoff || null,
        }}
        slots={{
          /* Chart tab strip — renders only once ≥1 extra tab exists, so a
             single-chart widget is visually unchanged. Each tab is an
             independent chart profile. */
          top: extraTabs.length > 0 ? (
            <ChartTabStrip
              tabs={tabList}
              activeIndex={activeTabIdx}
              tabColors={tabColors}
              onSelect={handleSelectTab}
              onAdd={handleAddTab}
              onClose={handleCloseTab}
              onRename={handleRenameTab}
              onCycleColor={handleCycleTabColor}
            />
          ) : null,
          tfBarRight: (
            <>
              {!isThemeIndex && (
                <LeverageInverseControl
                  sym={sym}
                  onSelect={(s) => paneRef.current?.changeSymbol(s)}
                  themeVars={menuVars}
                  /* From master fec7c5e4: the LONG/SHORT headers + factor badges
                     follow the chart's candle up/down colors. Carried across the
                     ChartPane extraction by hand — the merge could not do it, since
                     master added this prop to the pre-extraction inline render. */
                  candleColors={{ up: chartCs.candles?.upColor, down: chartCs.candles?.downColor }}
                />
              )}
              {/* Add-tab entry point — only when the strip isn't showing yet (0
                  extra tabs). Once a tab exists, the strip's own + button takes over. */}
              {extraTabs.length === 0 && (
                <button
                  type="button"
                  className={styles.chartSettingsBtn}
                  onClick={handleAddTab}
                  title="New chart tab (independent settings, loads as UCT Default)"
                  aria-label="New chart tab"
                >
                  <UIcon name="plus" size={15} />
                </button>
              )}
            </>
          ),
          /* After the pane's settings gear, keeping the shipped order:
             leverage · add-tab · gear · share. */
          tfBarEnd: <ShareToFloor card={{ kind: 'chart', ticker: sym, tf }} compact />,
          overlay: ctxToast ? <div className={styles.flagToast}>{ctxToast}</div> : null,
        }}
      />
      {/* ── Chart right-click menu ── */}
      {ctxMenu && (
        <>
          <div
            className={styles.chartCtxBackdrop}
            onClick={closeCtx}
            onContextMenu={(e) => { e.preventDefault(); closeCtx() }}
          />
          <div className={styles.chartCtxMenu} style={{ left: ctxMenu.x, top: ctxMenu.y, ...menuVars }} role="menu">
            {Number.isFinite(ctxMenu.price) && (
              <button type="button" className={styles.chartCtxItem} onClick={handleSetAlert}>
                <UIcon name="bell" size={14} className={styles.chartCtxIcon} />
                Set alert @ ${ctxMenu.price.toFixed(2)}
              </button>
            )}
            <button type="button" className={styles.chartCtxItem} onClick={() => { ctxMenu.resetView?.(); closeCtx() }}>
              <UIcon name="refresh" size={14} className={styles.chartCtxIcon} />Reset view
            </button>
            <button type="button" className={styles.chartCtxItem} onClick={() => { paneRef.current?.openSettings(); closeCtx() }}>
              <UIcon name="gear" size={14} className={styles.chartCtxIcon} />Chart settings
            </button>
            {ctxMenu.hasDrawings && (
              <button type="button" className={styles.chartCtxItem} onClick={() => { ctxMenu.clearDrawings?.(); setCtxToast('Drawings cleared'); closeCtx() }}>
                <UIcon name="trash" size={14} className={styles.chartCtxIcon} />Clear all drawings
              </button>
            )}
            {ctxMenu.bar && (
              <button type="button" className={`${styles.chartCtxItem} ${styles.chartCtxAi}`} onClick={handleAiSearch}>
                <UIcon name="compass" size={14} className={styles.chartCtxIcon} />AI search this bar
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Transient AI popup (only when no AI Search widget is in the layout) ── */}
      {tempAi && (
        <>
          <div className={styles.chartCtxBackdrop} onClick={() => setTempAi(null)} />
          <div className={styles.tempAiTab} style={{ left: tempAi.x, top: tempAi.y }}>
            <AiSearchWidget
              initialQuery={tempAi.query}
              color={activeColor}
              onTicker={(tk) => { setGroupSym(activeColor, tk); setTempAi(null) }}
            />
          </div>
        </>
      )}
    </>
  )
}
