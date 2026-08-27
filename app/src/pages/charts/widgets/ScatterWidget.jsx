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

const getFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

const GREEN = '#34d17c'
const RED = '#f24b42'
const GRID = 'rgba(255,255,255,0.06)'

const DEFAULTS = { source: 'index', value: 'sp500', xKey: 'rvol', yKey: 'chg_today', sizeKey: '' }

// ── value formatting by metric unit ──
function abbrev(v) {
  const a = Math.abs(v)
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toFixed(0)
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
function faint(hex, a) {
  const m = /^#([0-9a-f]{6})/i.exec(hex || '')
  if (!m) return `rgba(52,209,124,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
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
function DropMenu({ groups, selectedKey, onPick, onClose, anchorEl, themeVars, align = 'left' }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
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
  return createPortal((
    <div ref={ref} className={styles.menu}
      style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { visibility: 'hidden' }) }}>
      {groups.map((g, gi) => (
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

function makeOption({ plot, xMeta, yMeta, up, dn, sizeMin, sizeMax, labelMode, upFaint, dnFaint }) {
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
  const axisText = { color: '#a9a9b2', fontSize: 10, fontFamily: CHART_FONT_FAMILY }
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
      backgroundColor: 'rgba(18,18,22,0.96)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: '#f2f2f5', fontSize: 11.5, fontFamily: CHART_FONT_FAMILY },
      formatter: (p) => `<b>${p.value[3]}</b><br/>${yMeta.label}: ${fmtVal(p.value[1], yMeta.unit)}<br/>${xMeta.label}: ${fmtVal(p.value[0], xMeta.unit)}`,
    },
    xAxis: {
      type: 'value', scale: true,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
      axisTick: { show: false },
      axisLabel: { ...axisText, formatter: (v) => fmtAxis(v, xMeta.unit) },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
      axisTick: { show: false },
      axisLabel: { ...axisText, formatter: (v) => fmtAxis(v, yMeta.unit), margin: 6 },
      splitLine: { lineStyle: { color: GRID } },
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
        lineStyle: { color: 'rgba(255,255,255,0.16)', type: 'dashed', width: 1 },
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
  const source = cur.source, value = cur.value
  const addUniverse = useCallback((it) => {
    const exists = universes.findIndex(u => u.source === it.source && (u.value ?? '') === (it.value ?? ''))
    if (exists >= 0) { patch({ activeUniverse: exists }); return }
    patch({ universes: [...universes, { source: it.source, value: it.value, label: it.label }], activeUniverse: universes.length })
  }, [universes, patch])
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
  const up = settings.upColor || GREEN
  const dn = settings.downColor || RED
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
  const { data, isValidating } = useMobileSWR(dataUrl, getFetcher, {
    refreshInterval: 45_000, dedupingInterval: 20_000, revalidateOnFocus: false, keepPreviousData: true,
  })
  const baseTickers = useMemo(() => (data?.tickers || []).map(t => t.sym), [data])
  const tickersKey = baseTickers.join(',')

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
    upFaint: faint(up, 0.07), dnFaint: faint(dn, 0.07),
  }), [plot, xMeta, yMeta, up, dn, sizeMin, sizeMax, labelMode])

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
          themeVars={panelThemeVars} title="Market Map Settings" />
      )}

      {/* Toolbar: a row of saved-universe TABS (switch / delete) + a ＋ to add one;
          gear on the right. The X/Y axes are chosen by clicking the axis titles. */}
      <div className={chrome.toolbar}>
        <div className={styles.uniTabs}>
          {universes.map((u, i) => (
            <span key={`${u.source}:${u.value ?? ''}:${i}`}
              className={`${styles.uniTab}${i === active ? ' ' + styles.uniTabActive : ''}`}
              role="button" tabIndex={0} onClick={() => patch({ activeUniverse: i })}>
              <span className={styles.uniTabLabel}>{u.label || u.value || 'Universe'}</span>
              {i === active && !!plot.length && <span className={styles.uniTabCount}>{plot.length}</span>}
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
        </div>
        <span className={chrome.spacer} />
        <button ref={gearRef} type="button" className={`${chrome.gear} ${settingsOpen ? chrome.gearOn : ''}`}
          onClick={() => setSettingsOpen(o => !o)} title="Market Map settings" aria-label="Market Map settings">
          <UIcon name="gear" size={13} gold={false} />
        </button>
      </div>

      <div className={styles.stage}>
        {!baseTickers.length ? (
          <div className={styles.hint}>{isValidating ? 'Loading universe…' : 'No data for this universe yet.'}</div>
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
          onPick={addUniverse} onClose={closeMenu} />
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
