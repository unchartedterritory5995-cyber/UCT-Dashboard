import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import ChartMetaRow from '../../../components/chart/pane/ChartMetaRow'
import ChartIdentityRow from '../../../components/chart/pane/ChartIdentityRow'
import ChartTfBar from '../../../components/chart/pane/ChartTfBar'
import ShareToFloor from '../../../components/community/ShareToFloor'
import { useWorkspace } from '../WorkspaceContext'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { getExtSessionCached } from '../../../utils/extSession'
import { useFlagged } from '../../../hooks/useFlagged'
import useWatchlistAlerts from '../../../hooks/useWatchlistAlerts'
import AiSearchWidget from './AiSearchWidget'
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import usePreferences from '../../../hooks/usePreferences'
import useThemeIndexBars from '../../../hooks/useThemeIndexBars'
import useTickerMeta from '../../../hooks/useTickerMeta'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import UIcon from '../../../components/ui/UIcon'
import ChartSettingsModal from '../../../components/chart/ChartSettingsModal'
import { VOLUME_PANE_SURFACE_FIXED } from '../../../components/chart/indicatorRegistry'
import LeverageInverseControl from './LeverageInverseControl'
import { tfLabel, tfSortKey } from '../../../components/chart/timeframes'
import styles from '../ChartsWorkspace.module.css'
import { TF_ORDER, shortcutClaimsKey } from '../../../components/chart/keyboardShortcuts'
import ChartTabStrip from './ChartTabStrip'
import {
  sanitizeChartTabs, chartTabList, addChartTab, closeChartTab,
  setActiveChartTab, renameChartTab, patchChartTab,
} from '../chartTabs'

// Labels for the timeframe bar. Order comes from TF_ORDER so the bar and the
// keyboard ladder can never drift apart.
const TF_LABELS = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', 'D': '1D', 'W': '1W', 'M': '1M',
}
const TFS = TF_ORDER.map(code => [code, TF_LABELS[code]])

// Letters only, no modifier combos. Period allowed for class-share tickers
// (BRK.B). Digits are deliberately EXCLUDED — they are timeframe shortcuts,
// and no US ticker starts with a digit. Once the search box has focus it
// accepts digits normally; this regex only decides what OPENS it.
const TICKER_KEY_RE = /^[A-Za-z.]$/

export default function ChartWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, crosshairBus, aiSearchBus, chartsTheme, activeChartRef } = useWorkspace()
  const { createAlert } = useWatchlistAlerts()

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
  const [flagToast, setFlagToast] = useState(null)
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1400)
    return () => clearTimeout(t)
  }, [flagToast])

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
  const companyName = meta?.name || sym
  const indexLabel = themeIdx.isIndex
    ? (themeIdx.name || sym.replace(/^\$IDX:/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    : null
  const setTf = useCallback((nextTf) => {
    if (nextTf === tf) return
    if (isMainTab) onOptsChange?.({ ...(opts || {}), tf: nextTf })
    else if (activeExtra) onOptsChange?.(patchChartTab(opts, activeExtra.id, { tf: nextTf }))
  }, [opts, tf, onOptsChange, isMainTab, activeExtra])

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
  const _extSess = getExtSessionCached()
  const extEnabled = _extSess.session === 'pre' || _extSess.session === 'post'
  const extLabel = _extSess.session === 'pre' ? 'Include pre-market' : 'Include post-market'

  // ── Intraday extended-hours toggle ("Regular Hours" / "Extended Hours") ──
  // On intraday timeframes the D/W/M session toggle above is hidden; this pair
  // replaces the old chart-toolbar EXT/RTH button, moved up here beside the clock.
  // Backed by the shared `extendedHoursShading` chart setting (StockChart reads
  // the same pref, so they stay in lockstep). ON = pre/post bars show; OFF =
  // regular session only (9:30–4:00 ET) with overnight gaps.
  const { prefs, setPref } = usePreferences()
  // EVERY chart surface in the workspace owns its OWN settings, so editing one
  // widget (or tab) never touches another or the dashboard. The global blob is
  // only the SEED/default: a widget/tab that hasn't been edited yet inherits it
  // (so existing layouts look identical), and NEW widgets start from it; the
  // moment you change a setting it's stored on that surface's own blob in `opts`
  // and diverges. Main tab → opts.settings; extra tab → its chartTabs[i].settings.
  const activeStoredSettings = isMainTab ? (opts?.settings || null) : (activeExtra?.settings || null)
  // Identity-stable full-blob override handed to StockChart (null = inherit global).
  const settingsOverride = useMemo(() => activeStoredSettings || null, [activeStoredSettings])
  // Per-surface settings resolution + the single write sink for the ACTIVE
  // surface. Passing `onStore` is what keeps this widget/tab's writes OUT of
  // the global chart_settings pref — that isolation is the whole point (the
  // "editing one chart changes the other" bug was every widget sharing the one
  // global blob) and it holds even on a brand-new widget whose
  // `activeStoredSettings` is still null (see useChartSurfaceSettings).
  const { cs: chartCs, menuVars, write: writeActiveSettings, patchHeader } = useChartSurfaceSettings({
    stored: activeStoredSettings,
    onStore: (next) => {
      if (isMainTab) onOptsChange?.({ ...(opts || {}), settings: next })
      else if (activeExtra) onOptsChange?.(patchChartTab(opts, activeExtra.id, { settings: next }))
    },
    chartsTheme,
  })
  const extHoursOn = chartCs.extendedHoursShading ?? true

  // Header customization (Chart Settings → Header). Title mode, visible timeframe
  // buttons, day-change, info stats, and the on-chart legend are all user-toggled.
  const hdr = chartCs.header
  const headerLabel = themeIdx.isIndex
    ? indexLabel
    : hdr.titleMode === 'ticker'
      ? sym
      : hdr.titleMode === 'both'
        ? (companyName && companyName !== sym ? `${sym} (${companyName})` : sym)
        : companyName
  // Favorites row: any code (native or custom) rendered via tfLabel; the active TF
  // is always shown even if it isn't favorited (so a just-picked custom interval
  // stays visible). Falls back to the native set when the user has no favorites.
  const visibleTfs = (() => {
    const fav = Array.isArray(hdr.timeframes) ? hdr.timeframes : []
    const codes = fav.length ? [...fav] : TFS.map(([c]) => c)
    if (tf && !codes.includes(tf)) codes.push(tf)
    // Always lowest→highest duration, so a newly-favorited 1m lands at the front,
    // not wherever it was added (1m before … before 1D before 1M).
    codes.sort((a, b) => tfSortKey(a) - tfSortKey(b))
    return codes.map(c => [c, tfLabel(c)])
  })()
  const customTfs = Array.isArray(hdr.customTimeframes) ? hdr.customTimeframes : []
  const toggleTfFav = useCallback((code) => {
    const fav = Array.isArray(hdr.timeframes) ? hdr.timeframes : []
    patchHeader({ timeframes: fav.includes(code) ? fav.filter(c => c !== code) : [...fav, code] })
  }, [hdr.timeframes, patchHeader])
  const addCustomTf = useCallback((code) => {
    if (!customTfs.includes(code)) patchHeader({ customTimeframes: [...customTfs, code] })
    setTf(code)
  }, [customTfs, patchHeader, setTf])
  const removeCustomTf = useCallback((code) => {
    const fav = Array.isArray(hdr.timeframes) ? hdr.timeframes : []
    patchHeader({ customTimeframes: customTfs.filter(c => c !== code), timeframes: fav.filter(c => c !== code) })
  }, [customTfs, hdr.timeframes, patchHeader])
  // Per-item header color overrides (Chart Settings → Header → Show). Absent = the
  // item keeps its built-in color (see chartDefaults header.colors).
  const hdrColors = hdr.colors || {}
  const setExtHours = useCallback((on) => {
    writeActiveSettings({ ...chartCs, extendedHoursShading: on, preset: 'custom' })
  }, [chartCs, writeActiveSettings])

  // New chart-settings modal (opened by the button above the clock). Persists the
  // whole merged settings object to the shared chart_settings pref; StockChart reads
  // the same pref so changes apply live.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const updateChartSettings = useCallback((next) => {
    writeActiveSettings(next)
  }, [writeActiveSettings])
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
    setGroupSym(activeColor, s)
    requestAnimationFrame(() => {
      focusableRef.current?.focus({ preventScroll: true })
    })
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
    // A bound chart shortcut beats ticker search — EXCEPT a letter, which is a
    // ticker character first (uppercase included). See shortcutClaimsKey.
    if (shortcutClaimsKey(e)) return
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
    <div className={styles.chartWidget} onPointerEnter={markActive} onFocusCapture={markActive}>
      {/* Chart tab strip — renders only once ≥1 extra tab exists, so a single-chart
          widget is visually unchanged. Each tab is an independent chart profile. */}
      {extraTabs.length > 0 && (
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
      )}
      {/* Top border row: logo + company name + day $/% change — sits above the
          timeframe/meta row so a long company name never pushes the session
          toggle + clock onto a second line. */}
      <ChartIdentityRow
        searchRef={searchRef}
        sym={sym}
        displayLabel={headerLabel}
        labelColor={hdrColors.title || null}
        logoSym={themeIdx.isIndex ? null : sym}
        brandLogo={themeIdx.isIndex}
        boundsRef={focusableRef}
        themeVars={menuVars}
        onSymbolChange={handleSymbolChange}
        showChange={hdr.showChange && !(themeIdx.isIndex && !idxGain)}
        dayGain={themeIdx.isIndex ? idxGain : null}
        dayGainColors={{
          up: hdrColors.dayChangeUp || (chartsTheme === 'sunrise' ? '#0a5c22' : '#1ae51a'),
          down: hdrColors.dayChangeDown || (chartsTheme === 'sunrise' ? '#7d1620' : '#ff3b47'),
        }}
        session={isDWMtf
          ? { mode: 'dwm', view: sessionView, onView: setSessionView, extEnabled, extLabel }
          : { mode: 'intraday', extHoursOn, onExtHours: setExtHours }}
        showClock
        styles={styles}
      />
      <ChartTfBar
        tf={tf}
        visibleTfs={visibleTfs}
        onTf={setTf}
        menu={{
          favorites: Array.isArray(hdr.timeframes) ? hdr.timeframes : [],
          customCodes: customTfs,
          onToggleFav: toggleTfFav,
          onAddCustom: addCustomTf,
          onRemoveCustom: removeCustomTf,
          themeVars: menuVars,
        }}
        styles={styles}
      >
        <ChartMetaRow
          marketCap={mktCap}
          nextEarnings={nextEarnStr}
          uctRating={uctRating}
          show={{ marketCap: hdr.showMarketCap, nextEarnings: hdr.showNextEarnings, uctRating: hdr.showUctRating }}
          colors={hdrColors}
          styles={styles}
        />
        <div className={styles.tfBarRight}>
          {!themeIdx.isIndex && (
            <LeverageInverseControl sym={sym} onSelect={handleSymbolChange} themeVars={menuVars} />
          )}
          {/* Add-tab entry point — only when the strip isn't showing yet (0 extra
              tabs). Once a tab exists, the strip's own + button takes over. */}
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
          {/* Chart settings gear — moved down next to Share to the Floor. */}
          <button
            type="button"
            className={styles.chartSettingsBtn}
            onClick={() => setSettingsOpen(true)}
            title="Chart settings"
            aria-label="Chart settings"
          >
            <UIcon name="gear" size={15} />
          </button>
          <ShareToFloor card={{ kind: 'chart', ticker: sym, tf }} compact />
        </div>
      </ChartTfBar>
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
          /* Per-surface settings isolation: this widget/tab's own full settings
             blob (null = inherit the global default). onSettingsPersist routes
             ALL of StockChart's internal settings writes to writeActiveSettings
             so nothing ever hits the shared global pref → editing one chart
             never changes another. */
          settingsOverride={settingsOverride}
          onSettingsPersist={writeActiveSettings}
          onSymbolChange={handleSymbolChange}
          onTfChange={setTf}
          /* Share the same saved-color swatches with the drawing color picker. */
          savedColors={savedColors}
          onSaveColor={saveColor}
          onDeleteColor={deleteColor}
          onOpenSettings={() => setSettingsOpen(true)}
          onCrosshairMove={reportCrosshair}
          subscribeCrosshair={subscribeCrosshair}
          hotkeysActive={hotkeysIsActive}
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
          userCanvas
          colorByNetChange
          candlesOnTop
          ema9MatchCandle
          markVolumeExtremes
          volumeLastValue
          volumeMa={50}
          hidePriceLine
          /* Charts workspace is a clean charting surface — never overlay the
             viewer's Journal 2.0 / connected-brokerage BUY/SELL trade markers
             (or entry/stop lines) here. Those belong on the Journal tab. */
          hideJournalOverlay
          /* Watermark opacity is user-controllable via Chart Settings → Canvas.
             The settings default (0.07, the global faint default) is treated as
             "unset" → the workspace's strong 0.82; any value the user picks wins.
             Other surfaces keep the global 0.07 default (they don't pass this). */
          watermarkOpacity={chartCs.watermark.opacity === 0.07 ? 0.82 : chartCs.watermark.opacity}
          centerWatermarkOnPlot
          carryDragPlacement={false}
          keepPresentOnSymbolChange
          dragMeasure
          verticalLegend
          lockWatermark
          alwaysShowLegend
          hideLegend={!hdr.showLegend}
          legendColor={hdrColors.legend || null}
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
            <button type="button" className={styles.chartCtxItem} onClick={() => { setSettingsOpen(true); closeCtx() }}>
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
      <ChartSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={chartCs}
        onChange={updateChartSettings}
        savedColors={savedColors}
        onSaveColor={saveColor}
        onDeleteColor={deleteColor}
        themeVars={menuVars}
        /* This widget passes volumeSeparatePane + volumePaneHeightPct below, and
           StockChart lets those props WIN over volume.separatePane /
           volume.paneHeightPct. Tell the modal so those two settings render inert
           here instead of looking live and doing nothing. */
        volumePaneFixed={VOLUME_PANE_SURFACE_FIXED}
      />
    </div>
  )
}
