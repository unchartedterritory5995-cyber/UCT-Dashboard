// SCAT: a scatter of a whole universe on two metrics (wave 8, lane E). By default RS rank against
// % off the 52-week high, so leaders near their highs sit top right.
//
// ⭐ NO NEW ROUTE, NO NEW DEPENDENCY. The /charts Market Map's own reads: `/api/scatter/metrics`
// (the axis catalog, so every axis choice is one the server can fill), `/api/scatter/universes` and
// `/api/scatter/data` (the per-ticker bundle), all paid. The chart is the same echarts-for-react the
// Market Map draws with. Market Map is not embedded: it is a /charts widget bound to colour groups
// and saved widget options; here a dot opens DES beside the panel instead.
//
// ⛔ A failed read is an error with Retry, never an empty plot. A name missing either value is
// counted and said, never drawn at zero.
//
// ⭐ THE VIEW IS THE COMMAND (wave 9, lane 2). `SCAT NDX CHG_1M RS_RANK` opens the Nasdaq 100 with
// 1-month % up and RS rating across (scatterArgs.js has the grammar). A pick in the toolbar is
// written back through usePanelRerun, so `?cmd=`, history and a reload keep it. The re-run
// remounts this panel with the new props, so a pick only re-runs when the view CHANGED (picking
// the value already showing does nothing) and nothing re-runs from an effect. A member's own
// list cannot be written into a command: it is kept for the open panel, and the panel says so.
import { useCallback, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, usePanelRerun, usePanelRun } from '../../../components/terminal'
import {
  formatCompact, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { CHROME_INK, SEMANTIC_INK, useThemeInk, withAlpha } from '../../../lib/theme'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import Select from '../../../components/ui/Select'
import { useHasCoarsePointer } from '../../../hooks/useBreakpoint'
import { failureText, useMarketRead } from './marketRead'
import { SCAT_DEFAULT, SCAT_INDEXES, scatCommand } from '../scatterArgs'
import styles from './marketPanels.module.css'

export const METRICS_URL = '/api/scatter/metrics'
export const UNIVERSES_URL = '/api/scatter/universes'
export const dataUrl = (source, value) => `/api/scatter/data?source=${encodeURIComponent(source)}&value=${encodeURIComponent(value ?? '')}`
export const DEFAULTS = SCAT_DEFAULT
const POLL_MS = 60 * 1000

// Dot inks: the theme's text-safe success / danger inks, so the dots read on every theme.
const INK = {
  up: ['--success-ink', SEMANTIC_INK.gain[1]], down: ['--danger-ink', SEMANTIC_INK.loss[1]],
  text: CHROME_INK.text, muted: CHROME_INK.muted, bright: CHROME_INK.bright, elevated: CHROME_INK.elevated,
}

/** A metric value in its own unit (the catalog's `unit`). */
export function fmtMetric(v, unit) {
  if (v == null || !Number.isFinite(v)) return 'n/a'
  switch (unit) {
    case 'pct': return formatPercent(v, { decimals: 1, signed: true })
    case 'pct0': return formatPercent(v, { decimals: 0 })
    case 'x': return `${formatNumber(v, { decimals: 2 })}x`
    case 'usd': return formatCurrency(v, { decimals: 2 })
    case 'usd_big': return formatCompact(v, { prefix: '$' })
    case 'big': return formatCompact(v)
    default: return formatNumber(v, { decimals: Math.abs(v) >= 100 ? 0 : 1 })
  }
}

/** Pure: the plotted points and how many names lacked a value on either axis. */
export function scatterPoints(body, xKey, yKey) {
  const out = []
  let missing = 0
  for (const t of Array.isArray(body?.tickers) ? body.tickers : []) {
    if (!t || !t.sym) continue
    const x = Number(t.m?.[xKey])
    const y = Number(t.m?.[yKey])
    if (t.m?.[xKey] == null || t.m?.[yKey] == null || !Number.isFinite(x) || !Number.isFinite(y)) { missing += 1; continue }
    out.push({ sym: String(t.sym).toUpperCase(), name: t.name || '', x, y, dir: t.dir === 'down' ? 'down' : 'up' })
  }
  return { points: out, missing }
}

/** Pure: the universe menu as option groups; the current pick is kept even when the menu is absent. */
export function universeOptions(body, current) {
  const groups = (Array.isArray(body?.groups) ? body.groups : [])
    .map((g) => ({ label: g.group || '', items: (g.items || []).filter((it) => it && it.source).map((it) => ({
      key: `${it.source}:${it.value ?? ''}`, label: it.label || it.value || it.source, source: it.source, value: it.value ?? '',
    })) }))
    .filter((g) => g.items.length)
  const curKey = `${current.source}:${current.value ?? ''}`
  if (!groups.some((g) => g.items.some((it) => it.key === curKey))) {
    groups.unshift({ label: '', items: [{ key: curKey, label: current.label || 'S&P 500', source: current.source, value: current.value }] })
  }
  return groups
}

function makeOption({ points, xMeta, yMeta, ink, coarse }) {
  const axisText = { color: ink.muted, fontSize: 10, fontFamily: CHART_FONT_FAMILY }
  const grid = withAlpha(ink.text, 0.08)
  const axis = (meta) => ({
    type: 'value', scale: true, name: meta.label, nameLocation: 'middle', nameGap: 28,
    nameTextStyle: { ...axisText, color: ink.text },
    axisLabel: { ...axisText }, axisTick: { show: false },
    axisLine: { lineStyle: { color: withAlpha(ink.text, 0.2) } }, splitLine: { lineStyle: { color: grid } },
  })
  return {
    animation: false,
    grid: { left: 52, right: 18, top: 14, bottom: 44 },
    tooltip: {
      trigger: 'item',
      // A tap shows the tooltip as a hover does, and it stays inside the chart on a 390px phone.
      triggerOn: 'mousemove|click',
      confine: true,
      backgroundColor: withAlpha(ink.elevated, 0.96),
      borderColor: withAlpha(ink.text, 0.12),
      textStyle: { color: ink.bright, fontSize: 11, fontFamily: CHART_FONT_FAMILY },
      formatter: (p) => `<b>${p.value[2]}</b><br/>${yMeta.label}: ${fmtMetric(p.value[1], yMeta.unit)}<br/>${xMeta.label}: ${fmtMetric(p.value[0], xMeta.unit)}<br/>Click to load it`,
    },
    xAxis: axis(xMeta),
    yAxis: { ...axis(yMeta), nameGap: 38 },
    // On a touch screen a one-finger drag scrolls the page, not the plot (pinch still zooms), so a
    // tall chart never traps the swipe that should move past it.
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', moveOnMouseMove: !coarse },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none', moveOnMouseMove: !coarse },
    ],
    series: [{
      type: 'scatter', symbolSize: 7, cursor: 'pointer',
      data: points.map((p) => ({ name: p.sym, value: [p.x, p.y, p.sym], itemStyle: { color: p.dir === 'down' ? ink.down : ink.up, opacity: 0.85 } })),
      emphasis: { scale: 1.5, label: { show: true, formatter: (p) => p.value[2], position: 'right', color: ink.bright, fontSize: 10 } },
    }],
  }
}

/** Pure: the view a command's props open (`universe` from scatUniverse, `yKey` / `xKey` keys). */
export function initialView({ universe = null, yKey = null, xKey = null } = {}) {
  const u = universe && universe.source ? universe
    : { source: DEFAULTS.source, value: DEFAULTS.value, label: SCAT_INDEXES[DEFAULTS.value][0] }
  return { pick: { source: u.source, value: u.value ?? '', label: u.label }, yKey: yKey || DEFAULTS.yKey, xKey: xKey || DEFAULTS.xKey }
}

export default function ScatterPanel({ universe = null, yKey: yProp = null, xKey: xProp = null } = {}) {
  const inPanel = useInTerminalPanel()
  // Linked panels (2026-10-09): a dot LOADS its name into this panel's group, like a list row.
  const run = usePanelRun()
  const rerun = usePanelRerun()
  const [view, setView] = useState(() => initialView({ universe, yKey: yProp, xKey: xProp }))
  const { pick, yKey, xKey } = view
  const metrics = useMarketRead(METRICS_URL)
  const universes = useMarketRead(UNIVERSES_URL)
  const read = useMarketRead(dataUrl(pick.source, pick.value), { refreshInterval: POLL_MS })
  const ink = useThemeInk(INK)
  const coarse = useHasCoarsePointer()

  const catalog = useMemo(() => (Array.isArray(metrics.body?.metrics) ? metrics.body.metrics : []).filter((m) => m && m.key), [metrics.body])
  const metaOf = useCallback((k) => catalog.find((m) => m.key === k) || { key: k, label: k, unit: 'num' }, [catalog])
  const xMeta = metaOf(xKey)
  const yMeta = metaOf(yKey)
  const groups = useMemo(() => universeOptions(universes.body, pick), [universes.body, pick])
  const { points, missing } = useMemo(() => scatterPoints(read.body, xKey, yKey), [read.body, xKey, yKey])
  const option = useMemo(() => makeOption({ points, xMeta, yMeta, ink, coarse }), [points, xMeta, yMeta, ink, coarse])
  const onPoint = useCallback((p) => {
    const sym = p?.value?.[2] || p?.name
    if (sym && run) run(`$${String(sym).toUpperCase()}`)
  }, [run])
  usePanelFreshness(points.length ? { source: 'UCT Market Map (nightly metrics and a live snapshot)', asOf: read.receivedAt } : null)

  // One door for every pick: the same view is a no-op; a changed one is kept here and, when it can
  // be written, re-run as this panel's command so a reload keeps it.
  const commit = (next) => {
    const same = next.pick.source === pick.source && String(next.pick.value ?? '') === String(pick.value ?? '')
      && next.yKey === yKey && next.xKey === xKey
    if (same) return
    setView(next)
    const cmd = scatCommand({ source: next.pick.source, value: next.pick.value, yKey: next.yKey, xKey: next.xKey })
    if (cmd && rerun) rerun(cmd)
  }
  const unsaved = scatCommand({ source: pick.source, value: pick.value, yKey, xKey }) === null

  const onUniverse = (e) => {
    const [source, ...rest] = e.target.value.split(':')
    const value = rest.join(':')
    const item = groups.flatMap((g) => g.items).find((it) => it.key === e.target.value)
    commit({ ...view, pick: { source, value, label: item?.label || value || source } })
  }
  const setYKey = (k) => commit({ ...view, yKey: k })
  const setXKey = (k) => commit({ ...view, xKey: k })

  if (metrics.loading) return <PanelSkeleton label="Loading the scatter axes" testId="terminal-scat-loading" />
  if (metrics.error && !metrics.body) {
    const locked = metrics.error?.status === 402
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(metrics.error, 'The scatter axes')} testId="terminal-scat-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={metrics.retry}>Retry</button>}>
        {locked ? null : 'Retry, or run SCAT again.'}
      </PanelState>
    )
  }

  const axisSelect = (label, value, set, testId) => (
    <label className={styles.muted}>
      {label}{' '}
      <Select value={value} onChange={(e) => set(e.target.value)} data-testid={testId} className={styles.chip}>
        {[...new Set(catalog.map((m) => m.group || ''))].map((g) => (
          <optgroup key={g} label={g || 'Metrics'}>
            {catalog.filter((m) => (m.group || '') === g).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </optgroup>
        ))}
      </Select>
    </label>
  )

  let body
  if (read.loading) body = <PanelSkeleton label="Loading the universe" testId="terminal-scat-data-loading" />
  else if (read.error && !read.body) {
    const locked = read.error?.status === 402
    body = (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, 'This universe')} testId="terminal-scat-data-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as an empty universe. Retry, or pick another.'}
      </PanelState>
    )
  } else if (!points.length) {
    body = (
      <PanelState kind="empty" title="Nothing to plot for these axes." testId="terminal-scat-empty">
        {missing ? `${missing} name${missing === 1 ? '' : 's'} lack a value on one of the two axes.` : 'This universe has no names yet.'}
      </PanelState>
    )
  } else {
    body = (
      <div className={styles.scatStage} data-testid="terminal-scat-chart">
        <ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} onEvents={{ click: onPoint }} />
      </div>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-scat">
      <div className={styles.toolbar}>
        <label className={styles.muted}>
          Universe{' '}
          <Select value={`${pick.source}:${pick.value ?? ''}`} onChange={onUniverse} data-testid="terminal-scat-universe" className={styles.chip}>
            {groups.map((g, gi) => (
              <optgroup key={`${g.label}-${gi}`} label={g.label || 'Current'}>
                {g.items.map((it) => <option key={it.key} value={it.key}>{it.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </label>
        {axisSelect('Y', yKey, setYKey, 'terminal-scat-y')}
        {axisSelect('X', xKey, setXKey, 'terminal-scat-x')}
      </div>
      {read.error && read.body ? <p className={styles.note} role="status">{failureText(read.error, 'This universe')} Showing the last read.</p> : null}
      {unsaved ? (
        <p className={styles.muted} role="status" data-testid="terminal-scat-unsaved">
          This list is not saved in the command, so a reload will not keep it.
        </p>
      ) : null}
      {body}
      <p className={styles.muted} data-testid="terminal-scat-method">
        {points.length ? `${points.length} name${points.length === 1 ? '' : 's'} plotted. ` : ''}
        {points.length && missing ? `${missing} left out for a missing value. ` : ''}
        Green closed up today, red down. Click a dot to load it into the linked panels; scroll or pinch to zoom.
        {read.receivedAt ? ` Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
