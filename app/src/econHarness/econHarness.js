// Dev-only: see app/econ-harness.html. Economic data Phase 1 — proves the data
// contract through the REAL binder on the REAL renderer, and publishes a
// machine-checkable audit on `window.__econ`.
//
// ⛔ Never requests /api/bars (host bars are a SYNTHETIC fixture), never opens
// /charts, never writes preferences. ?src=api reads /api/econ/* from the LOCAL
// backend via the vite proxy.
import * as LWC from 'lightweight-charts'
import * as registry from '../components/chart/engine/nativeRegistry'
import { createBinder } from '../components/chart/engine/binder'
import {
  setEconomicFetcher, loadEconomicSeries, economicCatalog, subscribeEconomic, SOURCE_STATUS,
} from '../components/chart/engine/economicSeries'
import {
  economicTimelineOf, etDateOf, maxAgeDaysOf, frequencyOf, observationAtIndex,
} from '../components/chart/engine/economicSource'
import { projectAsOfIndices, referenceTime } from '../components/chart/engine/fundamentalAsOf'
import { fundamentalFormatOfInputs, formatFundamentalValue } from '../components/chart/engine/fundamentalFormat'
import { legendChips } from '../components/chart/engine/readout'

const FIXTURES = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' })
const fixture = (name) => FIXTURES[`./fixtures/${name}.json`] || null
const HOST = fixture('host_SYNTH_SPY')

const params = new URLSearchParams(window.location.search)
const SRC = params.get('src') === 'api' ? 'api' : 'fixtures'
const PLACEMENT = params.get('placement') === 'period' ? 'period' : 'available'

// ─── scenarios ──────────────────────────────────────────────────────────────
const SCENARIOS = {
  cpi: { title: '(a) Primary · monthly line · CPI', kind: 'primary', series: ['USCPI'] },
  fedfunds: { title: '(b) Primary · step · Fed funds target range (upper + lower) + EFFR', kind: 'primary',
    series: ['USFEDFUNDSU', 'USFEDFUNDSL', 'USEFFR'], grid: 'B',
    colors: { USFEDFUNDSU: '#f5a524', USFEDFUNDSL: '#f5a524', USEFFR: '#4f9cf9' } },
  crude: { title: '(c) Primary · weekly · U.S. crude stocks ex SPR (1982-2026)', kind: 'primary', series: ['USCRUDEINV'] },
  claims: { title: '(c2) Primary · weekly · Initial claims', kind: 'primary', series: ['USICSA'] },
  gdp: { title: '(d) Primary · quarterly histogram · Real GDP q/q ann.', kind: 'primary', series: ['USRGDPQA'] },
  'overlay-d': { title: '(e) Overlay · daily host (SYNTHETIC) + CPI pane + NFP change pane', kind: 'overlay', tf: 'D',
    series: ['USCPI', 'USNFPCHG'], probe: { symbol: 'USCPI', pe: '2026-08-31' } },
  'overlay-w': { title: '(f) Overlay · weekly host (SYNTHETIC) + CPI + NFP change', kind: 'overlay', tf: 'W',
    series: ['USCPI', 'USNFPCHG'], probe: { symbol: 'USCPI', pe: '2026-08-31' } },
  'overlay-5': { title: '(f) Overlay · 5-minute host (SYNTHETIC, 04:00-20:00 ET) + CPI', kind: 'overlay', tf: '5',
    series: ['USCPI', 'USEFFR'], probe: { symbol: 'USCPI', pe: '2026-08-31' } },
}
const NAME = SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'cpi'
const SC = SCENARIOS[NAME]

// ─── data source ────────────────────────────────────────────────────────────
if (SRC === 'fixtures') {
  setEconomicFetcher(async (url) => {
    if (url === '/api/econ/catalog') return fixture('catalog')
    const m = /^\/api\/econ\/series\/([^?]+)/.exec(url)
    const body = m ? fixture(decodeURIComponent(m[1])) : null
    if (!body) throw Object.assign(new Error('HTTP 404'), { httpStatus: 404 })
    return body
  })
}

// ─── display time (ET) — the chart's own convention for intraday ────────────
const _off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
function etShift(sec) {
  const utcH = new Date(sec * 1000).getUTCHours()
  const etH = Number(_off.format(new Date(sec * 1000)))
  const diff = ((utcH - etH) + 24) % 24                     // 4 (EDT) or 5 (EST)
  return sec - diff * 3600
}
const adjustTime = (t) => (typeof t === 'number' ? etShift(t) : t)
const fmtEt = (sec) => new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
const timeKey = (t) => (typeof t === 'number' ? t : String(t))

// ─── chart ──────────────────────────────────────────────────────────────────
const el = document.getElementById('chart')
const chart = LWC.createChart(el, {
  width: 1280, height: 620,
  layout: { background: { type: 'solid', color: '#0e1014' }, textColor: '#aab1bd', attributionLogo: false,
    panes: { separatorColor: '#262a33' } },
  grid: { vertLines: { color: '#161920' }, horzLines: { color: '#161920' } },
  rightPriceScale: { borderColor: '#262a33' },
  timeScale: { borderColor: '#262a33', timeVisible: SC.tf === '5', secondsVisible: false, rightOffset: 4 },
  crosshair: { mode: LWC.CrosshairMode.Normal },
})
const binder = createBinder({ chart, LWC })

document.getElementById('title').textContent = SC.title
document.getElementById('sub').textContent = `src=${SRC} · placement=${PLACEMENT}${SC.kind === 'overlay' ? ' · host bars SYNTHETIC (not market data)' : ''}`
const nav = document.getElementById('nav')
for (const k of Object.keys(SCENARIOS)) {
  const a = document.createElement('a')
  a.href = `?scenario=${k}&src=${SRC}${PLACEMENT === 'period' ? '&placement=period' : ''}`
  a.textContent = k
  if (k === NAME) a.className = 'on'
  nav.appendChild(a)
}
for (const [label, fn] of [['Origin', () => origin()], ['Fit all', () => chart.timeScale().fitContent()],
  ['Zoom +', () => zoom(0.5)], ['Zoom −', () => zoom(2)], ['◀ Pan', () => pan(-20)], ['Pan ▶', () => pan(20)]]) {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = fn
  nav.appendChild(b)
}

// ─── navigation (the chart's own controls, same maths as StockChart) ────────
/** StockChart `centerFirstBar`: frame the FIRST bar in the centre at the current zoom width. */
function origin() {
  const ts = chart.timeScale()
  const cur = ts.getVisibleLogicalRange()
  const W = (cur && cur.to > cur.from) ? (cur.to - cur.from) : 200
  ts.setVisibleLogicalRange({ from: -W / 2, to: W / 2 })
}
function zoom(f) {
  const ts = chart.timeScale()
  const r = ts.getVisibleLogicalRange()
  const c = (r.from + r.to) / 2
  const h = ((r.to - r.from) * f) / 2
  ts.setVisibleLogicalRange({ from: c - h, to: c + h })
}
function pan(n) {
  const ts = chart.timeScale()
  const r = ts.getVisibleLogicalRange()
  ts.setVisibleLogicalRange({ from: r.from + n, to: r.to + n })
}

// ─── legend ─────────────────────────────────────────────────────────────────
let INSTANCES = []
let BARS = []
let HOST_SERIES = null
const legendEl = document.getElementById('legend')

/** seriesData the way LWC hands it to a crosshair handler, for any bar time. */
function seriesDataAt(time) {
  const m = new Map()
  const all = [...(HOST_SERIES ? [HOST_SERIES] : []), ...binder.bindings().map((b) => b.series)]
  for (const s of all) {
    const p = s.data().find((q) => q.time === time)
    if (p) m.set(s, p)
  }
  if (!m.size) m.set({}, { time })
  return m
}
function chipsAt(time) {
  return legendChips(binder.bindings(), seriesDataAt(time), registry, INSTANCES)
}
function renderLegend(time) {
  const chips = time === undefined ? [] : chipsAt(time)
  const hostRow = HOST_SERIES && time !== undefined ? HOST_SERIES.data().find((q) => q.time === time) : null
  const head = typeof time === 'number' ? fmtEt(time - (adjustTime(time) - time)) + ' ET' : (time || '')
  legendEl.innerHTML = [
    `<div style="color:#8a919e">${head}${hostRow ? ` · SYNTH_SPY C ${hostRow.close.toFixed(2)}` : ''}</div>`,
    ...chips.map((c) => `<div style="color:${c.color}">${c.text}${c.value == null ? ' <span style="color:#8a919e">— (gap)</span>' : ''}</div>`),
  ].join('')
}
chart.subscribeCrosshairMove((p) => { if (p && p.time !== undefined) renderLegend(p.time) })

// ─── build ──────────────────────────────────────────────────────────────────
const STATE = { entries: new Map(), timeline: null, errors: [] }

async function build() {
  economicCatalog()
  for (const sym of SC.series) {
    const e = await loadEconomicSeries(sym)
    STATE.entries.set(sym, e)
    if (!e || e.status !== SOURCE_STATUS.AVAILABLE) STATE.errors.push(`${sym}: ${e ? e.status : 'unreadable'}`)
  }
  const economics = new Map([...STATE.entries].filter(([, e]) => e && e.status === SOURCE_STATUS.AVAILABLE))

  INSTANCES = SC.series.map((sym, i) => ({
    instanceId: `e${i}`, defId: 'dataSeries', hidden: false,
    inputs: { source: `econ:${sym}`, ...(SC.colors && SC.colors[sym] ? { color: SC.colors[sym] } : {}),
      ...(SC.kind === 'primary' ? { lineWidth: 2 } : {}) },
  }))

  let tf
  let resolvePlacement
  if (SC.kind === 'primary') {
    // ⭐ THE SERIES-NATIVE TIMELINE: no ticker, no candles; rows are the series' own dates.
    STATE.timeline = economicTimelineOf(
      SC.series.filter((s) => economics.has(s)).map((s) => ({ symbol: s, points: economics.get(s).points, meta: economics.get(s).meta })),
      { placement: PLACEMENT, grid: SC.grid || null })
    BARS = STATE.timeline.bars
    tf = 'D'
    resolvePlacement = () => ({ paneIndex: 0, scaleId: 'right' })
  } else {
    BARS = HOST[SC.tf]
    tf = SC.tf
    HOST_SERIES = chart.addSeries(LWC.CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350', title: 'SYNTH_SPY' }, 0)
    HOST_SERIES.setData(BARS.map((b) => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })))
    resolvePlacement = (inst) => ({ paneIndex: 1 + INSTANCES.indexOf(inst), scaleId: 'right' })
  }

  if (!BARS.length) {
    STATE.errors.push('nothing to draw: no series loaded')
    document.getElementById('foot').textContent = footText()
    return
  }
  binder.sync({ enabled: true, registry, instances: INSTANCES, bars: BARS, cs: { indicatorInstances: INSTANCES },
    sym: SC.kind === 'primary' ? null : 'SYNTH_SPY', tf, economics, adjustTime, econPlacement: PLACEMENT,
    resolvePlacement })

  const panes = chart.panes()
  if (SC.kind === 'overlay' && panes.length > 1) {
    panes[0].setStretchFactor(2)
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)
  }
  chart.timeScale().fitContent()
  const probeTime = probeBarTime()
  renderLegend(probeTime !== undefined ? probeTime : adjustTime(BARS[BARS.length - 1].t))
  document.getElementById('foot').textContent = footText()
}

function footText() {
  const prov = SC.series.map((s) => {
    const f = fixture(s)
    return f && f._provenance && SRC === 'fixtures' ? `${s}: ${f._provenance.values} | t: ${f._provenance.available_at}` : null
  }).filter(Boolean)
  return [...prov, ...(SC.kind === 'overlay' ? [HOST._provenance] : []), ...STATE.errors.map((e) => `ERROR ${e}`)].join('  ·  ')
}

// ─── audit ──────────────────────────────────────────────────────────────────
function probeBarTime() {
  if (!SC.probe) return undefined
  const e = STATE.entries.get(SC.probe.symbol)
  if (!e || !e.points) return undefined
  const bi = binder.bindings().find((b) => b.instanceId === `e${SC.series.indexOf(SC.probe.symbol)}`)
  if (!bi) return undefined
  const col = columnFor(SC.probe.symbol)
  if (!col) return undefined
  const k = col.__econ.indices.findIndex((j) => j >= 0 && col.__econ.points[j].pe === SC.probe.pe)
  return k >= 0 ? adjustTime(BARS[k].t) : undefined
}

/** The projection the binder drew, recomputed through the SAME public functions. */
function columnFor(sym) {
  const e = STATE.entries.get(sym)
  if (!e || !e.points) return null
  if (STATE.timeline) return STATE.timeline.columns.get(sym) || null
  const idx = projectAsOfIndices(e.points, BARS, SC.tf, { maxPeriodAgeDays: maxAgeDaysOf(e.meta), strict: true })
  const col = Array.from(idx, (j) => (j >= 0 && Number.isFinite(e.points[j].v) ? e.points[j].v : NaN))
  Object.defineProperty(col, '__econ', { value: { indices: idx, points: e.points, frequency: frequencyOf(e.meta) } })
  return col
}

/** Render series of one binding whose VALUED rows are not one contiguous block. */
function bridgedGaps(binding) {
  const index = new Map(BARS.map((b, i) => [timeKey(adjustTime(b.t)), i]))
  let bad = 0
  for (const s of [binding.series, ...(binding.runSeries || [])]) {
    if (binding.poolKey === 'histogram') continue                      // per-point bars cannot bridge
    const idx = s.data().filter((p) => Number.isFinite(p.value)).map((p) => index.get(timeKey(p.time)))
    for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) bad += 1
  }
  return bad
}
/** Interior gaps in the logical column (NaN stretches between valued bars). */
function interiorGaps(col) {
  let gaps = 0; let seen = false; let inGap = false
  for (const v of col) {
    if (Number.isFinite(v)) { if (seen && inGap) gaps += 1; seen = true; inGap = false } else if (seen) inGap = true
  }
  return gaps
}
const isoOfT = (t) => (typeof t === 'number' ? `${fmtEt(t)} ET` : t)

function audit() {
  if (!BARS.length) return { scenario: NAME, src: SRC, errors: [...STATE.errors], series: Object.fromEntries(
    SC.series.map((s) => [s, { status: STATE.entries.get(s) ? STATE.entries.get(s).status : null }])), bindings: [], drawnThroughGapsTotal: 0 }
  const out = { scenario: NAME, title: SC.title, src: SRC, placement: PLACEMENT, kind: SC.kind, errors: [...STATE.errors],
    host: SC.kind === 'overlay' ? { symbol: 'SYNTH_SPY', synthetic: true, tf: SC.tf, bars: BARS.length,
      first: isoOfT(BARS[0].t), last: isoOfT(BARS[BARS.length - 1].t) } : null,
    primary: STATE.timeline ? { rows: BARS.length, firstRow: BARS[0].t, lastRow: BARS[BARS.length - 1].t,
      collapsed: STATE.timeline.collapsed, grid: SC.grid || null,
      ohlcFieldsOnRows: BARS.some((b) => 'o' in b || 'c' in b), candleSeries: 0 } : null,
    series: {}, bindings: [], alignment: null }

  for (const sym of SC.series) {
    const e = STATE.entries.get(sym)
    const pts = (e && e.points) || []
    const col = columnFor(sym)
    const key = fundamentalFormatOfInputs({ source: `econ:${sym}` })
    const lastFinite = col ? [...col].reverse().find(Number.isFinite) : undefined
    out.series[sym] = { status: e ? e.status : null, points: pts.length, nullPoints: pts.filter((p) => p.v === null).length,
      firstAvailable: pts.length ? `${fmtEt(pts[0].t)} ET` : null, lastAvailable: pts.length ? `${fmtEt(pts[pts.length - 1].t)} ET` : null,
      firstPeriod: pts.length ? pts[0].ps : null, lastPeriod: pts.length ? pts[pts.length - 1].pe : null,
      frequency: e && e.meta ? e.meta.frequency : null, maxAgeDays: e ? maxAgeDaysOf(e.meta) : null,
      formatKey: key, valuedBars: col ? col.filter(Number.isFinite).length : 0, interiorGaps: col ? interiorGaps(col) : null,
      sampleValue: lastFinite, axisText: undefined, legendText: undefined }
  }
  for (const b of binder.bindings()) {
    const sym = b.instanceId && SC.series[Number(b.instanceId.slice(1))]
    const lastT = [...b.series.data()].reverse().find((p) => Number.isFinite(p.value))
    const chip = lastT ? chipsAt(lastT.time).find((c) => c.instanceId === b.instanceId) : null
    const pf = b.series.options().priceFormat
    if (sym && out.series[sym]) {
      out.series[sym].axisText = pf && pf.formatter ? pf.formatter(out.series[sym].sampleValue) : String(out.series[sym].sampleValue)
      out.series[sym].legendText = chip ? chip.text : null
      out.series[sym].legendMatchesAxis = !!chip && chip.text.includes(out.series[sym].axisText)
    }
    out.bindings.push({ instanceId: b.instanceId, symbol: sym, poolKey: b.poolKey, paneIndex: b.paneIndex,
      lineType: b.series.options().lineType ?? null, renderSeries: 1 + (b.runSeries || []).length,
      drawnThroughGaps: bridgedGaps(b) })
  }
  out.drawnThroughGapsTotal = out.bindings.reduce((n, b) => n + b.drawnThroughGaps, 0)

  if (SC.probe) {
    const { symbol, pe } = SC.probe
    const e = STATE.entries.get(symbol)
    const col = columnFor(symbol)
    const pt = e && e.points.find((p) => p.pe === pe)
    if (pt && col) {
      const k = col.__econ.indices.findIndex((j) => j >= 0 && col.__econ.points[j].pe === pe)
      // leak check over EVERY bar: a bar may show period P only if its reference
      // time is at/after P's release (strictly after for an intraday bar's end)
      let leaks = 0
      for (let i = 0; i < BARS.length; i++) {
        const j = col.__econ.indices[i]
        if (j < 0) continue
        const rel = col.__econ.points[j].t
        const ref = referenceTime(BARS[i].t, SC.tf)
        if (SC.tf === 'D' || SC.tf === 'W' ? ref < rel : ref <= rel) leaks += 1
      }
      const chip = k >= 0 ? chipsAt(adjustTime(BARS[k].t)).find((c) => c.instanceId === `e${SC.series.indexOf(symbol)}`) : null
      const prev = k > 0 ? chipsAt(adjustTime(BARS[k - 1].t)).find((c) => c.instanceId === `e${SC.series.indexOf(symbol)}`) : null
      out.alignment = { symbol, period: `${pt.ps}..${pt.pe}`, periodEnd: pt.pe, releasedAt: `${fmtEt(pt.t)} ET`,
        firstBarIndex: k, firstBarTime: k >= 0 ? isoOfT(BARS[k].t) : null,
        firstBarAfterPeriodEnd: k >= 0 ? (typeof BARS[k].t === 'number' ? etDateOf(BARS[k].t) : BARS[k].t) > pt.pe : null,
        observationAtFirstBar: k >= 0 ? observationAtIndex(col, k) : null,
        observationAtPreviousBar: k > 0 ? observationAtIndex(col, k - 1) : null,
        legendAtFirstBar: chip ? chip.text : null, legendAtPreviousBar: prev ? prev.text : null,
        barsShowingBeforeRelease: leaks }
    }
  }
  return out
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

/** Pan / zoom / Origin through the chart's time scale, read back after each paint. */
async function navTest() {
  if (!BARS.length) return { bars: 0, ok: null }
  const ts = chart.timeScale()
  const r = () => { const x = ts.getVisibleLogicalRange(); return x ? { from: +x.from.toFixed(2), to: +x.to.toFixed(2) } : null }
  const vis = () => { const x = ts.getVisibleRange(); return x ? { from: x.from, to: x.to } : null }
  ts.fitContent(); await frame()
  const fit = r(); const fitTime = vis()
  zoom(0.25); await frame()
  const zoomed = r()
  const step = -Math.max(1, Math.round((zoomed.to - zoomed.from) / 4))   // stays inside LWC's scroll limit
  pan(step); await frame()
  const panned = r(); const pannedTime = vis()
  origin(); await frame()
  const org = r(); const orgTime = vis()
  ts.fitContent(); await frame()
  const W = (x) => +(x.to - x.from).toFixed(2)
  return {
    bars: BARS.length, fit, fitTime,
    zoomIn: { range: zoomed, widthRatio: +(W(zoomed) / W(fit)).toFixed(3) },
    pan: { range: panned, requested: step, shift: +(panned.from - zoomed.from).toFixed(2), visibleTime: pannedTime },
    origin: { range: org, firstBarCentred: Math.abs((org.from + org.to) / 2) < 0.51, visibleTime: orgTime,
      firstBarTime: BARS[0].t },
    ok: Math.abs(W(zoomed) / W(fit) - 0.25) < 0.02 && Math.abs(panned.from - zoomed.from - step) < 0.05
      && Math.abs((org.from + org.to) / 2) < 0.51,
  }
}

window.__econ = { ready: false, scenario: NAME, audit, navTest, origin, zoom, pan, chart, binder, renderLegend }
subscribeEconomic(() => {})
build().then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__econ.ready = true }))
}).catch((e) => { STATE.errors.push(String(e && e.stack || e)); window.__econ.ready = true; window.__econ.fatal = String(e) })
// For consumers that only need the formatter (tests / console).
window.__econ.format = formatFundamentalValue
