import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react'
import StockChart from '../../StockChart'
import ChartMetaRow from './ChartMetaRow'
import ChartIdentityRow from './ChartIdentityRow'
import ChartTfBar from './ChartTfBar'
import useChartSurfaceSettings from './useChartSurfaceSettings'
import ChartSettingsModal from '../ChartSettingsModal'
import UIcon from '../../ui/UIcon'
import { VOLUME_PANE_SURFACE_FIXED } from '../indicatorRegistry'
import { tfLabel, tfSortKey } from '../timeframes'
import { TF_ORDER, shortcutClaimsKey } from '../keyboardShortcuts'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { getExtSessionCached } from '../../../utils/extSession'
import { useFlagged } from '../../../hooks/useFlagged'
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import useWatchlistPerformance from '../../../hooks/useWatchlistPerformance'
import useWatchlistMeta from '../../../hooks/useWatchlistMeta'
import useWatchlistThemes from '../../../hooks/useWatchlistThemes'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import {
  HEADER_FIELD_BY_KEY, PERF_HEADER_KEYS, QUOTE_HEADER_KEYS, META_HEADER_KEYS,
  THEME_HEADER_KEYS, headerFieldKeys, resolveHeaderField,
} from '../headerFields'
import usePreferences from '../../../hooks/usePreferences'
import useThemeIndexBars from '../../../hooks/useThemeIndexBars'
import useTickerMeta from '../../../hooks/useTickerMeta'
// Phase-A carried debt (see the design doc): the pane still reads the charts
// workspace's CSS module rather than owning its own. Moving the rules would
// change every hashed class name in the same commit as the extraction and make
// the diff unreviewable — it moves in Phase C.
import styles from '../../../pages/charts/ChartsWorkspace.module.css'

// Letters only, no modifier combos. Period allowed for class-share tickers
// (BRK.B). Digits are deliberately EXCLUDED — they are timeframe shortcuts,
// and no US ticker starts with a digit. Once the search box has focus it
// accepts digits normally; this regex only decides what OPENS it.
const TICKER_KEY_RE = /^[A-Za-z.]$/

const DWM = ['D', 'W', 'M']

/**
 * ChartPane — the chart shell every surface mounts.
 *
 * It owns everything that is true of a chart no matter where it lives: the
 * identity row, the timeframe bar, the meta strip, the settings resolution +
 * modal, the focus surface with click-to-focus / type-to-search, and the
 * StockChart itself with the reference (`/charts`) look.
 *
 * Props
 *   sym, tf                required; the host owns both
 *   onSymbolChange         omit to LOCK the symbol — the identity row then
 *                          renders a static label (trade drawer, drill modal)
 *   onTfChange             (code) => void
 *   density                "full" | "compact" | "mini"; compact drops the meta
 *                          row, the session toggle and the clock (keeps
 *                          identity + TFs + the settings gear). mini drops all
 *                          of that PLUS the identity row and the settings gear
 *                          — only the timeframe bar and the chart render. Both
 *                          compact and mini skip the fundamentals fetch.
 *   stored / onStore       settings routing, straight through to
 *                          useChartSurfaceSettings: stored=null with no onStore
 *                          means this surface IS the user's one chart — it reads
 *                          the first /charts chart widget's settings (falling
 *                          back to the chart_settings seed) and, because that
 *                          read now outranks the global pref, renders NO
 *                          settings gear (editing here would write a
 *                          lower-priority layer that visibly does nothing —
 *                          settings stay editable on /charts, where they're
 *                          edited anyway); passing onStore isolates this surface
 *   chartsTheme            'default' | 'sunrise'
 *   stockChartProps        per-surface StockChart passthrough (crosshair bus,
 *                          hotkey arbitration, priceLines, markers, …)
 *   slots                  host chrome: {top, headerRight, tfBarRight, tfBarEnd,
 *                          overlay}
 *   onActivate             fired on pointer-enter / focus-capture of the pane
 *                          root (the workspace uses it to arbitrate hotkeys)
 *   showTfBar              default true; false OMITS the timeframe bar (and the
 *                          meta row / settings gear / tfBarRight-tfBarEnd slots
 *                          riding inside it) entirely — a surface that locks the
 *                          timeframe (Journal Daily/Weekly-only, a small popup)
 *                          renders none of that row rather than a row of dead
 *                          buttons
 *   tfCodes                default null; when an array is supplied it REPLACES
 *                          the user's favorited timeframes as the only codes
 *                          the bar offers (no auto-add of the current `tf`) —
 *                          the host is choosing the timeframe set, not the user
 *
 * ref → { openSettings(), focus(), changeSymbol(sym) }
 */
function ChartPane({
  sym,
  tf,
  onSymbolChange = null,
  onTfChange = null,
  density = 'full',
  stored = null,
  onStore = null,
  chartsTheme = null,
  stockChartProps = null,
  slots = null,
  onActivate = undefined,
  showTfBar = true,
  tfCodes = null,
}, ref) {
  const compact = density === 'compact'
  // mini renders ONLY the timeframe bar + the chart — no identity row, no meta
  // row, no session toggle, no market clock, no settings gear. For ~320px-tall
  // popups where the full shell leaves no room for candles.
  const mini = density === 'mini'
  // stored=null with no onStore is "this surface IS the user's one chart" (see
  // useChartSurfaceSettings + the density/stored doc above): its read now
  // resolves from the /charts workspace, so a settings write here would land
  // on a lower-priority layer and appear to do nothing. Hide the gear rather
  // than offer an edit that silently no-ops. A workspace widget/tab ALWAYS
  // passes onStore (even before its first edit, when stored is still null),
  // so this must key off both, not `stored` alone.
  const isOwnChartSurface = stored === null && !onStore

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  // Fundamentals feed ONLY ChartMetaRow, which `compact`/`mini` density drops
  // entirely (and which never renders at all when `showTfBar` is false, since
  // the meta row lives inside the TF bar). Gate the fetch — and its 5-min poll
  // loop — on whether that row can even render, so a compact/mini/no-tf-bar
  // pane across ~20 surfaces never opens a request it can't show.
  const { data: fund } = useFundamentalSnapshot(sym, !compact && !mini && showTfBar)
  const [flagToast, setFlagToast] = useState(null)
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1400)
    return () => clearTimeout(t)
  }, [flagToast])

  // Thematic-ETF pseudo-ticker ("$IDX:<slug>"): render the theme's equal-weight
  // index via barsOverride (D/W/M only). Normal tickers: themeIdx.isIndex=false.
  const themeIdx = useThemeIndexBars(sym, tf)
  const indexTf = DWM.includes(tf) ? tf : 'D'
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

  // ── Extended-hours session view ("Regular Hours" / "Include pre/post-market") ──
  // Only meaningful on D/W/M; the toggle is hidden on intraday. PERSISTED per-surface
  // via chart settings (see sessionView below) so the user's choice STICKS across
  // refreshes + market open/close until they switch back to Regular Hours — it no
  // longer resets to Regular on refresh or at the 9:30 bell (owner ask). useMarketOpen
  // is still called for its 60s re-render, which refreshes the ext-session window
  // (extEnabled/extLabel) used by the toggle below.
  useMarketOpen()
  const isDWMtf = DWM.includes(tf)
  // Extended session stays "post-market" from 4pm ET through 4am (post window +
  // overnight), then flips to "pre-market" at 4am. Re-evaluated on the 60s
  // useMarketOpen re-render. `mkt` still drives the 9:30 auto-revert above.
  const _extSess = getExtSessionCached()
  const extEnabled = _extSess.session === 'pre' || _extSess.session === 'post'
  const extLabel = _extSess.session === 'pre' ? 'Include pre-market' : 'Include post-market'

  const { prefs, setPref } = usePreferences()
  // Per-surface settings resolution + the single write sink. `stored`/`onStore`
  // come straight from the host: a workspace widget/tab passes both (writes stay
  // on its own blob), a popup passes neither (reads AND writes the user's global
  // chart_settings — "your chart, everywhere").
  const {
    cs: chartCs, menuVars, write: writeActiveSettings, patchHeader, ownChartSource, theme: resolvedTheme } = useChartSurfaceSettings({
    stored,
    onStore,
    chartsTheme,
  })
  const extHoursOn = chartCs.extendedHoursShading ?? true

  // D/W/M "Include pre/post-market" view. Local state for an instant toggle, SEEDED
  // and re-hydrated from the persisted chart setting, and persisted on change — so it
  // responds immediately AND survives refreshes + market open/close (it no longer
  // resets to Regular). Writing rides the same settings sink as every other chart pref.
  const [sessionView, setSessionViewState] = useState(() => (chartCs.sessionView === 'extended' ? 'extended' : 'regular'))
  useEffect(() => {
    setSessionViewState(chartCs.sessionView === 'extended' ? 'extended' : 'regular')
  }, [chartCs.sessionView])
  const setSessionView = useCallback((v) => {
    const nv = v === 'extended' ? 'extended' : 'regular'
    setSessionViewState(nv)
    writeActiveSettings({ ...chartCs, sessionView: nv, preset: 'custom' })
  }, [chartCs, writeActiveSettings])

  // ── Intraday extended-hours toggle ("Regular Hours" / "Extended Hours") ──
  // On intraday timeframes the D/W/M session toggle above is hidden; this pair
  // replaces the old chart-toolbar EXT/RTH button, moved up here beside the clock.
  // Backed by the shared `extendedHoursShading` chart setting (StockChart reads
  // the same pref, so they stay in lockstep). ON = pre/post bars show; OFF =
  // regular session only (9:30–4:00 ET) with overnight gaps.
  const setExtHours = useCallback((on) => {
    writeActiveSettings({ ...chartCs, extendedHoursShading: on, preset: 'custom' })
  }, [chartCs, writeActiveSettings])

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
  // A host that passes `tfCodes` (Journal locking Daily/Weekly, etc.) REPLACES the
  // user's favorites outright — exactly those codes, no auto-add of the active tf,
  // no fallback to TF_ORDER. The host is choosing the set, not the user.
  const visibleTfs = (() => {
    if (Array.isArray(tfCodes)) return tfCodes.map(c => [c, tfLabel(c)])
    const fav = Array.isArray(hdr.timeframes) ? hdr.timeframes : []
    const codes = fav.length ? [...fav] : [...TF_ORDER]
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
    onTfChange?.(code)
  }, [customTfs, patchHeader, onTfChange])
  const removeCustomTf = useCallback((code) => {
    const fav = Array.isArray(hdr.timeframes) ? hdr.timeframes : []
    patchHeader({ customTimeframes: customTfs.filter(c => c !== code), timeframes: fav.filter(c => c !== code) })
  }, [customTfs, hdr.timeframes, patchHeader])
  // Per-item header color overrides (Chart Settings → Header → Show). Absent = the
  // item keeps its built-in color (see chartDefaults header.colors).
  const hdrColors = hdr.colors || {}

  // Info Row — the fields the user picked (migrates a legacy show* blob). Each extra data
  // source (live quote / perf / rvol+ipo meta / theme) is fetched for THIS one symbol ONLY
  // when a field that needs it is actually shown.
  const infoFieldKeys = useMemo(() => headerFieldKeys(hdr), [hdr])
  const infoGate = !compact && !mini && showTfBar
  const wantsQuote = infoGate && infoFieldKeys.some((k) => QUOTE_HEADER_KEYS.has(k))
  const wantsMeta = infoGate && infoFieldKeys.some((k) => META_HEADER_KEYS.has(k))
  const wantsTheme = infoGate && infoFieldKeys.some((k) => THEME_HEADER_KEYS.has(k))
  const wantsPerf = infoGate && infoFieldKeys.some((k) => PERF_HEADER_KEYS.has(k))
  const { prices: hdrPrices } = useRealtimePrices(wantsQuote ? [sym] : [])
  const { metaData: hdrMeta } = useWatchlistMeta(wantsMeta ? [sym] : [])
  const { themeData: hdrTheme } = useWatchlistThemes(wantsTheme ? [sym] : [])
  const { perfData } = useWatchlistPerformance(wantsPerf ? [sym] : [])
  const metaItems = useMemo(() => {
    const ctx = { fund, quote: hdrPrices?.[sym], meta: hdrMeta?.[sym], perf: perfData?.[sym], theme: hdrTheme?.[sym] }
    return infoFieldKeys.map((key) => {
      const f = HEADER_FIELD_BY_KEY[key]
      if (!f) return null
      const { value, color } = resolveHeaderField(key, ctx)
      const finalColor = color || (f.colorKey ? (hdrColors[f.colorKey] || f.dflt) : f.dflt) || null
      return { key, label: f.label, value, color: finalColor }
    }).filter(Boolean)
  }, [infoFieldKeys, hdrColors, fund, hdrPrices, hdrMeta, hdrTheme, perfData, sym])

  // Chart-settings modal (opened by the gear, by StockChart's own settings entry
  // point, or imperatively by the host through the ref).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
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

  // Volume-pane height persists per-user across every chart surface (default 12%),
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

  // Null-safe for the TF BAR only. StockChart keeps the raw prop: several of its
  // behaviors key off whether an onTfChange exists at all, and a surface that
  // omits it is saying "this chart's timeframe is not the user's to change".
  const handleTf = useCallback((code) => { onTfChange?.(code) }, [onTfChange])

  // Single ticker-change handler — every path (search dropdown pick, typed
  // submit, StockChart's own onSymbolChange, a host control routed through
  // ref.changeSymbol) goes through this. After the sym updates we refocus the
  // chart container so the user can immediately start typing again for the next
  // ticker without re-clicking the chart.
  const handleSymbolChange = useCallback((s) => {
    if (!s) return
    onSymbolChange?.(s)
    requestAnimationFrame(() => {
      focusableRef.current?.focus({ preventScroll: true })
    })
  }, [onSymbolChange])

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
    // A locked pane (no onSymbolChange) has nowhere to send a ticker character —
    // there is no search box to open. Let the key through UNTOUCHED (no
    // preventDefault/stopPropagation) instead of swallowing it, so the host page's
    // own letter hotkeys still fire.
    if (!onSymbolChange) return
    if (!TICKER_KEY_RE.test(e.key)) return
    e.preventDefault()
    // Swallow the key so it never reaches the drawing-tool (window) or timeframe
    // (document) hotkey handlers — typing a ticker must never trigger a tool or TF.
    e.stopPropagation()
    searchRef.current?.openWith(e.key)
  }, [sym, isFlagged, toggleFlag, onSymbolChange])

  useImperativeHandle(ref, () => ({
    openSettings,
    focus: () => focusableRef.current?.focus({ preventScroll: true }),
    changeSymbol: handleSymbolChange,
  }), [openSettings, handleSymbolChange])

  return (
    <div className={styles.chartWidget} onPointerEnter={onActivate} onFocusCapture={onActivate}>
      {slots?.top}
      {/* Top border row: logo + company name + day $/% change — sits above the
          timeframe/meta row so a long company name never pushes the session
          toggle + clock onto a second line. mini omits it entirely — there is
          no room for it in a ~320px-tall pane. */}
      {!mini && (
        <ChartIdentityRow
          searchRef={searchRef}
          sym={sym}
          displayLabel={headerLabel}
          labelColor={hdrColors.title || null}
          logoSym={themeIdx.isIndex ? null : sym}
          brandLogo={themeIdx.isIndex}
          boundsRef={focusableRef}
          themeVars={menuVars}
          onSymbolChange={onSymbolChange ? handleSymbolChange : null}
          showChange={hdr.showChange && !(themeIdx.isIndex && !idxGain)}
          dayGain={themeIdx.isIndex ? idxGain : null}
          dayGainColors={{
            up: hdrColors.dayChangeUp || (resolvedTheme === 'sunrise' ? '#0a5c22' : '#1ae51a'),
            down: hdrColors.dayChangeDown || (resolvedTheme === 'sunrise' ? '#7d1620' : '#ff3b47'),
          }}
          session={compact ? null : (isDWMtf
            ? { mode: 'dwm', view: sessionView, onView: setSessionView, extEnabled, extLabel }
            : { mode: 'intraday', extHoursOn, onExtHours: setExtHours })}
          showClock={!compact}
          rightSlot={slots?.headerRight}
          styles={styles}
        />
      )}
      {showTfBar && (
        <ChartTfBar
          tf={tf}
          visibleTfs={visibleTfs}
          onTf={handleTf}
          /* An explicit tfCodes set is a LOCK, so the overflow menu goes away
             with it — otherwise the host restricts the row and the user reaches
             right past it into the full TF_MENU. */
          showMenu={!Array.isArray(tfCodes)}
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
          {!compact && !mini && (
            <ChartMetaRow items={metaItems} styles={styles} />
          )}
          <div className={styles.tfBarRight}>
            {slots?.tfBarRight}
            {/* Chart settings gear — omitted for mini (no room, no chrome) and
                for a surface that IS the user's one chart (stored=null, no
                onStore): its settings read now resolves from the /charts
                workspace, so an edit made HERE would write the global
                chart_settings pref — a layer that read now outranks — and
                appear to silently do nothing. Settings stay editable on
                /charts, where they're edited anyway. */}
            {!mini && !isOwnChartSurface && (
              <button
                type="button"
                className={styles.chartSettingsBtn}
                onClick={openSettings}
                title="Chart settings"
                aria-label="Chart settings"
              >
                <UIcon name="gear" size={15} />
              </button>
            )}
            {slots?.tfBarEnd}
          </div>
        </ChartTfBar>
      )}
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
          /* Per-surface settings isolation: this surface's own full settings
             blob (null = inherit the global default). onSettingsPersist routes
             ALL of StockChart's internal settings writes to the same sink the
             pane writes through, so a workspace widget never touches the shared
             global pref → editing one chart never changes another.
             A /charts widget/tab wins with its own `stored` blob; otherwise, on
             an own-chart surface (stored=null, no onStore — every popup), the
             resolved `ownChartSource` from useChartSurfaceSettings hands the
             SAME widget/tab blob the chrome above already reads down to
             StockChart too — without this the chrome (identity/meta colors)
             would show the owner's settings while the actual chart (candles,
             MAs, background, watermark) kept rendering the untouched seed.
             `ownChartSource` is null when nothing distinctive was found (already
             fell back to the seed), so StockChart's own base — which reads that
             same seed — is already correct and gets no override. Both operands
             are memoized upstream, so this stays identity-stable. */
          settingsOverride={stored || ownChartSource || null}
          onSettingsPersist={writeActiveSettings}
          onSymbolChange={onSymbolChange ? handleSymbolChange : undefined}
          onTfChange={onTfChange}
          /* Share the same saved-color swatches with the drawing color picker. */
          savedColors={savedColors}
          onSaveColor={saveColor}
          onDeleteColor={deleteColor}
          onOpenSettings={openSettings}
          /* The intraday EXT/RTH toggle lives in the pane header (beside the
             clock), so suppress the duplicate button in the chart toolbar. */
          hideExtHoursToolbarToggle
          /* The reference look = the Model Book "Throughout the Years" main
             chart, 1:1. boldCandles brings the crisp bold vivid palette
             (MB_UP/MB_DOWN solid bodies + deep #0e0f0d canvas), thin 0.5px
             curved MAs, and vivid volume bars; volumeMa + markVolumeExtremes
             add the MB volume MA line + gold highest-volume bar. Plus a ~6-month
             daily window, its own compact volume pane, and tight price-scale
             margins so candles fill ~85% of the pane. A host that wants
             something else overrides it through stockChartProps. */
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
          /* A charting surface is not a journal: never overlay the viewer's
             Journal 2.0 / connected-brokerage BUY/SELL trade markers (or
             entry/stop lines) here. Those belong on the Journal tab — which
             turns them back on through stockChartProps. */
          hideJournalOverlay
          /* Watermark opacity is user-controllable via Chart Settings → Canvas.
             The settings default (0.07, the global faint default) is treated as
             "unset" → the pane's strong 0.82; any value the user picks wins. */
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
          canvasTheme={resolvedTheme === 'sunrise' ? 'sunrise' : null}
          volumePaneHeightPct={volPanePct}
          onVolumePaneResize={handleVolPaneResize}
          priceScaleTopMargin={0.12}
          priceScaleBottomMargin={0.10}
          sessionView={sessionView}
          {...(stockChartProps || {})}
        />
        {flagToast && (
          <div className={styles.flagToast}>
            {flagToast === 'flagged' ? `⚑ ${sym} added to Flagged` : `${sym} removed from Flagged`}
          </div>
        )}
        {slots?.overlay}
      </div>
      <ChartSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={chartCs}
        onChange={updateChartSettings}
        savedColors={savedColors}
        onSaveColor={saveColor}
        onDeleteColor={deleteColor}
        themeVars={menuVars}
        /* The pane passes volumeSeparatePane + volumePaneHeightPct above, and
           StockChart lets those props WIN over volume.separatePane /
           volume.paneHeightPct. Tell the modal so those two settings render inert
           here instead of looking live and doing nothing. */
        volumePaneFixed={VOLUME_PANE_SURFACE_FIXED}
      />
    </div>
  )
}

export default forwardRef(ChartPane)
