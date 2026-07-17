import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import ShareToFloor from '../../../components/community/ShareToFloor'
import ChartMarketClock from './ChartMarketClock'
import { useWorkspace } from '../WorkspaceContext'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { getExtSession } from '../../../utils/extSession'
import { useFlagged } from '../../../hooks/useFlagged'
import useWatchlistAlerts from '../../../hooks/useWatchlistAlerts'
import AiSearchWidget from './AiSearchWidget'
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import usePreferences from '../../../hooks/usePreferences'
import useThemeIndexBars from '../../../hooks/useThemeIndexBars'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import UIcon from '../../../components/ui/UIcon'
import ChartDayGain from './ChartDayGain'
import ChartSettingsModal from '../../../components/chart/ChartSettingsModal'
import styles from '../ChartsWorkspace.module.css'

const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

// Letter or digit, no modifier combos. Period allowed for class-share tickers (BRK.B).
const TICKER_KEY_RE = /^[A-Za-z0-9.]$/

export default function ChartWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, crosshairBus, aiSearchBus, chartsTheme } = useWorkspace()
  const { createAlert } = useWatchlistAlerts()
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
  const _sun = chartsTheme === 'sunrise'
  const ratingColor = uctRating == null ? (_sun ? '#55606e' : '#9b9684')
    : uctRating >= 80 ? (_sun ? '#0a5c22' : '#22c45c')
    : uctRating >= 60 ? (_sun ? '#0a5c22' : '#7fb26a')
    : uctRating >= 40 ? (_sun ? '#7a5c16' : '#c9a84c')
    : (_sun ? '#7d1620' : '#c07a63')
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
  // A theme index has no live-price feed (it's a synthetic pseudo-ticker), so
  // its header $/% change is the last bar's close vs the prior bar's close.
  const idxGain = useMemo(() => {
    const bars = themeIdx.bars
    if (!themeIdx.isIndex || !Array.isArray(bars) || bars.length < 2) return null
    const last = bars[bars.length - 1], prev = bars[bars.length - 2]
    const c = last?.c ?? last?.close, pc = prev?.c ?? prev?.close
    if (!Number.isFinite(c) || !Number.isFinite(pc) || pc === 0) return null
    const abs = c - pc
    return { abs, pct: (abs / pc) * 100, up: abs >= 0 }
  }, [themeIdx.isIndex, themeIdx.bars])
  // Header shows the COMPANY NAME + logo (not the ticker). For a theme index it's
  // the theme name + the Uncharted Territory brand mark (it has no company ticker,
  // so no logo.dev logo). meta.name comes from the shared ticker-meta cache.
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

  // New chart-settings modal (opened by the button above the clock). Persists the
  // whole merged settings object to the shared chart_settings pref; StockChart reads
  // the same pref so changes apply live.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const updateChartSettings = useCallback((next) => {
    setPref('chart_settings', JSON.stringify(next))
  }, [setPref])
  // User-saved custom colors, shared across every picker in the settings modal.
  const savedColors = useMemo(() => {
    try {
      const raw = prefs.chart_saved_colors
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }, [prefs.chart_saved_colors])
  const saveColor = useCallback((hex) => {
    if (!hex) return
    const h = String(hex).toLowerCase()
    const next = [h, ...savedColors.filter(c => String(c).toLowerCase() !== h)].slice(0, 24)
    setPref('chart_saved_colors', JSON.stringify(next))
  }, [savedColors, setPref])
  const deleteColor = useCallback((hex) => {
    const h = String(hex).toLowerCase()
    setPref('chart_saved_colors', JSON.stringify(savedColors.filter(c => String(c).toLowerCase() !== h)))
  }, [savedColors, setPref])

  // Volume-pane height persists per-user across the charts workspace (default 12%),
  // so dragging the price/volume separator sticks across ticker changes + refresh.
  const volPanePct = (() => {
    const v = Number(prefs?.charts_vol_pane_pct)
    return Number.isFinite(v) && v >= 5 && v <= 60 ? v : 12
  })()
  const volSaveTimerRef = useRef(null)
  const handleVolPaneResize = useCallback((pct) => {
    if (volSaveTimerRef.current) clearTimeout(volSaveTimerRef.current)
    volSaveTimerRef.current = setTimeout(() => setPref('charts_vol_pane_pct', String(pct)), 400)
  }, [setPref])

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
    <div className={styles.chartWidget}>
      {/* Top border row: logo + company name + day $/% change — sits above the
          timeframe/meta row so a long company name never pushes the session
          toggle + clock onto a second line. */}
      <div className={styles.chartHeaderTop}>
        <div className={styles.symbolSlot}>
          <SymbolSearch
            ref={searchRef}
            sym={sym}
            onSymbolChange={handleSymbolChange}
            hideIcon
            fullLabel
            logoSym={themeIdx.isIndex ? null : sym}
            brandLogo={themeIdx.isIndex}
            displayLabel={headerLabel}
          />
        </div>
        {themeIdx.isIndex ? (
          idxGain && (
            <span className={styles.chartDayGain} style={{ color: idxGain.up ? (chartsTheme === 'sunrise' ? '#0a5c22' : '#1ae51a') : (chartsTheme === 'sunrise' ? '#7d1620' : '#ff3b47') }}>
              {idxGain.up ? '+' : ''}{idxGain.abs.toFixed(2)} ({idxGain.up ? '+' : ''}{idxGain.pct.toFixed(2)}%)
            </span>
          )
        ) : (
          <ChartDayGain sym={sym} />
        )}
        {/* Chart settings — opens the centered settings modal. Sits at the top-right
            of the header, directly above the market clock. */}
        <button
          type="button"
          className={styles.chartSettingsBtn}
          onClick={() => setSettingsOpen(true)}
          title="Chart settings"
          aria-label="Chart settings"
        >
          <UIcon name="gear" size={15} />
        </button>
      </div>
      <div className={styles.tfBar}>
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
          onOpenSettings={() => setSettingsOpen(true)}
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
          alwaysShowLegend
          rightPadBars={6}
          dailyDefaultBars={126}
          volumeSeparatePane
          showRangeSelector
          showSma5
          canvasTheme={chartsTheme === 'sunrise' ? 'sunrise' : null}
          volumePaneHeightPct={volPanePct}
          onVolumePaneResize={handleVolPaneResize}
          priceScaleTopMargin={0.12}
          priceScaleBottomMargin={0.10}
          sessionView={sessionView}
          onBarContextMenu={handleBarContextMenu}
        />
        {flagToast && (
          <div className={styles.flagToast}>
            {flagToast === 'flagged' ? `⚑ ${sym} added to Flagged` : `${sym} removed from Flagged`}
          </div>
        )}
        {ctxToast && <div className={styles.flagToast}>{ctxToast}</div>}
      </div>

      {/* ── Chart right-click menu ── */}
      {ctxMenu && (
        <>
          <div
            className={styles.chartCtxBackdrop}
            onClick={closeCtx}
            onContextMenu={(e) => { e.preventDefault(); closeCtx() }}
          />
          <div className={styles.chartCtxMenu} style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
            {Number.isFinite(ctxMenu.price) && (
              <button type="button" className={styles.chartCtxItem} onClick={handleSetAlert}>
                <UIcon name="bell" size={14} className={styles.chartCtxIcon} />
                Set alert @ ${ctxMenu.price.toFixed(2)}
              </button>
            )}
            <button type="button" className={styles.chartCtxItem} onClick={() => { ctxMenu.resetView?.(); closeCtx() }}>
              <UIcon name="refresh" size={14} className={styles.chartCtxIcon} />Reset view
            </button>
            <button type="button" className={styles.chartCtxItem} onClick={() => { ctxMenu.openSettings?.(); closeCtx() }}>
              <UIcon name="gear" size={14} className={styles.chartCtxIcon} />Chart settings
            </button>
            {ctxMenu.hasDrawings && (
              <button type="button" className={styles.chartCtxItem} onClick={() => { ctxMenu.clearDrawings?.(); setCtxToast('Drawings cleared'); closeCtx() }}>
                <UIcon name="trash" size={14} className={styles.chartCtxIcon} />Clear all drawings
              </button>
            )}
            {ctxMenu.bar && (
              <button type="button" className={`${styles.chartCtxItem} ${styles.chartCtxAi}`} onClick={handleAiSearch}>
                <UIcon name="sparkle" size={14} className={styles.chartCtxIcon} />AI search this bar
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
              color={color}
              onTicker={(tk) => { setGroupSym(color, tk); setTempAi(null) }}
            />
          </div>
        </>
      )}
      <ChartSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={chartCs}
        onChange={updateChartSettings}
        savedColors={savedColors}
        onSaveColor={saveColor}
        onDeleteColor={deleteColor}
      />
    </div>
  )
}
