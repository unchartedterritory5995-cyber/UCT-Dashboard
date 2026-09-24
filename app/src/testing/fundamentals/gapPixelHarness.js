// Dev-only: see fundamentals-gap-harness.html. Draws one golden case through the
// REAL binder on the REAL renderer and publishes, for the pixel scan, the pixel
// columns where a line MUST NOT be (inside a canonical gap) and where one MUST be
// (a continuous stretch -- the control that stops "fix it by drawing nothing").
import * as LWC from 'lightweight-charts'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { createBinder } from '../../components/chart/engine/binder'
import { _points, primeFundamentalsCatalog } from '../../components/chart/engine/fundamentalSeries'
import GOLDEN from '../../components/chart/engine/__tests__/fixtures/fundamentalsGolden.v4.json'

const CASES = {
  // gap [from, to] = the first and last UNKNOWN bar; control = a continuous stretch
  'tsla-eps': { sym: 'TSLA', metric: 'eps_diluted_ttm', ma: true,
    gap: ['2025-04-24', '2026-01-28'], control: ['2024-02-01', '2025-04-15'] },
  'tsla-margin': { sym: 'TSLA', metric: 'net_margin_ttm', gap: ['2025-04-24', '2026-01-28'], control: ['2024-02-01', '2025-04-15'] },
  'tsla-roe': { sym: 'TSLA', metric: 'roe_ttm', gap: ['2025-04-24', '2026-01-28'], control: ['2024-02-01', '2025-04-15'] },
  'celh-ni': { sym: 'CELH', metric: 'net_income_ttm', gap: null, control: ['2021-06-02', '2022-05-06'], from: '2021-06-01', to: '2023-06-30' },
  'aapl-rev': { sym: 'AAPL', metric: 'revenue_ttm', gap: null, control: ['2023-01-03', '2026-09-24'] },
  // PERFORMANCE, not correctness: 8 lines at the store's WORST observed run count
  // (29, measured over all 136,505 v4 lines) plus an MA on each, over 17 years.
  stress: { sym: 'STRESS', metric: 'm0', gap: null, control: null, from: '2009-01-02', to: '2026-09-24', stress: 8 },
}

const IDS = ['revenue_ttm', 'revenue_q', 'eps_diluted_ttm', 'net_income_ttm', 'net_margin_ttm', 'roe_ttm', 'gross_margin_ttm']
primeFundamentalsCatalog({ metrics: IDS.map((id) => ({ id, name: id, series: id, compose: null, inputs: [],
  presentation: 'step', cadence: 'quarterly', unit: 'x', fmt: 'num2', category: 'Financials' })) })

const params = new URLSearchParams(window.location.search)
const c = CASES[params.get('case')] || CASES['tsla-eps']
const from = c.from || '2023-06-01'
const to = c.to || '2026-09-24'

const bars = []
for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  const wd = d.getUTCDay()
  if (wd !== 0 && wd !== 6) bars.push({ t: d.toISOString().slice(0, 10), o: 1, h: 1, l: 1, c: 1, v: 1 })
}

const el = document.getElementById('chart')
const chart = LWC.createChart(el, {
  width: 1200, height: 400,
  layout: { background: { type: 'solid', color: '#000000' }, textColor: '#000000', attributionLogo: false },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  crosshair: { mode: LWC.CrosshairMode.Hidden, vertLine: { visible: false }, horzLine: { visible: false } },
  rightPriceScale: { visible: false }, leftPriceScale: { visible: false },
  timeScale: { visible: false },
  handleScroll: false, handleScale: false,
})

function stressBody(lines) {
  // 29 runs: alternate ~60 valued quarters' worth of points with a gap, 58 points per line
  const metrics = {}
  const t0 = Date.parse('2009-02-01T21:00:00Z') / 1000
  for (let m = 0; m < lines; m++) {
    const pts = []
    for (let k = 0; k < 57; k++) { const t = t0 + k * 9500000 + m * 86400; pts.push([t, k % 2 ? null : 1 + m + (k % 5) / 10, new Date((t - 40 * 86400) * 1000).toISOString().slice(0, 10), k % 2 ? 'gap' : 'ytd_roll']) }
    metrics[`m${m}`] = pts
  }
  return { metrics, missing: [] }
}
const body = c.stress ? stressBody(c.stress) : GOLDEN[c.sym]
if (c.stress) primeFundamentalsCatalog({ metrics: Array.from({ length: c.stress }, (_, m) => ({ id: `m${m}`, name: `m${m}`,
  series: `m${m}`, compose: null, inputs: [], presentation: 'step', cadence: 'quarterly', unit: 'x', fmt: 'num2', category: 'X' })) })
const series = Object.fromEntries(Object.entries(body.metrics || {}).map(([k, v]) => [k, _points(v)]))
const instances = [{ instanceId: 'f', defId: 'dataSeries', hidden: false,
  inputs: { source: `fund:${c.metric}`, color: '#00ff00', lineWidth: 2 } }]
if (c.ma) instances.push({ instanceId: 'ma', defId: 'movingAverage', hidden: false,
  inputs: { source: '@f::value', period: 20, maType: 'sma', color: '#ff00ff', lineWidth: 2 } })
if (c.stress) {
  instances.length = 0
  for (let m = 0; m < c.stress; m++) {
    instances.push({ instanceId: `f${m}`, defId: 'dataSeries', hidden: false, inputs: { source: `fund:m${m}` } })
    instances.push({ instanceId: `ma${m}`, defId: 'movingAverage', hidden: false, inputs: { source: `@f${m}::value`, period: 20, maType: 'sma' } })
  }
}

const binder = createBinder({ chart, LWC })
const adjustTime = (t) => t
const syncCtx = { enabled: true, registry, instances, bars, cs: {}, sym: c.sym, tf: 'D', adjustTime,
  fundamentals: new Map([[c.sym, { series, missing: body.missing || [] }]]),
  resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right' }) }
const tA = performance.now()
binder.sync(syncCtx)
const firstSyncMs = performance.now() - tA
const tB = performance.now()
// an unchanged re-sync, as StockChart makes it on the ~1s engine tick: its `_applyData`
// returns early on a noop plan, so an unchanged primary is not re-sent
binder.sync({ ...syncCtx, applyData: () => {} })
const resyncMs = performance.now() - tB
chart.timeScale().fitContent()

const x = (t) => chart.timeScale().timeToCoordinate(t)
const nearestBar = (iso, dir) => {
  const list = dir > 0 ? bars : [...bars].reverse()
  const b = list.find((b) => (dir > 0 ? b.t >= iso : b.t <= iso))
  return b ? b.t : null
}
// CELH: derive its gap windows from the fixture itself (every canonical gap start)
function fixtureGaps() {
  const pts = body.metrics[c.metric] || []
  const out = []
  for (let k = 0; k < pts.length; k++) {
    if (pts[k][3] !== 'gap') continue
    const start = new Date(pts[k][0] * 1000).toISOString().slice(0, 10)
    const next = pts.slice(k + 1).find((p) => p[3] !== 'gap')
    const end = next ? new Date(next[0] * 1000).toISOString().slice(0, 10) : to
    out.push([start, end])
  }
  return out
}

const tPaint = performance.now()
requestAnimationFrame(() => requestAnimationFrame(() => {
  const paintMs = performance.now() - tPaint
  const colOf = (a, b) => {
    const ta = nearestBar(a, +1)
    const tb = nearestBar(b, -1)
    if (!ta || !tb || ta > tb) return null
    return [Math.round(x(ta)), Math.round(x(tb))]
  }
  let gaps = []
  if (c.gap) gaps = [colOf(c.gap[0], c.gap[1])]
  else if (c.sym === 'CELH') {
    // an unknown window is [the bar AFTER the gap's public time, the bar BEFORE the next value's]
    gaps = fixtureGaps()
      .filter(([s]) => s >= from && s <= to)
      .map(([s, e]) => {
        const i0 = bars.findIndex((b) => b.t > s)
        let i1 = bars.findIndex((b) => b.t > e)
        i1 = i1 < 0 ? bars.length - 1 : i1 - 1
        return i0 >= 0 && i1 > i0 ? [Math.round(x(bars[i0 + 1]?.t || bars[i0].t)), Math.round(x(bars[i1 - 1]?.t || bars[i1].t))] : null
      })
  }
  window.__gapHarness = {
    ready: true,
    case: params.get('case'),
    colors: { line: '#00ff00', ma: c.ma ? '#ff00ff' : null },
    gaps: gaps.filter(Boolean),
    control: c.control ? colOf(c.control[0], c.control[1]) : null,
    renderSeries: c.stress ? [{ id: 'all', runs: binder.bindings().reduce((n, b) => n + 1 + (b.runSeries || []).length, 0) }]
      : binder.bindings().map((b) => ({ id: b.instanceId, runs: 1 + (b.runSeries || []).length })),
    perf: { bars: bars.length, firstSyncMs: Math.round(firstSyncMs), resyncMs: Math.round(resyncMs * 10) / 10, paintMs: Math.round(paintMs) },
  }
}))
