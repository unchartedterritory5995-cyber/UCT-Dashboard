import { useCallback, useEffect, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import ShareToFloor from '../../../components/community/ShareToFloor'
import ChartMarketClock from './ChartMarketClock'
import { useWorkspace } from '../WorkspaceContext'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { getExtSession } from '../../../utils/extSession'
import { useFlagged } from '../../../hooks/useFlagged'
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import usePreferences from '../../../hooks/usePreferences'
import useThemeIndexBars from '../../../hooks/useThemeIndexBars'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import ChartDayGain from './ChartDayGain'
import styles from '../ChartsWorkspace.module.css'

const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

// Letter or digit, no modifier combos. Period allowed for class-share tickers (BRK.B).
const TICKER_KEY_RE = /^[A-Za-z0-9.]$/

export default function ChartWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, crosshairBus } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { data: fund } = useFundamentalSnapshot(sym)
  const mktCap = fund?.metrics?.market_cap || null
  const nextEarnStr = (() => {
    const iso = fund?.next_earnings
    if (!iso) return null
    const [y, mo, da] = String(iso).split('-').map(Number)
    return (y && mo && da) ? `${mo}/${da}/${y}` : null
  })()

  // UCT rating (composite 1–99) — colored by tier.
  const uctRating = Number.isFinite(fund?.composite) ? fund.composite : null
  const ratingColor = uctRating == null ? '#9b9684'
    : uctRating >= 80 ? '#22c45c' : uctRating >= 60 ? '#7fb26a' : uctRating >= 40 ? '#c9a84c' : '#c07a63'
  const [flagToast, setFlagToast] = useState(null)
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1400)
    return () => clearTimeout(t)
  }, [flagToast])

  // ── Crosshair sync within the color group ──
  // Stable per-widget id so we ignore our own broadcasts. Charts sharing a
  // color group mirror each other's crosshair (same symbol; exact when the
  // timeframes match, nearest-time when they differ).
  const widgetIdRef = useRef(null)
  if (!widgetIdRef.current) widgetIdRef.current = `w${Math.random().toString(36).slice(2, 9)}`
  const [externalCrosshair, setExternalCrosshair] = useState(null)

  const reportCrosshair = useCallback((payload) => {
    crosshairBus?.emit(color, widgetIdRef.current, payload)
  }, [crosshairBus, color])

  useEffect(() => {
    if (!crosshairBus) return undefined
    return crosshairBus.subscribe(({ color: c, sourceId, payload }) => {
      if (c === color && sourceId !== widgetIdRef.current) setExternalCrosshair(payload)
    })
  }, [crosshairBus, color])
  // Drop any stale external crosshair when this widget's own symbol changes.
  useEffect(() => { setExternalCrosshair(null) }, [sym])
  const tf = opts?.tf || 'D'
  // Thematic-ETF pseudo-ticker ("$IDX:<slug>"): render the theme's equal-weight
  // index via barsOverride (D/W/M only). Normal tickers: themeIdx.isIndex=false.
  const themeIdx = useThemeIndexBars(sym, tf)
  const indexTf = ['D', 'W', 'M'].includes(tf) ? tf : 'D'
  // Header shows the COMPANY NAME + logo (not the ticker). For a theme index it's
  // the theme name (no logo). meta.name comes from the shared ticker-meta cache.
  const meta = useTickerMeta(themeIdx.isIndex ? null : sym)
  const headerLabel = themeIdx.isIndex
    ? (themeIdx.name || sym.replace(/^\$IDX:/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    : (meta?.name || sym)
  const setTf = useCallback((nextTf) => {
    if (nextTf === tf) return
    onOptsChange?.({ ...(opts || {}), tf: nextTf })
  }, [opts, tf, onOptsChange])

  // ── Extended-hours session view ("Regular Hours" / "Include pre/post-market") ──
  // Ephemeral per-widget state (not persisted). Defaults to Regular Hours and
  // auto-reverts at the 9:30 bell, staying regular through the RTH session.
  // Only meaningful on D/W/M; the toggle is hidden on intraday.
  const mkt = useMarketOpen()
  const [sessionView, setSessionView] = useState('regular')
  useEffect(() => { if (mkt.isOpen) setSessionView('regular') }, [mkt.isOpen])
  const isDWMtf = ['D', 'W', 'M'].includes(tf)
  // Extended session stays "post-market" from 4pm ET through 4am (post window +
  // overnight), then flips to "pre-market" at 4am. Re-evaluated on the 60s
  // useMarketOpen re-render. `mkt` still drives the 9:30 auto-revert above.
  const _extSess = getExtSession()
  const extEnabled = _extSess.session === 'pre' || _extSess.session === 'post'
  const extLabel = _extSess.session === 'pre' ? 'Include pre-market' : 'Include post-market'

  // ── Intraday extended-hours toggle ("Regular Hours" / "Extended Hours") ──
  // On intraday timeframes the D/W/M session toggle above is hidden; this pair
  // replaces the old chart-toolbar EXT/RTH button, moved up here beside the clock.
  // Backed by the shared `extendedHoursShading` chart setting (StockChart reads
  // the same pref, so they stay in lockstep). ON = pre/post bars show; OFF =
  // regular session only (9:30–4:00 ET) with overnight gaps.
  const { prefs, setPref } = usePreferences()
  const chartCs = mergeChartSettings(prefs.chart_settings)
  const extHoursOn = chartCs.extendedHoursShading ?? true
  const setExtHours = useCallback((on) => {
    const next = { ...mergeChartSettings(prefs.chart_settings), extendedHoursShading: on, preset: 'custom' }
    setPref('chart_settings', JSON.stringify(next))
  }, [prefs.chart_settings, setPref])

  const searchRef = useRef(null)
  const focusableRef = useRef(null)

  // Single ticker-change handler — every path (search dropdown pick, typed
  // submit, StockChart's own onSymbolChange) routes through this. After the
  // sym updates we refocus the chart container so the user can immediately
  // start typing again for the next ticker without re-clicking the chart.
  const handleSymbolChange = useCallback((s) => {
    if (!s) return
    setGroupSym(color, s)
    requestAnimationFrame(() => {
      focusableRef.current?.focus({ preventScroll: true })
    })
  }, [color, setGroupSym])

  const handleChartClick = useCallback(() => {
    // Don't steal focus from a child input (e.g., the open search dropdown).
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    focusableRef.current?.focus({ preventScroll: true })
  }, [])

  const handleChartKeyDown = useCallback((e) => {
    // Bail if the event is bubbling up from an input (search box, etc.).
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    // Shift+F flags the chart's current ticker — works even while interacting with
    // the chart. stopPropagation so it doesn't also fire the theme widget's Shift+F.
    if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation()
      const willFlag = !isFlagged(sym)
      toggleFlag(sym)
      setFlagToast(willFlag ? 'flagged' : 'unflagged')
      return
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (!TICKER_KEY_RE.test(e.key)) return
    e.preventDefault()
    // Swallow the key so it never reaches the drawing-tool (window) or timeframe
    // (document) hotkey handlers — typing a ticker must never trigger a tool or TF.
    e.stopPropagation()
    searchRef.current?.openWith(e.key)
  }, [sym, isFlagged, toggleFlag])

  return (
    <div className={styles.chartWidget}>
      <div className={styles.tfBar}>
        <div className={styles.symbolSlot}>
          <SymbolSearch
            ref={searchRef}
            sym={sym}
            onSymbolChange={handleSymbolChange}
            hideIcon
            logoSym={themeIdx.isIndex ? null : sym}
            displayLabel={headerLabel}
          />
        </div>
        <ChartDayGain sym={sym} />
        <span className={styles.tfBarDivider} aria-hidden="true" />
        {TFS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            className={`${styles.tfBtn} ${tf === code ? styles.tfBtnActive : ''}`}
            onClick={() => setTf(code)}
          >{label}</button>
        ))}
        <div className={styles.chartMeta}>
          <span className={styles.chartMetaItem}>
            <span className={styles.chartMetaLabel}>Market Cap</span>
            <span className={styles.chartMetaVal} style={{ color: '#c9a84c' }}>{mktCap || '—'}</span>
          </span>
          <span className={styles.chartMetaItem}>
            <span className={styles.chartMetaLabel}>Next Earnings</span>
            <span className={styles.chartMetaVal} style={{ color: '#6ba3be' }}>{nextEarnStr || '—'}</span>
          </span>
          <span className={styles.chartMetaItem}>
            <span className={styles.chartMetaLabel}>UCT Rating</span>
            <span className={styles.chartMetaVal} style={{ color: ratingColor }}>{uctRating != null ? uctRating : '—'}</span>
          </span>
        </div>
        <div className={styles.tfBarRight}>
          {isDWMtf && (
            <div className={styles.sessionToggle} role="group" aria-label="Chart session view">
              <button
                type="button"
                className={`${styles.sessionBtn} ${sessionView === 'regular' ? styles.sessionBtnActive : ''}`}
                onClick={() => setSessionView('regular')}
                title="Regular trading hours only"
              >Regular Hours</button>
              <button
                type="button"
                className={`${styles.sessionBtn} ${sessionView === 'extended' ? styles.sessionBtnActive : ''}`}
                onClick={() => { if (extEnabled) setSessionView('extended') }}
                disabled={!extEnabled}
                title={extEnabled ? extLabel : 'Available during pre-market and post-market'}
              >{extLabel}</button>
            </div>
          )}
          {!isDWMtf && (
            <div className={styles.sessionToggle} role="group" aria-label="Chart extended hours">
              <button
                type="button"
                className={`${styles.sessionBtn} ${!extHoursOn ? styles.sessionBtnActive : ''}`}
                onClick={() => setExtHours(false)}
                title="Regular session only (9:30–4:00 ET), overnight gaps"
              >Regular Hours</button>
              <button
                type="button"
                className={`${styles.sessionBtn} ${extHoursOn ? styles.sessionBtnActive : ''}`}
                onClick={() => setExtHours(true)}
                title="Include pre-market + post-market bars"
              >Extended Hours</button>
            </div>
          )}
          <ChartMarketClock />
          <ShareToFloor card={{ kind: 'chart', ticker: sym, tf }} compact />
        </div>
      </div>
      <div
        ref={focusableRef}
        className={styles.chartFill}
        tabIndex={0}
        onClick={handleChartClick}
        onKeyDown={handleChartKeyDown}
      >
        <StockChart
          sym={sym}
          tf={themeIdx.isIndex ? indexTf : tf}
          {...(themeIdx.isIndex ? {
            barsOverride: themeIdx.bars,
            barsOverridePending: themeIdx.loading,
            // Watermark: theme name on top, "<theme> Index" below — not the raw $IDX symbol.
            watermark: themeIdx.name || sym.replace(/^\$IDX:/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            watermarkName: `${themeIdx.name || sym.replace(/^\$IDX:/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Index`,
            liveUpdates: false,
          } : {})}
          onSymbolChange={handleSymbolChange}
          onTfChange={setTf}
          onCrosshairMove={reportCrosshair}
          externalCrosshair={externalCrosshair}
          /* The intraday EXT/RTH toggle now lives in the widget header (beside the
             clock), so suppress the duplicate button in the chart toolbar. */
          hideExtHoursToolbarToggle
          /* Charts-workspace default look = the Model Book "Throughout the
             Years" main chart, 1:1. boldCandles brings the crisp bold vivid
             palette (MB_UP/MB_DOWN solid bodies + deep #0e0f0d canvas), thin
             0.5px curved MAs, and vivid volume bars; volumeMa + markVolumeExtremes
             add the MB volume MA line + gold highest-volume bar. Plus a ~6-month
             daily window, its own compact volume pane, and tight price-scale
             margins so candles fill ~85% of the pane. Scoped here so popups /
             Model Book / Journal charts are unaffected. */
          boldCandles
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
          alwaysShowLegend
          rightPadBars={6}
          dailyDefaultBars={126}
          volumeSeparatePane
          volumePaneHeightPct={12}
          priceScaleTopMargin={0.12}
          priceScaleBottomMargin={0.10}
          sessionView={sessionView}
        />
        {flagToast && (
          <div className={styles.flagToast}>
            {flagToast === 'flagged' ? `⚑ ${sym} added to Flagged` : `${sym} removed from Flagged`}
          </div>
        )}
      </div>
    </div>
  )
}
