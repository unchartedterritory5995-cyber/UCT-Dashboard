// app/src/pages/charts/grid/GridChartCell.jsx
//
// One cell of the Multi-Chart grid: a controlled {sym, tf} chart composed on
// StockChart directly (NOT ChartWidget — the workspace widget's symbol comes
// from the 4-color-group model, which caps independent tickers at 4, and its
// per-cell data fan-out (fundamentals/meta/theme-index) is too heavy ×16).
// Chrome is deliberately minimal: SymbolSearch badge, compact TF select,
// ChartDayGain, Shift+F flag toast. Everything else (gear/settings, session
// toggles, market clock, share) lives at the grid-container level or not at
// all in v1. Exported as React.memo — the container hands every prop with a
// stable identity so a mouse sweep across the grid re-renders zero charts.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import ChartDayGain from '../widgets/ChartDayGain'
import { useFlagged } from '../../../hooks/useFlagged'
import useWatchlistAlerts from '../../../hooks/useWatchlistAlerts'
import UIcon from '../../../components/ui/UIcon'
import wsStyles from '../ChartsWorkspace.module.css'
import styles from './MultiChartGrid.module.css'

const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

// Letter or digit, no modifier combos. Period allowed for class-share tickers (BRK.B).
const TICKER_KEY_RE = /^[A-Za-z0-9.]$/

function GridChartCell({
  cell,               // {id, sym|null, tf} — controlled; sym null = empty slot
  onChange,           // (nextCell) => void — container merges + debounce-persists
  crosshairBus,       // {emit(sourceId,payload), subscribe(fn)} | null (null = sync off)
  volPanePct,         // shared charts_vol_pane_pct value (cells read, never write)
  isActive,           // () => boolean — active-cell gate for StockChart hotkeys
  dailyDefaultBars,   // container passes 90 on dense grids (>9 cells), else 126
  canvasTheme,        // 'sunrise' | null — threaded from WorkspaceContext
  onOpenSettings,     // opens the grid's ONE shared ChartSettingsModal
  onBarsReady,        // () => void — releases this cell's mount-queue slot
}) {
  const sym = cell.sym
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
  const [externalCrosshair, setExternalCrosshair] = useState(null)
  const reportCrosshair = useCallback((payload) => {
    crosshairBus?.emit(cellIdRef.current, payload)
  }, [crosshairBus])
  useEffect(() => {
    // Empty cells never subscribe — no state churn at mousemove rate for a
    // slot that has no chart to move a crosshair on.
    if (!crosshairBus || !sym) return undefined
    return crosshairBus.subscribe(({ sourceId, payload }) => {
      if (sourceId !== cellIdRef.current) setExternalCrosshair(payload)
    })
  }, [crosshairBus, sym])
  // Drop stale external crosshairs when the symbol changes…
  useEffect(() => { setExternalCrosshair(null) }, [sym])
  // …and when the Sync toggle flips OFF (bus → null): StockChart only clears
  // an applied external crosshair when the prop BECOMES null, so without this
  // every non-hovered cell keeps a frozen crosshair line.
  useEffect(() => { if (!crosshairBus) setExternalCrosshair(null) }, [crosshairBus])

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
      <div className={styles.cellHeader}>
        <span className={styles.cellSymWrap}>
          <SymbolSearch
            ref={searchRef}
            sym={sym || ''}
            onSymbolChange={handleSymbolChange}
          />
        </span>
        {sym && <ChartDayGain sym={sym} />}
        <select
          className={styles.cellTfSelect}
          value={cell.tf}
          onChange={(e) => handleTfChange(e.target.value)}
          aria-label="Timeframe"
        >
          {TFS.map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
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
            externalCrosshair={externalCrosshair}
            /* Grid lite profile — the workspace chart look without the
               speculative warms, patterns, or per-instance hotkey ownership.
               hideReplay/hidePatterns/hideCompare are inert today (the toolbar
               only mounts under showDrawingTools) — kept as future-proofing
               for the v2 drawing-tools flip. */
            showDrawingTools={false}
            hideReplay
            hidePatterns
            hideCompare
            hideCountdown
            disablePatterns
            backgroundWarm={false}
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
            watermarkOpacity={0.82}
            centerWatermarkOnPlot
            carryDragPlacement={false}
            keepPresentOnSymbolChange
            dragMeasure
            verticalLegend
            lockWatermark
            rightPadBars={6}
            dailyDefaultBars={dailyDefaultBars || 126}
            volumeSeparatePane
            volumePaneHeightPct={volPanePct ?? 12}
            priceScaleTopMargin={0.12}
            priceScaleBottomMargin={0.10}
            canvasTheme={canvasTheme}
          />
        ) : (
          <button
            type="button"
            className={styles.cellEmpty}
            onClick={() => searchRef.current?.openWith('')}
          >
            <span className={styles.cellEmptyPlus}>+</span>
            Add ticker
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
