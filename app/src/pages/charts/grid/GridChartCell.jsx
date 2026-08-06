// app/src/pages/charts/grid/GridChartCell.jsx
//
// One cell of the Multi-Chart grid: a controlled {sym, tf} chart composed on
// StockChart directly (NOT ChartWidget — the workspace widget's symbol comes
// from the 4-color-group model, which caps independent tickers at 4). The
// header mirrors the workspace ChartWidget header 1:1 so grid cells look
// UNIFORM with the primary chart (owner request): logo + full company name +
// day gain + per-cell Style + gear (top row); the 8-button timeframe bar +
// Market Cap / Next Earnings / UCT Rating + session toggle + live clock
// (second row). The meta + session block collapse via container query in
// dense/narrow cells (see MultiChartGrid.module.css). Exported as React.memo —
// the container hands every prop with a stable identity so a mouse sweep across
// the grid re-renders zero charts.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import ChartDayGain from '../widgets/ChartDayGain'
import ChartMarketClock from '../widgets/ChartMarketClock'
import { useFlagged } from '../../../hooks/useFlagged'
import useWatchlistAlerts from '../../../hooks/useWatchlistAlerts'
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import useTickerMeta from '../../../hooks/useTickerMeta'
import useMarketOpen from '../../../hooks/useMarketOpen'
import usePreferences from '../../../hooks/usePreferences'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import { getExtSessionCached } from '../../../utils/extSession'
import { CHART_TYPE_OPTIONS, mergeChartSettings } from '../../../components/chart/chartDefaults'
import UIcon from '../../../components/ui/UIcon'
import wsStyles from '../ChartsWorkspace.module.css'
import styles from './MultiChartGrid.module.css'
import { TF_ORDER, shortcutClaimsKey } from '../../../components/chart/keyboardShortcuts'

// Labels for the timeframe bar. Order comes from TF_ORDER so the bar and the
// keyboard ladder can never drift apart (mirrors ChartWidget.jsx exactly).
const TF_LABELS = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', 'D': '1D', 'W': '1W', 'M': '1M',
}
const TFS = TF_ORDER.map(code => [code, TF_LABELS[code]])

// Per-cell chart style. '' = inherit the user's global chart_settings type.
const CELL_CHART_TYPES = [['', 'Style'], ...CHART_TYPE_OPTIONS]

// Letters only, no modifier combos. Period allowed for class-share tickers
// (BRK.B). Digits are deliberately EXCLUDED — they are timeframe shortcuts,
// and no US ticker starts with a digit. Once the search box has focus it
// accepts digits normally; this regex only decides what OPENS it.
const TICKER_KEY_RE = /^[A-Za-z.]$/

function GridChartCell({
  cell,               // {id, sym|null, tf} — controlled; sym null = empty slot
  badge,              // {changePct, tier, rationale, engine} | null — Groups mode scanner badge (Task 15; engine = provenance dot, T8)
  rationale,          // static rationale string, mirrors badge.rationale — used as the badge's title tooltip
  scanning,           // bool — Groups Mode toggle is ON; empty cells show the scan-prompt copy
  onChange,           // (nextCell) => void — container merges + debounce-persists
  crosshairBus,       // {emit(sourceId,payload), subscribe(fn)} | null (null = sync off)
  rangeBus,           // {emit(sourceId,payload), subscribe(fn)} | null (null = sync off) — mirrors crosshairBus for visible time-range
  volPanePct,         // shared charts_vol_pane_pct value (cells read, never write)
  isActive,           // () => boolean — active-cell gate for StockChart hotkeys
  dailyDefaultBars,   // container passes 90 on dense grids (>9 cells), else 126
  canvasTheme,        // 'sunrise' | null — threaded from WorkspaceContext
  onOpenSettings,     // opens the grid's ONE shared ChartSettingsModal
  onBarsReady,        // () => void — releases this cell's mount-queue slot
  isMaximized,        // this cell is expanded to fill the whole grid body
  onToggleMaximize,   // () => void — expand/restore this cell
  deepWarm,           // bool — this cell is MAXIMIZED; pre-load full history for instant scroll-back (StockChart deepWarm). Gated on maxId (not hover) so the React.memo "hover sweep re-renders zero charts" contract holds.
}) {
  const sym = cell.sym

  // ── Header data (mirrors ChartWidget so grid cells match the primary chart) ──
  const { prefs, setPref } = usePreferences()
  const { data: fund } = useFundamentalSnapshot(sym)
  const meta = useTickerMeta(sym)
  const headerLabel = meta?.name || sym || ''
  const mktCap = fund?.metrics?.market_cap || null
  const nextEarnStr = (() => {
    const iso = fund?.next_earnings
    if (!iso) return null
    const [y, mo, da] = String(iso).split('-').map(Number)
    return (y && mo && da) ? `${mo}/${da}/${y}` : null
  })()
  const uctRating = Number.isFinite(fund?.composite) ? fund.composite : null
  const _sun = canvasTheme === 'sunrise'
  const ratingColor = uctRating == null ? (_sun ? '#55606e' : '#9b9684')
    : uctRating >= 80 ? (_sun ? '#0a5c22' : '#22c45c')
    : uctRating >= 60 ? (_sun ? '#0a5c22' : '#7fb26a')
    : uctRating >= 40 ? (_sun ? '#7a5c16' : '#c9a84c')
    : (_sun ? '#7d1620' : '#c07a63')

  // Session toggle — ephemeral per-cell (D/W/M) + shared extendedHoursShading
  // pref (intraday). Copied verbatim from ChartWidget so behavior is identical.
  const mkt = useMarketOpen()
  const [sessionView, setSessionView] = useState('regular')
  useEffect(() => { if (mkt.isOpen) setSessionView('regular') }, [mkt.isOpen])
  const isDWMtf = ['D', 'W', 'M'].includes(cell.tf)
  const _extSess = getExtSessionCached()
  const extEnabled = _extSess.session === 'pre' || _extSess.session === 'post'
  const extLabel = _extSess.session === 'pre' ? 'Include pre-market' : 'Include post-market'
  const extHoursOn = mergeChartSettings(prefs.chart_settings).extendedHoursShading ?? true
  const setExtHours = useCallback((on) => {
    const next = { ...mergeChartSettings(prefs.chart_settings), extendedHoursShading: on, preset: 'custom' }
    setPref('chart_settings', JSON.stringify(next))
  }, [prefs.chart_settings, setPref])

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const [flagToast, setFlagToast] = useState(null)
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1400)
    return () => clearTimeout(t)
  }, [flagToast])

  const searchRef = useRef(null)
  const focusableRef = useRef(null)

  // ── Crosshair sync (ref-bus pattern, ChartWidget parity) ──
  const cellIdRef = useRef(null)
  if (!cellIdRef.current) cellIdRef.current = `g${Math.random().toString(36).slice(2, 9)}`
  const reportCrosshair = useCallback((payload) => {
    crosshairBus?.emit(cellIdRef.current, payload)
  }, [crosshairBus])
  // Imperative bus hand-off (ChartWidget parity): StockChart applies each
  // payload directly, so a 16-cell board costs ZERO re-renders per mouse move
  // instead of one per cell — that render storm is what made synced crosshairs
  // step and skip. Returning a no-op unsubscribe when the Sync toggle is off
  // also means StockChart's applier is simply never called, so nothing can be
  // left frozen on screen.
  const subscribeCrosshair = useCallback((cb) => {
    if (!crosshairBus || !sym) return () => {}
    return crosshairBus.subscribe(({ sourceId, payload }) => {
      if (sourceId !== cellIdRef.current) cb(payload)
    })
  }, [crosshairBus, sym])

  // ── Time-range sync (mirrors the crosshair ref-bus; echo-guarded in StockChart) ──
  const [externalTimeRange, setExternalTimeRange] = useState(null)
  const reportRange = useCallback((payload) => {
    rangeBus?.emit(cellIdRef.current, payload)
  }, [rangeBus])
  useEffect(() => {
    if (!rangeBus || !sym) return undefined
    return rangeBus.subscribe(({ sourceId, payload }) => {
      if (sourceId !== cellIdRef.current) setExternalTimeRange(payload)
    })
  }, [rangeBus, sym])
  useEffect(() => { setExternalTimeRange(null) }, [sym])
  useEffect(() => { if (!rangeBus) setExternalTimeRange(null) }, [rangeBus])

  const handleSymbolChange = useCallback((s) => {
    if (!s) return
    onChange({ ...cell, sym: String(s).toUpperCase() })
    // Refocus the chart region so pick-ticker → type-next-ticker flows without
    // re-clicking (ChartWidget parity).
    requestAnimationFrame(() => focusableRef.current?.focus({ preventScroll: true }))
  }, [cell, onChange])

  const handleTfChange = useCallback((tf) => {
    if (tf === cell.tf) return
    onChange({ ...cell, tf })
  }, [cell, onChange])

  // The user's OWN chart settings (same resolution as any other "your chart,
  // everywhere" surface — see useChartSurfaceSettings: charts_default_chart_widget
  // explicit winner, else the first /charts chart widget that actually has
  // settings). Without this, a grid cell fell back to StockChart's global
  // chart_settings SEED for everything except chartType, so a customized
  // /charts chart still rendered default candles/MAs/background in the grid.
  // `stored: null` + no `onStore` marks this as an own-chart-reading surface.
  const { ownChartSource } = useChartSurfaceSettings({ stored: null })

  // Per-cell chart type: a PARTIAL settings override merged over the user's
  // global chart_settings inside StockChart — this cell only, never persisted
  // into the global blob (write-restore lives in StockChart). Precedence is
  // resolved user settings < per-cell chartType (the per-cell Style picker
  // must still win over whatever the user's own chart is set to). When there
  // is no per-cell chartType, the resolved blob is returned AS-IS (same
  // reference as `ownChartSource`) rather than spread into a new object, so
  // an unrelated re-render never fabricates a fresh identity. Stable identity
  // per the settingsOverride contract (StockChart memo dep).
  const settingsOverride = useMemo(() => {
    if (!ownChartSource && !cell.chartType) return null
    if (!cell.chartType) return ownChartSource
    return { ...(ownChartSource || {}), chartType: cell.chartType }
  }, [ownChartSource, cell.chartType])
  const handleTypeChange = useCallback((val) => {
    onChange({ ...cell, chartType: val || null })
  }, [cell, onChange])

  const handleChartClick = useCallback(() => {
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    focusableRef.current?.focus({ preventScroll: true })
  }, [])

  const handleCellKeyDown = useCallback((e) => {
    const tgt = e.target
    // SELECT included (unlike ChartWidget): the TF <select> lives near the
    // focus wrapper — typing while it has focus must jump options natively,
    // never hijack into type-to-search.
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return
    if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (!sym) return   // empty cell: flagging null would poison the Flagged list
      e.preventDefault(); e.stopPropagation()
      const willFlag = !isFlagged(sym)
      toggleFlag(sym)
      setFlagToast(willFlag ? 'flagged' : 'unflagged')
      return
    }
    // A bound chart shortcut beats ticker search — EXCEPT a letter, which is a
    // ticker character first (uppercase included). See shortcutClaimsKey.
    if (shortcutClaimsKey(e)) return
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (!TICKER_KEY_RE.test(e.key)) return
    e.preventDefault()
    e.stopPropagation()   // typed ticker chars must never reach tool/TF hotkeys
    searchRef.current?.openWith(e.key)
  }, [sym, isFlagged, toggleFlag])

  // ── Right-click menu (clean grid menu — Option B from the design review) ──
  // The default app-root menu's "Chart settings" is unreachable in lite cells
  // (it routes through the drawing toolbar, which never mounts here), and the
  // J2 Add-to-Portfolio menu carries a GLOBAL chart-type submenu that would
  // silently restyle every chart in the app. So cells own a minimal menu:
  // alert · reset view · chart settings (→ the grid's shared modal).
  const { createAlert } = useWatchlistAlerts()
  const [ctxMenu, setCtxMenu] = useState(null)
  const [ctxToast, setCtxToast] = useState(null)
  const closeCtx = useCallback(() => setCtxMenu(null), [])
  useEffect(() => {
    if (!ctxToast) return undefined
    const t = setTimeout(() => setCtxToast(null), 1800)
    return () => clearTimeout(t)
  }, [ctxToast])
  const handleBarContextMenu = useCallback((p) => {
    try { p.event?.preventDefault?.() } catch { /* noop */ }
    const x = Math.min(p.clientX, window.innerWidth - 236)
    const y = Math.min(p.clientY, window.innerHeight - 150)
    setCtxMenu({
      x: Math.max(6, x), y: Math.max(6, y),
      price: p.clickPrice, currentPrice: p.currentPrice, resetView: p.resetView,
    })
  }, [])
  const handleSetAlert = useCallback(() => {
    const price = ctxMenu?.price
    if (!Number.isFinite(price) || !sym) { closeCtx(); return }
    const dir = (Number.isFinite(ctxMenu?.currentPrice) && price < ctxMenu.currentPrice) ? 'below' : 'above'
    try { createAlert(sym, price, dir); setCtxToast(`Alert set: ${sym} ${dir} $${price.toFixed(2)}`) }
    catch { setCtxToast('Could not set alert') }
    closeCtx()
  }, [ctxMenu, sym, createAlert, closeCtx])

  return (
    <div className={styles.cell} data-grid-cell-id={cell.id}>
      {/* Top row — logo + company name + day gain + per-cell Style + gear.
          Same classes/markup as ChartWidget's .chartHeaderTop for pixel parity. */}
      <div className={wsStyles.chartHeaderTop}>
        <span className={wsStyles.symbolSlot}>
          <SymbolSearch
            ref={searchRef}
            sym={sym || ''}
            onSymbolChange={handleSymbolChange}
            hideIcon
            fullLabel
            logoSym={sym || null}
            displayLabel={headerLabel}
            boundsRef={focusableRef}
          />
        </span>
        {sym && <ChartDayGain sym={sym} />}
        <select
          className={styles.cellStyleSelect}
          value={cell.chartType || ''}
          onChange={(e) => handleTypeChange(e.target.value)}
          aria-label="Chart style (this cell)"
          title="Chart style for this cell — 'Style' inherits your global chart settings"
        >
          {CELL_CHART_TYPES.map(([code, label]) => (
            <option key={code || 'inherit'} value={code}>{label}</option>
          ))}
        </select>
        <span className={styles.cellHeaderRight}>
          <button
            type="button"
            className={wsStyles.chartSettingsBtn}
            onClick={() => onOpenSettings?.()}
            title="Chart settings"
            aria-label="Chart settings"
          >
            <UIcon name="gear" size={15} />
          </button>
          <button
            type="button"
            className={styles.cellIconBtn}
            onClick={() => onToggleMaximize?.()}
            title={isMaximized ? 'Restore grid' : 'Maximize this chart'}
            aria-label={isMaximized ? 'Restore grid' : 'Maximize this chart'}
          >
            <UIcon name={isMaximized ? 'collapse' : 'expand'} size={14} />
          </button>
        </span>
      </div>
      {/* Second row — 8-button timeframe bar + meta + session toggle + clock.
          The meta + session blocks collapse in narrow cells (container query). */}
      <div className={wsStyles.tfBar}>
        {TFS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            className={`${wsStyles.tfBtn} ${cell.tf === code ? wsStyles.tfBtnActive : ''}`}
            onClick={() => handleTfChange(code)}
          >{label}</button>
        ))}
        {sym && (
          <div className={`${wsStyles.chartMeta} ${styles.gridMeta}`}>
            <span className={wsStyles.chartMetaItem}>
              <span className={wsStyles.chartMetaLabel}>Market Cap</span>
              <span className={wsStyles.chartMetaVal} style={{ color: '#c9a84c' }}>{mktCap || '—'}</span>
            </span>
            <span className={wsStyles.chartMetaItem}>
              <span className={wsStyles.chartMetaLabel}>Next Earnings</span>
              <span className={wsStyles.chartMetaVal} style={{ color: '#6ba3be' }}>{nextEarnStr || '—'}</span>
            </span>
            <span className={wsStyles.chartMetaItem}>
              <span className={wsStyles.chartMetaLabel}>UCT Rating</span>
              <span className={wsStyles.chartMetaVal} style={{ color: ratingColor }}>{uctRating != null ? uctRating : '—'}</span>
            </span>
            {badge && (
              <span
                className={styles.cellBadge}
                title={rationale || undefined}
                aria-label={`today ${badge.changePct ?? '—'}%, ${badge.tier || 'holding'}`}
              >
                {badge.tier && <span className={styles.cellBadgeTier}>{badge.tier[0].toUpperCase()}</span>}
                {badge.engine && <span title="Added by the theme engine" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-muted, #6b7280)', display: 'inline-block', opacity: 0.7, flex: '0 0 auto' }} />}
                {Number.isFinite(badge.changePct) && (
                  <span style={{ color: badge.changePct >= 0 ? '#22c55e' : '#f87171' }}>
                    {badge.changePct >= 0 ? '+' : ''}{badge.changePct.toFixed(1)}%
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        {sym && (
          <div className={`${wsStyles.tfBarRight} ${styles.gridSession}`}>
            {isDWMtf ? (
              <div className={wsStyles.sessionToggle} role="group" aria-label="Chart session view">
                <button
                  type="button"
                  className={`${wsStyles.sessionBtn} ${sessionView === 'regular' ? wsStyles.sessionBtnActive : ''}`}
                  onClick={() => setSessionView('regular')}
                  title="Regular trading hours only"
                >Regular Hours</button>
                <button
                  type="button"
                  className={`${wsStyles.sessionBtn} ${sessionView === 'extended' ? wsStyles.sessionBtnActive : ''}`}
                  onClick={() => { if (extEnabled) setSessionView('extended') }}
                  disabled={!extEnabled}
                  title={extEnabled ? extLabel : 'Available during pre-market and post-market'}
                >{extLabel}</button>
              </div>
            ) : (
              <div className={wsStyles.sessionToggle} role="group" aria-label="Chart extended hours">
                <button
                  type="button"
                  className={`${wsStyles.sessionBtn} ${!extHoursOn ? wsStyles.sessionBtnActive : ''}`}
                  onClick={() => setExtHours(false)}
                  title="Regular session only (9:30–4:00 ET), overnight gaps"
                >Regular Hours</button>
                <button
                  type="button"
                  className={`${wsStyles.sessionBtn} ${extHoursOn ? wsStyles.sessionBtnActive : ''}`}
                  onClick={() => setExtHours(true)}
                  title="Include pre-market + post-market bars"
                >Extended Hours</button>
              </div>
            )}
            <ChartMarketClock />
          </div>
        )}
      </div>
      <div
        ref={focusableRef}
        className={styles.cellChart}
        tabIndex={0}
        onClick={handleChartClick}
        onKeyDown={handleCellKeyDown}
      >
        {sym ? (
          <StockChart
            sym={sym}
            tf={cell.tf}
            onSymbolChange={handleSymbolChange}
            onTfChange={handleTfChange}
            onOpenSettings={onOpenSettings}
            onBarContextMenu={handleBarContextMenu}
            onCrosshairMove={crosshairBus ? reportCrosshair : null}
            subscribeCrosshair={subscribeCrosshair}
            onTimeRangeChange={rangeBus ? reportRange : null}
            externalTimeRange={externalTimeRange}
            /* Grid lite profile — the workspace chart look without the
               speculative warms, patterns, or per-instance hotkey ownership.
               hideReplay/hidePatterns/hideCompare are inert today (the toolbar
               only mounts under showDrawingTools) — kept as future-proofing
               for the v2 drawing-tools flip. */
            showDrawingTools={false}
            showSavedDrawings
            hideReplay
            hidePatterns
            hideCompare
            hideCountdown
            disablePatterns
            backgroundWarm={false}
            deepWarm={deepWarm}
            onBarsReady={onBarsReady}
            hotkeysActive={isActive}
            boldCandles
            userCandleColors
            colorByNetChange
            candlesOnTop
            ema9MatchCandle
            markVolumeExtremes
            volumeLastValue
            volumeMa={50}
            hidePriceLine
            /* Mini-chart declutter: the header already shows the full company
               name + logo, so the big canvas watermark is redundant — off
               entirely. And suppress the viewer's own journal trade markers
               (they plaster a small cell). */
            hideWatermark
            hideJournalOverlay
            carryDragPlacement={false}
            keepPresentOnSymbolChange
            dragMeasure
            verticalLegend
            lockWatermark
            rightPadBars={6}
            dailyDefaultBars={dailyDefaultBars || 126}
            volumeSeparatePane
            volumePaneHeightPct={volPanePct ?? 9}
            priceScaleTopMargin={0.12}
            priceScaleBottomMargin={0.10}
            canvasTheme={canvasTheme}
            settingsOverride={settingsOverride}
            sessionView={sessionView}
            hideExtHoursToolbarToggle
          />
        ) : (
          <button
            type="button"
            className={styles.cellEmpty}
            onClick={() => searchRef.current?.openWith('')}
          >
            <span className={styles.cellEmptyPlus}>+</span>
            {scanning ? 'Type a ticker → fill its group' : 'Add ticker'}
          </button>
        )}
        {flagToast && (
          <div className={wsStyles.flagToast}>
            {flagToast === 'flagged' ? `⚑ ${sym} added to Flagged` : `${sym} removed from Flagged`}
          </div>
        )}
        {ctxToast && <div className={wsStyles.flagToast}>{ctxToast}</div>}
      </div>

      {ctxMenu && (
        <>
          <div
            className={wsStyles.chartCtxBackdrop}
            onClick={closeCtx}
            onContextMenu={(e) => { e.preventDefault(); closeCtx() }}
          />
          <div className={wsStyles.chartCtxMenu} style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
            {Number.isFinite(ctxMenu.price) && (
              <button type="button" className={wsStyles.chartCtxItem} onClick={handleSetAlert}>
                <UIcon name="bell" size={14} className={wsStyles.chartCtxIcon} />
                Set alert @ ${ctxMenu.price.toFixed(2)}
              </button>
            )}
            <button type="button" className={wsStyles.chartCtxItem} onClick={() => { ctxMenu.resetView?.(); closeCtx() }}>
              <UIcon name="refresh" size={14} className={wsStyles.chartCtxIcon} />Reset view
            </button>
            <button type="button" className={wsStyles.chartCtxItem} onClick={() => { onOpenSettings?.(); closeCtx() }}>
              <UIcon name="gear" size={14} className={wsStyles.chartCtxIcon} />Chart settings
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(GridChartCell)
