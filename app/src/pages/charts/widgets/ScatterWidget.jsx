/**
 * Market Map — a scatter / bubble chart of a whole universe of stocks. Pick a
 * UNIVERSE (an index, a watchlist, a scanner, a breadth set, a theme, the whole
 * market), pick what goes on the X and Y axes (and, optionally, bubble SIZE), and
 * every stock plots as a point coloured by its direction. Scroll to zoom, drag to
 * pan; click a point to route that ticker into this widget's color group so a
 * paired chart follows.
 *
 * Distinctly UCT (not a DeepVue clone): you change an axis by clicking the AXIS
 * TITLE (not a top toolbar), bubbles carry a real third SIZE dimension, the plane
 * is split by faint zero-lines, and the dots glide as prices tick.
 *
 * Data: /api/scatter/* — /data (the per-ticker bundle: nightly screener metrics +
 * a live snapshot) polled slowly, POST /live (fast overlay) for the glide.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactECharts from 'echarts-for-react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { useWorkspace } from '../WorkspaceContext'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NhnlSettingsPanel from './NhnlSettingsPanel'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
import chrome from './NewHighsLowsWidget.module.css'
import styles from './ScatterWidget.module.css'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import { prewarmVisibleList } from '../../../utils/prefetchBars'
import { KIND, channelFor, useChannel } from '../../../lib/context/contextChannels'
import Input from '../../../components/ui/Input'
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'
import { useThemeInk, CHROME_INK, withAlpha } from '../../../lib/theme'

// TERM-033: a failed read THROWS (sectionFetcher). It used to resolve to `null`, and the map
// said "No data for this universe yet.", a claim about the universe made out of a failed
// request. The universe bundle now has its own error state with a Retry; SWR keeps the last
// good bundle through a failed 45 s refresh. The metric catalog and universe menu are menu
// enrichments and stay soft at the render (an empty menu, no claim). A 402 stays absent.
const getFetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

// Chart inks from the member's app theme (lib/theme): the up/down defaults are the theme's
// bright candle green/red (a member's own pick in ⚙ still wins), and the axis/tooltip chrome
// is the theme's text and surface, so the chart reads on a light page as on a dark one.
const CHART_INK = {
  up: ['--ut-green-bright', '#34d17c'], down: ['--ut-red-bright', '#f24b42'],
  text: CHROME_INK.text, muted: CHROME_INK.muted, bright: CHROME_INK.bright,
  elevated: CHROME_INK.elevated, bg: CHROME_INK.bg,
}

const DEFAULTS = { source: 'index', value: 'sp500', xKey: 'rvol', yKey: 'chg_today', sizeKey: '' }
// The list-ref sources /api/scatter/data resolves — exactly what WatchlistWidget's
// `watchKeyToListRef` publishes. Anything else on the channel is refused by name.
export const MAP_PLOTTABLE_LIST_SOURCES = new Set(['flagged', 'watchlist', 'tag'])

// ── value formatting by metric unit ──
// TERM-066: the K/M/B/T suffix comes from lib/presentation (formatCompact) on this map's own
// ladder; the callers add any "$" themselves. Exported for widgetFormatters.term066.test.js.
const ABBREV_TIERS = [
  { at: 1e12, suffix: 'T', decimals: 2 },
  { at: 1e9, suffix: 'B', decimals: 2 },
  { at: 1e6, suffix: 'M', decimals: 1 },
  { at: 1e3, suffix: 'K', decimals: 0 },
]
export function abbrev(v) {
  if (!(Math.abs(v) >= 1e3)) return v.toFixed(0)
  return formatCompact(v, { tiers: ABBREV_TIERS })
}
function fmtVal(v, unit) {
  if (v == null || !isFinite(v)) return '—'
  switch (unit) {
    case 'pct': return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
    case 'pct0': return `${Math.round(v)}%`
    case 'x': return `${v.toFixed(2)}×`
    case 'usd': return `$${v.toFixed(2)}`
    case 'usd_big': return `$${abbrev(v)}`
    case 'big': return abbrev(v)
    case 'num': return Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1)
    default: return String(v)
  }
}
function faint(color, a) {
  const out = withAlpha(color, a)
  return out === color ? 'transparent' : out
}
function fmtAxis(v, unit) {
  switch (unit) {
    case 'usd_big': case 'big': return abbrev(v)
    case 'usd': return `$${Math.round(v)}`
    case 'x': return `${v}×`
    case 'pct': case 'pct0': return `${Math.round(v)}`
    default: return `${v}`
  }
}

// ── Shared portaled dropdown (universe + metric pickers) ──
function DropMenu({ groups, selectedKey, onPick, onClose, anchorEl, themeVars, align = 'left', searchable = false }) {
  const ref = useRef(null)
  const searchRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = (!searchable || !needle)
    ? groups
    : groups
      .map(g => ({ ...g, items: g.items.filter(it => (it.label || '').toLowerCase().includes(needle)) }))
      .filter(g => g.items.length)
  useLayoutEffect(() => {
    if (!anchorEl) return undefined
    const place = () => {
      const r = anchorEl.getBoundingClientRect()
      const W = 230, gap = 5, pad = 8, CAP = 460
      // Horizontal: prefer the requested edge, then clamp fully into view.
      let left = align === 'right' ? r.right - W : r.left
      left = Math.max(pad, Math.min(left, window.innerWidth - W - pad))
      // Vertical: open on whichever side has more room, and cap the height to
      // exactly that room so the menu never runs off-screen (it scrolls inside).
      const belowRoom = window.innerHeight - pad - (r.bottom + gap)
      const aboveRoom = (r.top - gap) - pad
      let top, maxH
      if (belowRoom >= aboveRoom) { top = r.bottom + gap; maxH = Math.min(CAP, belowRoom) }
      else { maxH = Math.min(CAP, aboveRoom); top = r.top - gap - maxH }
      maxH = Math.max(140, Math.round(maxH))
      top = Math.max(pad, Math.min(Math.round(top), window.innerHeight - pad - maxH))
      setPos({ left: Math.round(left), top, width: W, maxHeight: maxH })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorEl, align])
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorEl?.contains(e.target)) return
      onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [onClose, anchorEl])
  useEffect(() => { if (searchable) requestAnimationFrame(() => searchRef.current?.focus()) }, [searchable])
  return createPortal((
    <div ref={ref} className={styles.menu}
      style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { visibility: 'hidden' }) }}>
      {searchable && (
        <div className={styles.searchWrap}>
          <Input aria-label="Search"
            ref={searchRef}
            className={styles.searchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search groups, ETFs, industries…"
          />
        </div>
      )}
      {shown.length === 0
        ? <div className={styles.menuEmpty}>No matches</div>
        : shown.map((g, gi) => (
          <div key={gi} className={styles.menuGroup}>
            {g.label && <div className={styles.menuGroupLabel}>{g.label}</div>}
            {g.items.map((it) => (
              <button key={it.key} type="button"
                className={`${styles.menuItem}${it.key === selectedKey ? ' ' + styles.menuItemOn : ''}`}
                onClick={() => { onPick(it); onClose() }}>
                <span className={styles.menuItemLabel}>{it.label}</span>
                {it.hint && <span className={styles.menuItemHint}>{it.hint}</span>}
              </button>
            ))}
          </div>
        ))}
    </div>
  ), document.body)
}

// Grid margins — the plot rect's insets. containLabel:false so WE own the left
// gutter (the rotated Y-title lives there); the axis numbers render inside it.
const GRID_M = { left: 54, right: 26, top: 16, bottom: 50 }

function makeOption({ plot, xMeta, yMeta, up, dn, sizeMin, sizeMax, labelMode, upFaint, dnFaint, ink }) {
  const grid = withAlpha(ink.text, 0.06)
  const axisLine = withAlpha(ink.text, 0.18)
  const data = plot.map(p => ({
    name: p.sym,
    value: [p.x, p.y, p.size == null ? 1 : p.size, p.sym],
    itemStyle: { color: p.dir === 'up' ? up : dn, opacity: 0.92, borderColor: 'rgba(0,0,0,0.25)', borderWidth: 0.5 },
    label: { color: p.dir === 'up' ? up : dn },
  }))
  const hasSize = sizeMin != null && sizeMax != null && sizeMax > sizeMin
  const sizeFn = hasSize
    ? (val) => { const t = (val[2] - sizeMin) / (sizeMax - sizeMin); return 7 + Math.sqrt(Math.max(0, t)) * 24 }
    : () => 7
  const axisText = { color: ink.muted, fontSize: 10, fontFamily: CHART_FONT_FAMILY }
  const signedX = xMeta.unit === 'pct', signedY = yMeta.unit === 'pct'
  const markData = []
  if (signedX) markData.push({ xAxis: 0 })
  if (signedY) markData.push({ yAxis: 0 })
  // Quadrant tint: only when BOTH axes are signed around 0 — the "strong / weak"
  // read. TR (both up) faint green, BL (both down) faint red, off-diagonals bare.
  const quad = (signedX && signedY) ? {
    silent: true, animation: false,
    data: [
      [{ coord: [0, 0], itemStyle: { color: upFaint } }, { coord: ['max', 'max'] }],
      [{ coord: [0, 0], itemStyle: { color: dnFaint } }, { coord: ['min', 'min'] }],
    ],
  } : undefined
  return {
    animation: true,
    animationDuration: 400,
    animationDurationUpdate: 650,
    animationEasingUpdate: 'cubicOut',
    grid: { ...GRID_M, containLabel: false },
    tooltip: {
      trigger: 'item',
      backgroundColor: withAlpha(ink.elevated, 0.96),
      borderColor: withAlpha(ink.text, 0.12),
      textStyle: { color: ink.bright, fontSize: 11.5, fontFamily: CHART_FONT_FAMILY },
      formatter: (p) => `<b>${p.value[3]}</b><br/>${yMeta.label}: ${fmtVal(p.value[1], yMeta.unit)}<br/>${xMeta.label}: ${fmtVal(p.value[0], xMeta.unit)}`,
    },
    xAxis: {
      type: 'value', scale: true,
      axisLine: { lineStyle: { color: axisLine } },
      axisTick: { show: false },
      axisLabel: { ...axisText, formatter: (v) => fmtAxis(v, xMeta.unit) },
      splitLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLine: { lineStyle: { color: axisLine } },
      axisTick: { show: false },
      axisLabel: { ...axisText, formatter: (v) => fmtAxis(v, yMeta.unit), margin: 6 },
      splitLine: { lineStyle: { color: grid } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
    ],
    series: [{
      type: 'scatter', data, symbolSize: sizeFn, z: 2,
      label: { show: labelMode !== 'off', position: 'right', distance: 3, formatter: (p) => p.value[3], fontSize: 10, fontFamily: CHART_FONT_FAMILY, fontWeight: 600 },
      labelLayout: { hideOverlap: labelMode !== 'all' },
      emphasis: { focus: 'self', scale: 1.35, label: { show: true, fontWeight: 700 } },
      markLine: markData.length ? {
        silent: true, symbol: 'none', animation: false,
        lineStyle: { color: withAlpha(ink.text, 0.16), type: 'dashed', width: 1 },
        label: { show: false }, data: markData,
      } : undefined,
      markArea: quad,
    }],
  }
}

export default function ScatterWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}
  const patch = useCallback((p) => onOptsChange?.({ ...(opts || {}), ...p }), [opts, onOptsChange])

  // ── Saved universes (tabs). Migrate a Phase-2 single source/value into the
  // one-entry list so old widgets keep their view. ──
  const universes = useMemo(() => {
    if (Array.isArray(opts?.universes) && opts.universes.length) return opts.universes
    return [{ source: opts?.source || DEFAULTS.source, value: opts?.value ?? DEFAULTS.value,
              label: (opts?.value ?? DEFAULTS.value) === 'sp500' ? 'S&P 500' : (opts?.value || 'S&P 500') }]
  }, [opts?.universes, opts?.source, opts?.value])
  const active = Math.min(Math.max(0, opts?.activeUniverse ?? 0), universes.length - 1)
  const cur = universes[active] || universes[0]

  // ── TERM-079: follow the colour group's `list-ref` channel (opt-in, `opts.followList`).
  // While following, the list a same-group Watchlist widget shows IS this map's universe;
  // with nothing published, the map keeps its own active tab. Not following → the channel
  // is not even subscribed (null id), so a publish anywhere cannot re-render this map. ──
  const following = !!opts?.followList
  const linked = useChannel(following && color ? channelFor(KIND.LIST_REF, color) : null)
  // COV-10 — a Scanner on this group publishes a `scan` list-ref, which /api/scatter/data
  // cannot resolve. Following it would plot an EMPTY universe under a confident label, so
  // the map refuses it BY NAME (the tab says so) and keeps plotting its own universe.
  const linkedPlottable = !!linked && MAP_PLOTTABLE_LIST_SOURCES.has(linked.source)
  const showingLinked = following && linkedPlottable
  const linkedUnplottable = following && !!linked && !linkedPlottable
  const source = showingLinked ? linked.source : cur.source
  const value = showingLinked ? linked.value : cur.value
  const toggleFollow = useCallback(() => patch({ followList: !following }), [following, patch])
  // Picking a saved tab (or adding one) is an explicit choice of universe — it ends following.
  const pickTab = useCallback((i) => patch({ activeUniverse: i, ...(following ? { followList: false } : {}) }), [following, patch])
  const addUniverse = useCallback((it) => {
    const stop = following ? { followList: false } : {}
    const exists = universes.findIndex(u => u.source === it.source && (u.value ?? '') === (it.value ?? ''))
    if (exists >= 0) { patch({ activeUniverse: exists, ...stop }); return }
    patch({ universes: [...universes, { source: it.source, value: it.value, label: it.label }], activeUniverse: universes.length, ...stop })
  }, [universes, patch, following])
  const removeUniverse = useCallback((i) => {
    if (universes.length <= 1) return
    const next = universes.filter((_, j) => j !== i)
    patch({ universes: next, activeUniverse: Math.min(active, next.length - 1) })
  }, [universes, active, patch])

  const xKey = opts?.xKey || DEFAULTS.xKey
  const yKey = opts?.yKey || DEFAULTS.yKey
  const sizeKey = opts?.sizeKey || DEFAULTS.sizeKey
  const labelMode = opts?.labelMode || 'spotlight'   // 'spotlight' | 'all' | 'off'
  const cycleLabelMode = useCallback(() => {
    const order = ['spotlight', 'all', 'off']
    patch({ labelMode: order[(order.indexOf(labelMode) + 1) % 3] })
  }, [labelMode, patch])

  // ── Appearance (⚙) — same per-widget model + panel as the scanner widgets ──
  const placedTheme = usePlacedTheme(opts?.placedTheme)
  const settings = useMemo(() => mergeNhnlSettings(opts?.settings || null), [opts?.settings])
  const styleVars = useMemo(() => nhnlWidgetStyleVars(settings), [settings])
  const ink = useThemeInk(CHART_INK)
  const up = settings.upColor || ink.up
  const dn = settings.downColor || ink.down
  const rootRef = useRef(null)
  const gearRef = useRef(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const patchSettings = useCallback((p) => patch({ settings: { ...settings, ...p } }), [patch, settings])
  const resetSettings = useCallback(() => patch({ settings: nhnlDefaultsForTheme(placedTheme) }), [patch, placedTheme])
  const panelThemeVars = useMemo(
    () => (styleVars['--nh-bg'] ? menuThemeVars(settings.bgMode === 'gradient' ? settings.bgGradient?.top : settings.bg) : null) || null,
    [styleVars, settings])

  // ── Metric catalog + universe menu (static-ish) ──
  const { data: metricData } = useMobileSWR('/api/scatter/metrics', getFetcher, { dedupingInterval: 600_000, revalidateOnFocus: false })
  const METRICS = metricData?.metrics || []
  const metricByKey = useMemo(() => Object.fromEntries(METRICS.map(m => [m.key, m])), [METRICS])
  const metricGroups = useMemo(() => {
    const order = [], by = {}
    for (const m of METRICS) { if (!by[m.group]) { by[m.group] = []; order.push(m.group) } by[m.group].push({ key: m.key, label: m.label, hint: m.live ? 'live' : '' }) }
    return order.map(g => ({ label: g, items: by[g] }))
  }, [METRICS])
  const { data: uniData } = useMobileSWR('/api/scatter/universes', getFetcher, { dedupingInterval: 300_000, revalidateOnFocus: false })
  const uniGroups = useMemo(() =>
    (uniData?.groups || []).map(g => ({ label: g.group, items: g.items.map(it => ({ key: `${it.source}:${it.value ?? ''}`, label: it.label, source: it.source, value: it.value })) })),
    [uniData])

  // ── The universe bundle (daily metrics + a first live snapshot) ──
  const dataUrl = `/api/scatter/data?source=${encodeURIComponent(source)}&value=${encodeURIComponent(value ?? '')}`
  const { data, error: dataError, mutate: retryData, isValidating } = useMobileSWR(dataUrl, getFetcher, {
    refreshInterval: 45_000, dedupingInterval: 20_000, revalidateOnFocus: false, keepPreviousData: true,
  })
  const baseTickers = useMemo(() => (data?.tickers || []).map(t => t.sym), [data])
  const tickersKey = baseTickers.join(',')

  // Make clicking any plotted point fast: warm the whole visible universe's daily
  // bars into IDB (+ top rows to sync mem) up front, so a click paints from cache
  // instead of a cold ~150ms /api/bars fetch on landing. Bounded / idle-deferred /
  // backpressure-guarded + capped (500) inside prewarmVisibleList. Market Map is
  // click-driven (no arrow nav), so there are no ±neighbors to promote — the
  // whole-set warm is the instant-scan equivalent here.
  useEffect(() => {
    if (baseTickers.length) prewarmVisibleList(baseTickers, { chartTf: 'D' })
  }, [baseTickers])

  // ── Live overlay — fast poll so the dots glide (POST the known ticker set).
  // The server serves a REGULAR-SESSION snapshot that freezes at 4pm, so off-hours
  // this just re-reads the frozen close; we back the cadence off when it's closed. ──
  const [live, setLive] = useState({})
  const [liveCf, setLiveCf] = useState(1)
  const rth = data?.rth !== false
  useEffect(() => {
    if (!baseTickers.length) { setLive({}); return undefined }
    let alive = true
    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const r = await fetch('/api/scatter/live', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: baseTickers }),
        })
        const j = r.ok ? await r.json() : null
        if (alive && j?.points) { setLive(j.points); if (typeof j.cumfrac === 'number') setLiveCf(j.cumfrac) }
      } catch { /* keep last */ }
    }
    poll()
    const id = setInterval(poll, rth ? 5000 : 30000)
    return () => { alive = false; clearInterval(id) }
  }, [tickersKey, rth])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Merge daily + live, then project onto the chosen X / Y / Size. RVOL is a
  // run rate: (today_vol / cumfrac) / avg_vol, so it projects to full-day intraday
  // and is the frozen full-day RVOL once cumfrac hits 1.0 at the close. ──
  const cf = Math.max(liveCf || data?.cumfrac || 1, 0.08)
  const points = useMemo(() => (data?.tickers || []).map(p => {
    const lv = live[p.sym]
    const m = lv ? { ...p.m, ...lv } : p.m
    if (lv && lv.vol_today != null && p.m.avg_vol_30d) m.rvol = +((lv.vol_today / cf) / p.m.avg_vol_30d).toFixed(2)
    return { sym: p.sym, dir: (lv && lv.dir) || p.dir, m }
  }), [data, live, cf])

  const plot = useMemo(() => {
    const out = []
    for (const p of points) {
      const x = p.m[xKey], y = p.m[yKey]
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) continue
      const size = sizeKey ? p.m[sizeKey] : null
      if (sizeKey && (size == null || !isFinite(size))) continue
      out.push({ sym: p.sym, dir: p.dir, x, y, size })
    }
    return out
  }, [points, xKey, yKey, sizeKey])

  const [sizeMin, sizeMax] = useMemo(() => {
    if (!sizeKey || !plot.length) return [null, null]
    let lo = Infinity, hi = -Infinity
    for (const p of plot) { if (p.size < lo) lo = p.size; if (p.size > hi) hi = p.size }
    return [lo, hi]
  }, [plot, sizeKey])

  const xMeta = metricByKey[xKey] || { label: xKey, unit: 'num' }
  const yMeta = metricByKey[yKey] || { label: yKey, unit: 'num' }
  const quadrant = xMeta.unit === 'pct' && yMeta.unit === 'pct'
  const option = useMemo(() => makeOption({
    plot, xMeta, yMeta, up, dn, sizeMin, sizeMax, labelMode,
    upFaint: faint(up, 0.07), dnFaint: faint(dn, 0.07), ink,
  }), [plot, xMeta, yMeta, up, dn, sizeMin, sizeMax, labelMode, ink])

  // ── ECharts instance: resize with the cell, click a point → color group ──
  const chartRef = useRef(null)
  const wrapRef = useRef(null)
  // Observe the ALWAYS-MOUNTED root (not the chart wrapper, which doesn't exist
  // until data loads — the effect would attach to null and never fire, so the
  // chart only resized on drag-release). rAF-batch → one resize per frame, so the
  // scatter tracks a live border-drag smoothly. animation:0 = instant reflow.
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try { chartRef.current?.getEchartsInstance?.().resize({ animation: { duration: 0 } }) } catch { /* not ready */ }
      })
    })
    ro.observe(el)
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  const onPoint = useCallback((p) => {
    const sym = p?.value?.[3] || p?.name
    if (sym && color) setGroupSym?.(color, sym)
  }, [color, setGroupSym])
  const zoom = useCallback((factor) => {
    const inst = chartRef.current?.getEchartsInstance?.()
    if (!inst) return
    const dz = (inst.getOption().dataZoom || [])
    const batch = dz.map((z, i) => {
      const s = z.start ?? 0, e = z.end ?? 100, mid = (s + e) / 2, half = (e - s) / 2 * factor
      return { dataZoomIndex: i, start: Math.max(0, mid - half), end: Math.min(100, mid + half) }
    })
    inst.dispatchAction({ type: 'dataZoom', batch })
  }, [])
  const resetZoom = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance?.()
    inst?.dispatchAction({ type: 'dataZoom', batch: [{ dataZoomIndex: 0, start: 0, end: 100 }, { dataZoomIndex: 1, start: 0, end: 100 }] })
  }, [])

  // ── Axis / universe / size menus. The open menu carries its own anchor element
  // (captured at click time) so we never read a ref during render. ──
  const [menu, setMenu] = useState(null)   // { type: 'x'|'y'|'size'|'uni', anchor }
  const toggleMenu = useCallback((type, e) => {
    const el = e.currentTarget
    setMenu(m => (m?.type === type ? null : { type, anchor: el }))
  }, [])
  const closeMenu = useCallback(() => setMenu(null), [])

  return (
    <div ref={rootRef} className={chrome.wrap} style={styleVars}>
      {settingsOpen && (
        <NhnlSettingsPanel settings={settings} onChange={patchSettings} onReset={resetSettings}
          onClose={() => setSettingsOpen(false)} gearEl={gearRef.current} hostEl={rootRef.current}
          themeVars={panelThemeVars} title="Market Map Settings" widgetType="scatter" />
      )}

      {/* Toolbar: a row of saved-universe TABS (switch / delete) + a ＋ to add one;
          gear on the right. The X/Y axes are chosen by clicking the axis titles. */}
      <div className={chrome.toolbar}>
        <div className={styles.uniTabs}>
          {universes.map((u, i) => (
            <span key={`${u.source}:${u.value ?? ''}:${i}`}
              className={`${styles.uniTab}${i === active && !showingLinked ? ' ' + styles.uniTabActive : ''}`}
              role="button" tabIndex={0} onClick={() => pickTab(i)}>
              <span className={styles.uniTabLabel}>{u.label || u.value || 'Universe'}</span>
              {i === active && !showingLinked && !!plot.length && <span className={styles.uniTabCount}>{plot.length}</span>}
              {universes.length > 1 && (
                <span className={styles.uniTabX} role="button" tabIndex={-1} aria-label="Remove universe"
                  title="Remove" onClick={(e) => { e.stopPropagation(); removeUniverse(i) }}>
                  <UIcon name="x" size={8} gold={false} />
                </span>
              )}
            </span>
          ))}
          <button type="button" className={styles.uniAdd} onClick={(e) => toggleMenu('uni', e)}
            title="Add a universe" aria-label="Add a universe">
            <UIcon name="plus" size={13} gold={false} />
          </button>
          {following && (
            <span className={`${styles.uniTab} ${showingLinked ? styles.uniTabActive : styles.uniTabIdle}`}
              title={showingLinked
                ? `Following the list shown in this group's watchlist`
                : linkedUnplottable
                  ? `The linked list is a ${linked.source}, which the map cannot plot — showing ${cur.label || 'its own universe'} instead`
                  : `Pick a list in a watchlist on this colour group to plot it here`}>
              <UIcon name="link" size={10} gold={false} />
              <span className={styles.uniTabLabel}>
                {showingLinked
                  ? (linked.label || linked.value || linked.source)
                  : linkedUnplottable
                    ? `Can't plot ${linked.label || linked.value || linked.source}`
                    : 'No linked list'}
              </span>
              {showingLinked && !!plot.length && <span className={styles.uniTabCount}>{plot.length}</span>}
            </span>
          )}
        </div>
        <button type="button" className={`${styles.uniAdd} ${following ? styles.uniFollowOn : ''}`}
          onClick={toggleFollow} aria-pressed={following}
          title={following ? 'Stop following the linked list' : "Follow the list picked in this colour group's watchlist"}
          aria-label="Follow the linked list">
          <UIcon name="link" size={12} gold={false} />
        </button>
        <span className={chrome.spacer} />
        <button ref={gearRef} type="button" className={`${chrome.gear} ${settingsOpen ? chrome.gearOn : ''}`}
          onClick={() => setSettingsOpen(o => !o)} title="Market Map settings" aria-label="Market Map settings">
          <UIcon name="gear" size={13} gold={false} />
        </button>
      </div>

      <div className={styles.stage}>
        {!baseTickers.length ? (
          (dataError && !data && !isValidating) ? (
            <div className={styles.hint} role="alert">
              This universe could not be loaded.{' '}
              <button type="button" className={chrome.retry} onClick={() => retryData()}>Retry</button>
            </div>
          ) : (
            <div className={styles.hint}>{isValidating ? 'Loading universe…' : 'No data for this universe yet.'}</div>
          )
        ) : (
          <>
            <div ref={wrapRef} className={styles.chartWrap}>
              <ReactECharts ref={chartRef} option={option} notMerge={false} lazyUpdate
                style={{ height: '100%', width: '100%' }}
                onEvents={{ click: onPoint }} />
            </div>

            {/* Quadrant reads — only when both axes are signed around zero */}
            {quadrant && (
              <>
                <span className={`${styles.quad} ${styles.quadTR}`} style={{ color: up }}>Strong</span>
                <span className={`${styles.quad} ${styles.quadBL}`} style={{ color: dn }}>Weak</span>
              </>
            )}

            {/* Axis-title dropdowns — the signature layout. Y lives in a full-height
                left column so the rotated label is always centered + never clipped. */}
            <div className={styles.axisYCol}>
              <button type="button" className={`${styles.axisSel} ${styles.axisYBtn}`} onClick={(e) => toggleMenu('y', e)}>
                {yMeta.label}<UIcon name="chevronDown" size={9} gold={false} />
              </button>
            </div>
            <button type="button" className={`${styles.axisSel} ${styles.axisX}`} onClick={(e) => toggleMenu('x', e)}>
              {xMeta.label}<UIcon name="chevronDown" size={9} gold={false} />
            </button>
            <button type="button" className={styles.axisSize} onClick={(e) => toggleMenu('size', e)}>
              <UIcon name="scale" size={11} gold={false} />
              Size: {sizeKey ? (metricByKey[sizeKey]?.label || sizeKey) : 'Uniform'}
            </button>
            <button type="button" className={styles.labelBtn} onClick={cycleLabelMode}
              title="Cycle ticker labels (spotlight / all / off)">
              <UIcon name="markets" size={10} gold={false} />
              Labels: {labelMode === 'spotlight' ? 'Spotlight' : labelMode === 'all' ? 'All' : 'Off'}
            </button>

            <div className={styles.zoom}>
              <button type="button" className={styles.zoomBtn} onClick={() => zoom(0.7)} title="Zoom in" aria-label="Zoom in">+</button>
              <button type="button" className={styles.zoomBtn} onClick={() => zoom(1 / 0.7)} title="Zoom out" aria-label="Zoom out">−</button>
              <button type="button" className={styles.zoomBtn} onClick={resetZoom} title="Reset zoom" aria-label="Reset zoom">
                <UIcon name="refresh" size={12} gold={false} />
              </button>
            </div>
          </>
        )}
      </div>

      {menu?.type === 'uni' && (
        <DropMenu groups={uniGroups} selectedKey={`${source}:${value ?? ''}`} anchorEl={menu.anchor} themeVars={panelThemeVars}
          onPick={addUniverse} onClose={closeMenu} searchable />
      )}
      {menu?.type === 'x' && (
        <DropMenu groups={metricGroups} selectedKey={xKey} anchorEl={menu.anchor} themeVars={panelThemeVars}
          onPick={(it) => patch({ xKey: it.key })} onClose={closeMenu} />
      )}
      {menu?.type === 'y' && (
        <DropMenu groups={metricGroups} selectedKey={yKey} anchorEl={menu.anchor} themeVars={panelThemeVars}
          onPick={(it) => patch({ yKey: it.key })} onClose={closeMenu} />
      )}
      {menu?.type === 'size' && (
        <DropMenu
          groups={[{ label: '', items: [{ key: '', label: 'Uniform (no size)' }] }, ...metricGroups]}
          selectedKey={sizeKey} anchorEl={menu.anchor} themeVars={panelThemeVars} align="right"
          onPick={(it) => patch({ sizeKey: it.key })} onClose={closeMenu} />
      )}
    </div>
  )
}
