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
      const W = 230
      let left = align === 'right' ? r.right - W : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - W - 8))
      let top = r.bottom + 5
      const H = Math.min(Math.round(window.innerHeight * 0.62), 460)
      if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - 5 - H)
      setPos({ left: Math.round(left), top: Math.round(top), width: W })
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
      style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }) }}>
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

function makeOption({ plot, xMeta, yMeta, up, dn, sizeMin, sizeMax }) {
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
  const markData = []
  if (xMeta.unit === 'pct') markData.push({ xAxis: 0 })
  if (yMeta.unit === 'pct') markData.push({ yAxis: 0 })
  return {
    animation: true,
    animationDuration: 400,
    animationDurationUpdate: 650,
    animationEasingUpdate: 'cubicOut',
    grid: { left: 46, right: 16, top: 14, bottom: 34, containLabel: true },
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
      axisLabel: { ...axisText, formatter: (v) => fmtAxis(v, yMeta.unit) },
      splitLine: { lineStyle: { color: GRID } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
    ],
    series: [{
      type: 'scatter', data, symbolSize: sizeFn, z: 2,
      label: { show: true, position: 'right', distance: 3, formatter: (p) => p.value[3], fontSize: 10, fontFamily: CHART_FONT_FAMILY, fontWeight: 600 },
      labelLayout: { hideOverlap: true },
      emphasis: { focus: 'self', scale: 1.35, label: { show: true, fontWeight: 700 } },
      markLine: markData.length ? {
        silent: true, symbol: 'none', animation: false,
        lineStyle: { color: 'rgba(255,255,255,0.16)', type: 'dashed', width: 1 },
        label: { show: false }, data: markData,
      } : undefined,
    }],
  }
}

export default function ScatterWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}
  const source = opts?.source || DEFAULTS.source
  const value = opts?.value ?? DEFAULTS.value
  const xKey = opts?.xKey || DEFAULTS.xKey
  const yKey = opts?.yKey || DEFAULTS.yKey
  const sizeKey = opts?.sizeKey || DEFAULTS.sizeKey
  const patch = useCallback((p) => onOptsChange?.({ ...(opts || {}), ...p }), [opts, onOptsChange])

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

  // ── Live overlay — fast poll so the dots glide (POST the known ticker set) ──
  const [live, setLive] = useState({})
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
        if (alive && j?.points) setLive(j.points)
      } catch { /* keep last */ }
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { alive = false; clearInterval(id) }
  }, [tickersKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Merge daily + live, then project onto the chosen X / Y / Size ──
  const points = useMemo(() => (data?.tickers || []).map(p => {
    const lv = live[p.sym]
    const m = lv ? { ...p.m, ...lv } : p.m
    if (lv && lv.vol_today != null && p.m.avg_vol_30d) m.rvol = +(lv.vol_today / p.m.avg_vol_30d).toFixed(2)
    return { sym: p.sym, dir: (lv && lv.dir) || p.dir, m }
  }), [data, live])

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
  const option = useMemo(() => makeOption({ plot, xMeta, yMeta, up, dn, sizeMin, sizeMax }),
    [plot, xMeta, yMeta, up, dn, sizeMin, sizeMax])

  // ── ECharts instance: resize with the cell, click a point → color group ──
  const chartRef = useRef(null)
  const wrapRef = useRef(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { try { chartRef.current?.getEchartsInstance?.().resize() } catch { /* not ready */ } })
    ro.observe(el)
    return () => ro.disconnect()
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
  const label = data?.label || 'Universe'

  return (
    <div ref={rootRef} className={chrome.wrap} style={styleVars}>
      {settingsOpen && (
        <NhnlSettingsPanel settings={settings} onChange={patchSettings} onReset={resetSettings}
          onClose={() => setSettingsOpen(false)} gearEl={gearRef.current} hostEl={rootRef.current}
          themeVars={panelThemeVars} title="Market Map Settings" />
      )}

      {/* Toolbar: the universe pill (left) + gear (right). The X/Y axes are chosen
          by clicking the axis titles on the chart itself. */}
      <div className={chrome.toolbar}>
        <button type="button" className={styles.uniBtn} onClick={(e) => toggleMenu('uni', e)}>
          <UIcon name="markets" size={13} gold={false} />
          <span className={styles.uniLabel}>{label}</span>
          {!!plot.length && <span className={styles.uniCount}>{plot.length}</span>}
        </button>
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

            {/* Axis-title dropdowns — the signature layout */}
            <button type="button" className={`${styles.axisSel} ${styles.axisY}`} onClick={(e) => toggleMenu('y', e)}>
              {yMeta.label}<UIcon name="chevronDown" size={9} gold={false} />
            </button>
            <button type="button" className={`${styles.axisSel} ${styles.axisX}`} onClick={(e) => toggleMenu('x', e)}>
              {xMeta.label}<UIcon name="chevronDown" size={9} gold={false} />
            </button>
            <button type="button" className={styles.axisSize} onClick={(e) => toggleMenu('size', e)}>
              <UIcon name="scale" size={11} gold={false} />
              Size: {sizeKey ? (metricByKey[sizeKey]?.label || sizeKey) : 'Uniform'}
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
          onPick={(it) => patch({ source: it.source, value: it.value })} onClose={closeMenu} />
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
