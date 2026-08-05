// app/src/pages/ThemeTrackerPage.jsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import { SkeletonTileContent } from '../components/Skeleton'
import styles from './ThemeTrackerPage.module.css'
import StockChart from '../components/StockChart'
import SymbolSearch from '../components/chart/SymbolSearch'
import CompanyLogo from '../components/CompanyLogo'
import uctMark from '../components/intro/assets/compass-mark.png'
import useThemeIndexBars from '../hooks/useThemeIndexBars'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import { TAG_BY_KEY } from '../constants/tagColors'
import { prefetchBar, prefetchBars, prefetchBarsToIDB, prefetchAllTimeframes, prefetchBarOnIntent, prefetchListAllTimeframes } from '../utils/prefetchBars'
import TickerActionsMenu, { useTickerActions } from '../components/TickerActions'
import UIcon from '../components/ui/UIcon'
import { useChartsSym } from './charts/ChartsSymContext'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import { menuThemeVars } from '../utils/dividerColor'
import ThemeTrackerSettingsPanel from './theme-tracker/ThemeTrackerSettingsPanel'
import { THEME_TRACKER_SETTINGS_KEY, THEME_TRACKER_DEFAULTS, THEME_TRACKER_BASE_FONT_PX, mergeThemeTrackerSettings, themeTrackerStyleVars, themeTrackerDefaultsForTheme } from './theme-tracker/themeTrackerSettings'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useRealtimeBarPrices, { pickFreshPrice } from '../hooks/useRealtimeBarPrices'

const fetcher = (url) => fetch(url).then(r => r.json())

// localStorage key holding the last /api/theme-performance response, used to
// paint the tab instantly on load before the fresh (632KB) fetch returns.
const THEME_PERF_CACHE_KEY = 'uct.themePerf.v1'

function RotationBadge({ delta }) {
  if (delta == null) return null
  if (delta >= 20) return <span className={styles.rotBadgeIn}>IN {delta > 0 ? '+' : ''}{delta.toFixed(0)}</span>
  if (delta <= -20) return <span className={styles.rotBadgeOut}>OUT {delta.toFixed(0)}</span>
  return null
}

const PERIOD_LABELS = { '1d': '1D', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', 'ytd': 'YTD' }
const RANK_TABS = ['Today', '1W', '1M', '3M', '1Y', 'YTD']
const RANK_TO_KEY = { 'Today': '1d', '1W': '1w', '1M': '1m', '3M': '3m', '1Y': '1y', 'YTD': 'ytd' }

function fmtRet(val) {
  if (val === null || val === undefined) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

function retClass(val, styles) {
  if (val === null || val === undefined) return styles.retFlat
  if (val > 0) return styles.retPos
  if (val < 0) return styles.retNeg
  return styles.retFlat
}

// Slug for the thematic-ETF index endpoint — must match the backend _slugify.
function themeSlug(name) {
  return (name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function avgReturn(holdings, periodKey) {
  // Owner rows only (§4b): engine-overlay members never move the theme number,
  // even on this fallback path (server outage / missing group_return).
  const vals = holdings
    .filter(h => h.source !== 'engine')
    .map(h => h.returns?.[periodKey])
    .filter(v => v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function groupReturn(theme, periodKey) {
  return (theme.group_return?.[periodKey] != null)
    ? theme.group_return[periodKey]
    : avgReturn(theme.holdings, periodKey)
}

// Live return for a holding at `periodKey`: (livePrice − periodRef) / periodRef.
// Uses the streamed price + the per-period reference close the backend sends in
// ref_prices. Falls back to the server-computed return when live data is absent.
function liveReturn(h, periodKey, prices) {
  const px = prices?.[h.sym]
  // 1d ("today"): TRUST the feed's server-computed change_pct — the regular-session
  // move vs the OFFICIAL prev close. Deriving it from (livePrice − ref) reads 0.00%
  // whenever the live price sits at the reference (weekends / after-hours, where the
  // streamed price is Friday's close and the ref is also a close) — that was the
  // recurring "goes to 0.00%" bug. Other periods derive from the live price + the
  // backend's per-period ref close (there is no per-period change_pct from the feed).
  if (periodKey === '1d' && px?.change_pct != null) return px.change_pct
  const live = px?.price
  const ref = periodKey === '1d'
    ? (px?.prev_close ?? h.ref_prices?.['1d'])
    : h.ref_prices?.[periodKey]
  if (live != null && Number.isFinite(live) && ref != null && ref !== 0) {
    return ((live - ref) / ref) * 100
  }
  return h.returns?.[periodKey] ?? null
}

// Live group return: anchor the server's group value and apply the AVERAGE live
// delta of its holdings, so the header ticks smoothly without jumping when live
// prices engage (server group value may be ETF/NAV-based, not a plain average).
function liveGroupReturn(theme, periodKey, prices) {
  const base = groupReturn(theme, periodKey)
  if (base == null) return null
  let sum = 0, n = 0
  for (const h of theme.holdings) {
    const s = h.returns?.[periodKey]
    const l = liveReturn(h, periodKey, prices)
    if (s != null && l != null) { sum += (l - s); n++ }
  }
  return n > 0 ? base + sum / n : base
}

// A return cell that briefly flashes bold (TC2000-style) whenever its displayed
// value changes. TINT COLOR follows the DAY DIRECTION, not the tick direction: a
// holding green on the day always flashes the up-tint (even on a down-tick), one
// red on the day always flashes the down-tint. `value` IS the day return, so its
// sign == the day direction. `dir` now only GATES the flash (any change).
function ReturnCell({ value, baseClass, flashEnabled = true }) {
  const [dir, setDir] = useState(null)
  const prevRef = useRef(null)
  useEffect(() => {
    const r = value == null ? null : Math.round(value * 100) / 100
    // Tick-flash disabled in Theme Tracker Settings: keep tracking the previous
    // value (so re-enabling doesn't flash on a stale compare) but never animate.
    if (!flashEnabled) { prevRef.current = r; return }
    const p = prevRef.current
    if (r != null && p != null && r !== p) {
      setDir(r > p ? 'up' : 'down')
      prevRef.current = r
      const id = setTimeout(() => setDir(null), 480)
      return () => clearTimeout(id)
    }
    prevRef.current = r
  }, [value, flashEnabled])
  const flashCls = dir ? (value >= 0 ? styles.flashUp : styles.flashDown) : ''
  return (
    <span className={`${baseClass} ${dir ? styles.retFlash : ''} ${flashCls}`}>
      {fmtRet(value)}
    </span>
  )
}

function ThemeGroup({ theme, selectedSym, selectedNavKey, onSelectSym, activeKey, sortDir, open, onToggle, rowRefs, rotationRanking, getTag, tickerActions, onHoverSym, prices, tintEnabled = true, showLogos = true, logoSize = 16 }) {
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const isPortfolio = theme.ticker === 'UCT20'
  const groupLive = liveGroupReturn(theme, activeKey, prices)
  const momentumDelta = rotationRanking?.momentum_delta

  const sortedHoldings = useMemo(() => {
    return [...theme.holdings].sort((a, b) => {
      const av = a.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = b.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [theme.holdings, activeKey, sortDir])

  return (
    <>
      <div className={styles.groupRow} onClick={() => onToggle(theme.ticker)}>
        <span className={styles.groupName}>
          <span className={styles.groupCaret}>{open ? '▾' : '▸'}</span>
          {theme.name}
          {isPortfolio && <span className={styles.portfolioBadge}><UIcon name="star-fill" size={13} /></span>}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        <ReturnCell value={groupLive} baseClass={`${styles.ret} ${styles.retActive} ${retClass(groupLive, styles)}`} flashEnabled={tintEnabled} />
      </div>

      {open && (() => {
        const indexSym = `$IDX:${themeSlug(theme.name)}`
        return (
          <div
            className={`${styles.stockRow} ${styles.indexRow} ${selectedSym === indexSym ? styles.selected : ''}`}
            onClick={() => onSelectSym(indexSym, `${theme.name} Index`, theme.ticker)}
            title="Equal-weight combined chart of the whole theme"
          >
            <span className={styles.stockLabel}>
              <span className={styles.stockLogo}><UIcon name="equity" size={13} /></span>
              <span className={styles.sym} style={{ fontWeight: 700 }}>{theme.name} Index</span>
              {/* The row is always the equal-weight SYNTHETIC index ($IDX). Only
                  label it "ETF" when the theme is actually ETF-backed — the 48
                  curated-only themes (incl. all 12 new narrow ones) have no ETF,
                  so "ETF" there was misleading (mega-review). */}
              <span className={styles.indexBadge}>{theme.etf_name ? 'ETF' : 'INDEX'}</span>
            </span>
            <ReturnCell value={groupLive} baseClass={`${styles.ret} ${retClass(groupLive, styles)}`} flashEnabled={tintEnabled} />
          </div>
        )
      })()}

      {open && sortedHoldings.map(h => {
        const retVal = liveReturn(h, activeKey, prices)
        const rowKey = `${theme.ticker}::${h.sym}`
        // Highlight only the SELECTED instance (by key). Falls back to the bare
        // symbol when no instance key is set (e.g. hub-driven selection).
        const isSelected = selectedNavKey ? selectedNavKey === rowKey : h.sym === selectedSym
        // Provenance mark (T8): engine-added members render slightly dimmed so a
        // trader can tell them from curated names. Absent source = owner (full).
        const isEngine = h.source === 'engine'
        return (
          <div
            key={h.sym}
            ref={el => { if (rowRefs) rowRefs.current[rowKey] = el }}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            style={isEngine ? { opacity: 0.85 } : undefined}
            title={isEngine ? 'Engine-added — pending curation' : undefined}
            onClick={() => onSelectSym(h.sym, h.name, theme.ticker)}
            onMouseEnter={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            onFocus={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            {...(tickerActions ? tickerActions.longPressProps(h.sym) : {})}
          >
            <span className={styles.stockLabel}>
              <button
                className={`${styles.flagStar}${isFlagged(h.sym) ? ' ' + styles.flagStarActive : ''}`}
                onClick={e => { e.stopPropagation(); toggleFlag(h.sym) }}
                title={isFlagged(h.sym) ? 'Remove from Flagged' : 'Add to Flagged'}
              >{isFlagged(h.sym) ? <UIcon name="star-fill" size={12} /> : <UIcon name="star" size={12} />}</button>
              {showLogos && <span className={styles.stockLogo}><CompanyLogo sym={h.sym} name={h.name} size={logoSize} round /></span>}
              {getTag && getTag(h.sym) && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[getTag(h.sym)]?.hex, marginRight: 4 }} />}
              <span className={styles.sym}>{h.sym}</span>
            </span>
            <ReturnCell value={retVal} baseClass={`${styles.ret} ${retClass(retVal, styles)}`} flashEnabled={tintEnabled} />
          </div>
        )
      })}
    </>
  )
}

export default function ThemeTrackerPage({ embedded = false, activeRef = null, widgetKey = null }) {
  // Arrow-key nav is LOCKED to whichever list widget you last clicked (theme
  // tracker vs a Watchlist widget), via a single shared activeRef in the charts
  // workspace. Claiming it on click means arrows keep scanning THIS list until
  // you click into another — they never jump to the watchlist just from hover.
  const isActiveWidget = () => !activeRef || activeRef.current == null || activeRef.current === widgetKey
  const markActiveWidget = () => { if (activeRef && widgetKey) activeRef.current = widgetKey }

  // ── Theme Tracker appearance settings (⚙ panel) — mirrors the watchlist's ──
  const { prefs, setPref } = usePreferences()
  // Uncustomized (no saved pref) → DEFAULTS FOR THE CURRENT APP THEME (light → white
  // canvas + dark text), so the ⚙ swatches and the surface follow the site theme.
  const ttSettings = useMemo(
    () => mergeThemeTrackerSettings(parsePref(prefs?.[THEME_TRACKER_SETTINGS_KEY], null) ?? themeTrackerDefaultsForTheme(prefs?.theme)),
    [prefs],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const pageRef = useRef(null)
  const patchSettings = useCallback((patch) => {
    setPref(THEME_TRACKER_SETTINGS_KEY, JSON.stringify({ ...ttSettings, ...patch }))
  }, [ttSettings, setPref])
  const resetSettings = useCallback(() => {
    setPref(THEME_TRACKER_SETTINGS_KEY, JSON.stringify(themeTrackerDefaultsForTheme(prefs?.theme)))
  }, [setPref, prefs])
  const ttStyle = useMemo(() => themeTrackerStyleVars(ttSettings), [ttSettings])
  // Canvas-matched palette for the settings panel (light/gold on a light canvas,
  // dark on a dark one) — same mechanism as the chart/watchlist popup menus.
  const ttMenuVars = useMemo(() => {
    const canvas = ttSettings.bgMode === 'gradient' ? (ttSettings.bgGradient?.top || ttSettings.bg) : ttSettings.bg
    return menuThemeVars(canvas) || {}
  }, [ttSettings])
  // CompanyLogo sizes itself with an inline px style, so the text-size scale is
  // applied in JS for the logo (the CSS vars handle everything else).
  const rowLogoSize = useMemo(() => {
    const px = Number(ttSettings.fontSize)
    const scale = px > 0 ? px / THEME_TRACKER_BASE_FONT_PX : 1
    return Math.round(16 * scale)
  }, [ttSettings.fontSize])

  const [activeTab, setActiveTab] = useState('Today')  // always open on Today (not persisted → resets every load)
  // Instant paint: seed SWR from the LAST cached response so the tab renders
  // immediately on refresh (like the chart's IDB cache) instead of showing a ~1s
  // skeleton while the 632KB payload round-trips. SWR then revalidates in the
  // background and swaps in fresh %s. Read once on mount.
  const themeFallback = useMemo(() => {
    try {
      const raw = localStorage.getItem(THEME_PERF_CACHE_KEY)
      const p = raw ? JSON.parse(raw) : null
      return p?.themes?.length ? p : undefined
    } catch { return undefined }
  }, [])
  const { data, isLoading } = useMobileSWR('/api/theme-performance', fetcher, {
    // 10s so the theme %s stay near-live and the leaderboard re-sorts in order.
    // (The server overlay is cached at the same 10s window — see _LIVE_1D_TTL —
    // so this polls no faster than the data actually refreshes.) Theme %s are
    // aggregates of up to ~2,050 holdings; we can't stream them tick-by-tick
    // like the watchlist (that would fan out the single-process SSE backend),
    // so a short server-refresh window is the live-enough, safe approach.
    fallbackData: themeFallback,
    refreshInterval: (d) => d?.status === 'computing' ? 15_000 : 10_000,
    dedupingInterval: 8_000,
    revalidateOnFocus: false,
  })
  const isComputing = data?.status === 'computing'

  // Persist the freshest full response for next load's instant paint. Throttled +
  // idle-deferred so the 632KB JSON.stringify never janks the main thread.
  const lastPersistRef = useRef(0)
  useEffect(() => {
    if (!data?.themes?.length) return
    const now = Date.now()
    if (now - lastPersistRef.current < 20_000) return
    lastPersistRef.current = now
    const write = () => { try { localStorage.setItem(THEME_PERF_CACHE_KEY, JSON.stringify(data)) } catch { /* quota / private mode */ } }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 3000 })
    else setTimeout(write, 0)
  }, [data])

  const { data: rotationData } = useMobileSWR('/api/theme-rotation', fetcher, {
    refreshInterval: 900_000,   // 15 min — matches backend cache
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  })
  const rotationRankings = rotationData?.rankings || {}

  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  const [selectedSym, setSelectedSym] = useState(null)
  // Which INSTANCE is selected — `${themeTicker}::${sym}`. A ticker can appear in
  // several open themes, so arrow-nav + row highlight key off this, not the bare
  // symbol (else navigating a duplicate jumps to the other theme's copy).
  const [selectedNavKey, setSelectedNavKey] = useState(null)
  const [selectedName, setSelectedName] = useState('')
  const [sortDir, setSortDir] = useState('desc')
  // Accordion: at most ONE theme open at a time (null = none). Defaults to the
  // first theme; opening another closes the previous; arrow-nav into a new
  // theme closes the old one.
  const [openTheme, setOpenTheme] = useState(null)
  const [search, setSearch] = useState('')
  // chartPeriod is declared up here (not later in the file) because
  // toggleTheme + handleHoverSym below close over it; a `const` declared
  // *after* those would be in the temporal dead zone at render time.
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)

  // ── Thematic-ETF ── A theme's equal-weight index is a pseudo-ticker
  // ("$IDX:<slug>") selected from an "… Index" row in the holdings list, so it
  // flows through the SAME selection path as any ticker (right panel here; the
  // linked chart widget when embedded). The hook fetches its bars for barsOverride.
  const themeIdx = useThemeIndexBars(selectedSym, chartPeriod)
  const indexTf = ['D', 'W', 'M'].includes(chartPeriod) ? chartPeriod : 'D'

  const rowRefs = useRef({})
  const activeKey = RANK_TO_KEY[activeTab]

  function handleTabClick(tab) {
    if (tab === activeTab) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setActiveTab(tab)
      setSortDir('desc')
    }
  }

  function toggleTheme(ticker) {
    setOpenTheme(prev => {
      if (prev === ticker) return null   // clicking the open one collapses it
      // Bulk-warm bars + ticker-meta for every holding in the just-opened
      // group so any click within it lands on a populated SWR cache. Server
      // disk cache makes this cheap (~10ms each, parallelised by the
      // browser), and prefetchBars dedups against in-flight requests.
      const theme = data?.themes?.find(t => t.ticker === ticker)
      if (theme?.holdings?.length) {
        const syms = theme.holdings.map(h => h.sym)
        prefetchBars(syms, chartPeriod)
        // Durable warm of the WHOLE group into IndexedDB so arrowing through it
        // (even with the keyboard, faster than hover) is instant — and survives a
        // page reload, unlike the in-memory prefetch above. Also warm Daily since
        // that's the default chart TF a click lands on.
        prefetchBarsToIDB(syms, chartPeriod)
        if (chartPeriod !== 'D') prefetchBarsToIDB(syms, 'D')
        // Warm the whole group across ALL scan timeframes (intraday too) into
        // durable IDB so scrolling this theme is instant on 5m/30m/1h, not just
        // daily. Bounded/idle-deferred — never competes with the active chart.
        prefetchListAllTimeframes(syms)
      }
      return ticker                      // opening a new one closes the previous
    })
  }

  // Row-hover prefetch: by the time the click commits (~200ms of mouse-down
  // latency on average), the bars are already in flight or cached.
  const handleHoverSym = useCallback(sym => {
    prefetchBarOnIntent(sym, chartPeriod)
  }, [chartPeriod])

  const chartRef = useRef(null)

  useEffect(() => {
    // External (hub-driven) selection isn't tied to a specific theme instance,
    // so drop the instance key → highlight/nav fall back to the bare symbol.
    if (hubSym && hubSym !== selectedSym) { setSelectedSym(hubSym); setSelectedNavKey(null) }
  }, [hubSym])  // intentionally do NOT depend on selectedSym (avoid feedback loop)

  function handleSelect(sym, name, themeTicker) {
    markActiveWidget()   // clicking a name locks arrow-nav to this list widget
    setSelectedSym(sym)
    setSelectedNavKey(themeTicker ? `${themeTicker}::${sym}` : null)
    setHubSym(sym)
    setSelectedName(name || sym)
    // On mobile (stacked layout), scroll chart into view after selection
    if (window.innerWidth <= 900) {
      setTimeout(() => {
        chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  const sortedThemes = useMemo(() => {
    if (!data?.themes) return []
    return [...data.themes].sort((a, b) => {
      const av = groupReturn(a, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = groupReturn(b, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [data, activeKey, sortDir])

  // Debounce the query (mega-review: at 111 themes / ~2,050 holdings, filtering
  // + auto-open on every keystroke made the accordion jumpy). 180ms settle.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 180)
    return () => clearTimeout(t)
  }, [search])

  // Shared matcher: name/ticker/sector match on any length; the expensive
  // per-holding substring scan is gated to queries ≥ 2 chars so a single char
  // ("a") doesn't pull in every theme via some random holding (mega-review: noisy).
  const themeMatches = useCallback((theme, q) =>
    theme.name.toLowerCase().includes(q) ||
    theme.ticker.toLowerCase().includes(q) ||
    (theme.sector || '').toLowerCase().includes(q) ||
    (q.length >= 2 && theme.holdings.some(h => h.sym.toLowerCase().includes(q))),
  [])

  const filteredThemes = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return sortedThemes
    return sortedThemes.filter(theme => themeMatches(theme, q))
  }, [sortedThemes, debouncedSearch, themeMatches])

  // While searching, open the FIRST matching theme (accordion stays single-open).
  useEffect(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q || !sortedThemes.length) return
    const match = sortedThemes.find(theme => themeMatches(theme, q))
    if (match) setOpenTheme(match.ticker)
  }, [debouncedSearch, sortedThemes, themeMatches])

  // First theme open BY DEFAULT — on initial load and whenever the period
  // changes (each period sorts differently, so its "first" theme differs). Does
  // NOT re-open if the user deliberately collapses it (only fires on period flip
  // / first data arrival), so manual collapse still works.
  const firstThemeTicker = filteredThemes[0]?.ticker
  const lastOpenPeriodRef = useRef(null)
  useEffect(() => {
    if (!firstThemeTicker) return
    if (lastOpenPeriodRef.current !== activeKey) {
      setOpenTheme(firstThemeTicker)
      lastOpenPeriodRef.current = activeKey
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstThemeTicker, activeKey])

  // Flat list for keyboard navigation — must match visual sort order
  const allStocks = useMemo(() =>
    filteredThemes.flatMap(theme => {
      const sorted = [...theme.holdings].sort((a, b) => {
        const av = a.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
        const bv = b.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
        return sortDir === 'desc' ? bv - av : av - bv
      })
      return sorted.map(h => ({ sym: h.sym, name: h.name, themeTicker: theme.ticker, key: `${theme.ticker}::${h.sym}` }))
    }), [filteredThemes, activeKey, sortDir])

  // ── Live percentages ── Stream real-time prices for the holdings of EXPANDED
  // themes only (bounded, user-controlled — never the whole ~2k-symbol universe,
  // which would fan out the single-process SSE backend). Each % is recomputed
  // client-side from the live price + the per-period ref close (see liveReturn).
  const expandedSyms = useMemo(() => {
    const s = new Set()
    for (const theme of filteredThemes) {
      if (openTheme === theme.ticker) {
        for (const h of theme.holdings) if (h.sym) s.add(h.sym)
      }
    }
    return [...s]
  }, [filteredThemes, openTheme])

  // Prices come from TWO feeds, merged:
  //   • useRealtimePrices → the official prev_close (REST) + a Finnhub fallback.
  //   • useRealtimeBarPrices → the Massive bars WS tick price (T/A/AM), the SAME
  //     reliable tick-by-tick feed the chart uses. Finnhub drops/rotates symbols
  //     (OKTA sat 400s+ stale), so the bars price is the authoritative live tick.
  const { prices: rtPrices } = useRealtimePrices(expandedSyms)
  const barPrices = useRealtimeBarPrices(expandedSyms)
  const tickPrices = useMemo(() => {
    const now = Date.now()
    const out = {}
    for (const sym of expandedSyms) {
      const rt = rtPrices[sym]
      const bp = barPrices[sym]
      // freshest-wins: recent Massive tick, else fresh Finnhub — so a gap in
      // either feed never freezes the %. prev_close etc. still come from rt.
      const price = pickFreshPrice(bp, rt, now)
      if (price != null) out[sym] = { ...rt, price }
      else if (rt) out[sym] = rt
    }
    return out
  }, [rtPrices, barPrices, expandedSyms])

  const handleKeyDown = useCallback((e) => {
    // Space advances like ArrowDown (next ticker).
    const navSpace = e.key === ' ' || e.key === 'Spacebar'
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && !navSpace) return
    // Another list widget owns the arrows (user last clicked it) — don't fight it.
    if (activeRef && activeRef.current != null && activeRef.current !== widgetKey) return
    // Don't hijack arrows while user is typing in the search input,
    // any inline editor, etc.
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    // Space also never steals from a control that uses it.
    if (navSpace) {
      const t = tgt?.tagName
      if (t === 'BUTTON' || t === 'A' || t === 'SELECT' || tgt?.getAttribute?.('role') === 'button') return
    }
    const navDown = e.key === 'ArrowDown' || navSpace
    if (!allStocks.length) return
    // Locate by the exact INSTANCE (theme::sym) so navigating a ticker that also
    // lives in another open theme steps to its true neighbor instead of jumping
    // to the other theme's copy. Fall back to the bare symbol (click without a
    // theme, hub sync) — first match, same as before.
    let idx = selectedNavKey ? allStocks.findIndex(s => s.key === selectedNavKey) : -1
    if (idx < 0) idx = allStocks.findIndex(s => s.sym === selectedSym)
    // If selection is not in THIS widget's universe, don't fight another
    // widget's arrow handler (e.g., a Watchlist widget on the same page).
    if (idx < 0 && selectedSym) return
    e.preventDefault()
    e.stopImmediatePropagation()   // this widget owns the arrow — don't double-handle
    markActiveWidget()             // keep the lock here as you keep scanning
    const nextIdx = idx < 0
      ? (navDown ? 0 : allStocks.length - 1)
      : (navDown
          ? Math.min(idx + 1, allStocks.length - 1)
          : Math.max(idx - 1, 0))
    if (nextIdx === idx) return
    const stock = allStocks[nextIdx]
    // Accordion: arrow-navving into a stock opens its theme and closes any other
    // (so scrolling off the end of one theme into the next collapses the first).
    setOpenTheme(stock.themeTicker)
    setSelectedSym(stock.sym)
    setSelectedNavKey(stock.key)
    setSelectedName(stock.name || stock.sym)
    // Publish to hub so a paired Chart widget on the same color group follows.
    setHubSym(stock.sym)
    setTimeout(() => {
      rowRefs.current[stock.key]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 30)
  }, [allStocks, selectedSym, selectedNavKey, setHubSym, activeRef, widgetKey])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prefetch all timeframes for current ticker + adjacent tickers for active TF
  useEffect(() => {
    if (!selectedSym || !allStocks.length) return
    prefetchAllTimeframes(selectedSym)
    const idx = allStocks.findIndex(s => s.sym === selectedSym)
    if (idx < 0) return
    const upcoming = allStocks.slice(idx + 1, idx + 6).map(s => s.sym)
    prefetchBars(upcoming, chartPeriod)
  }, [selectedSym, allStocks, chartPeriod])
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { getTag } = useTickerTags()
  const tickerActions = useTickerActions()

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Shift+F to flag selected ticker
  useEffect(() => {
    if (!selectedSym) return
    const handler = (e) => {
      if (e.shiftKey && e.key === 'F') {
        const willFlag = !isFlagged(selectedSym)
        toggleFlag(selectedSym)
        setFlagToast(willFlag ? 'added' : 'removed')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedSym, isFlagged, toggleFlag])

  return (
    <div
      ref={pageRef}
      className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`}
      style={ttStyle}
      onPointerDown={markActiveWidget}
      onFocusCapture={markActiveWidget}
    >
      {settingsOpen && (
        <ThemeTrackerSettingsPanel
          settings={ttSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={pageRef.current}
          themeVars={ttMenuVars}
        />
      )}

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Period tabs */}
        <div className={styles.periodBar}>
          {RANK_TABS.map(tab => (
            <button
              key={tab}
              className={`${styles.periodTab} ${activeTab === tab ? styles.periodTabActive : ''}`}
              onClick={() => handleTabClick(tab)}
            >
              {tab}{activeTab === tab ? (sortDir === 'desc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className={styles.searchBar}>
          <input
            className={styles.searchInput}
            placeholder="Search themes or tickers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')}>×</button>
          )}
          {/* ⚙ Theme Tracker settings — rides the search row (a gear on its own
              wrapped period-bar row wasted a full strip of vertical space). */}
          <button
            ref={settingsBtnRef}
            className={`${styles.settingsBtn}${settingsOpen ? ' ' + styles.settingsBtnActive : ''}`}
            onClick={() => setSettingsOpen(o => !o)}
            title="Theme Tracker settings"
          ><UIcon name="gear" size={14} /></button>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colLabel}>Theme</span>
          <button
            type="button"
            className={`${styles.colLabel} ${styles.colLabelActive} ${styles.sortBtn}`}
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            title={sortDir === 'desc' ? 'Sorted high → low (click for low → high)' : 'Sorted low → high (click for high → low)'}
          >
            {PERIOD_LABELS[activeKey]}
            <span className={styles.sortCaret}>{sortDir === 'desc' ? '▼' : '▲'}</span>
          </button>
        </div>

        <div className={styles.tableBody}>
          {(isLoading || isComputing) && (
            isComputing
              ? <p className={styles.loading}>Computing returns… ready in ~30s</p>
              : <SkeletonTileContent lines={6} />
          )}
          {!isLoading && !isComputing && (!data || data.themes?.length === 0) && (
            <p className={styles.loading}>No theme data — run the morning wire engine to populate.</p>
          )}
          {filteredThemes.map(theme => (
            <ThemeGroup key={theme.ticker} theme={theme} selectedSym={selectedSym} selectedNavKey={selectedNavKey} onSelectSym={handleSelect}
              activeKey={activeKey} sortDir={sortDir} open={openTheme === theme.ticker} onToggle={toggleTheme}
              rowRefs={rowRefs} rotationRanking={rotationRankings[theme.ticker]} getTag={getTag}
              tickerActions={tickerActions} onHoverSym={handleHoverSym}
              prices={openTheme === theme.ticker ? tickPrices : null}
              tintEnabled={ttSettings.tintEnabled} showLogos={ttSettings.showLogos} logoSize={rowLogoSize} />
          ))}
        </div>
      </div>

      {/* ── Right panel — hidden in embedded mode ── */}
      {!embedded && (
        <div className={styles.rightPanel} ref={chartRef}>
          {themeIdx.isIndex ? (
            <>
              <div className={styles.chartHeader}>
                {/* Thematic indexes have no company ticker → no logo.dev logo.
                    Use the Uncharted Territory compass mark as the brand logo. */}
                <span className={styles.stockLogo} style={{ width: 20, height: 20 }}>
                  {/* 20px (vs 16 for company logos): the mark has transparent padding
                      + pointed arms and isn't clipped to a filled circle, so it reads
                      smaller at the same box size. */}
                  <img src={uctMark} alt="Uncharted Territory" width={20} height={20} style={{ display: 'block', objectFit: 'contain' }} />
                </span>
                <span className={styles.chartName} style={{ fontWeight: 700, color: 'var(--ut-gold)' }}>{themeIdx.name || selectedName}</span>
                <span className={styles.chartName} style={{ opacity: 0.55 }}>Equal-Weight Index</span>
                <div className={styles.chartPeriodTabs}>
                  {[['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']].map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn} ${indexTf === p ? styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <StockChart
                sym={selectedSym}
                tf={indexTf}
                barsOverride={themeIdx.bars}
                barsOverridePending={themeIdx.loading}
                watermark={themeIdx.name || selectedName.replace(/ Index$/, '')}
                watermarkName={`${themeIdx.name || selectedName.replace(/ Index$/, '')} Index`}
                liveUpdates={false}
                hidePriceLine
              />
              <div className={styles.newsLabel}>Equal-weight index — {themeIdx.name || selectedName}</div>
            </>
          ) : selectedSym ? (
            <>
              <div className={styles.chartHeader}>
                <SymbolSearch sym={selectedSym} onSymbolChange={(s) => { setSelectedSym(s); setSelectedName('') }} />
                <span className={styles.chartName}>{selectedName}</span>
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    {flagToast === 'added' ? <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Flagged</> : <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Removed</>}
                  </span>
                )}
                <button
                  className={`${styles.flagBtn}${isFlagged(selectedSym) ? ' ' + styles.flagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(selectedSym); toggleFlag(selectedSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(selectedSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                ><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{isFlagged(selectedSym) ? 'Flagged' : 'Flag'}</button>
                <div className={styles.chartPeriodTabs}>
                  {[['1', '1min'], ['5', '5min'], ['15', '15min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']].map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn} ${chartPeriod === p ? styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <StockChart sym={selectedSym} tf={chartPeriod} onSymbolChange={(s) => { setSelectedSym(s); setSelectedName('') }} onTfChange={setChartPeriod} />
              <div className={styles.newsLabel}>News — {selectedSym}</div>
            </>
          ) : (
            <div className={styles.chartEmpty}>
              Select a ticker to view chart
            </div>
          )}
        </div>
      )}
      {tickerActions.menu && <TickerActionsMenu menu={tickerActions.menu} onClose={tickerActions.closeMenu} />}
    </div>
  )
}
