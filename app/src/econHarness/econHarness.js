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
import { projectAsOfIndices, referenceTime, closeUtcSeconds } from '../components/chart/engine/fundamentalAsOf'
import { fundamentalFormatOfInputs, formatFundamentalValue } from '../components/chart/engine/fundamentalFormat'
import { legendChips } from '../components/chart/engine/readout'

const FIXTURES = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' })
const fixture = (name) => FIXTURES[`./fixtures/${name}.json`] || null
const params = new URLSearchParams(window.location.search)
const SRC = params.get('src') === 'api' ? 'api' : 'fixtures'
const PLACEMENT = params.get('placement') === 'period' ? 'period' : 'available'
// ?asof=<unix s> -> every series is requested as the point-in-time view at T
// (`/api/econ/series/<SYM>?asof=T`, answered from the vintages artifact).
const ASOF = /^\d+$/.test(params.get('asof') || '') ? Number(params.get('asof')) : null

/**
 * A SYNTHETIC host (seeded random walk, NOT market data) reaching the real
 * store's newest releases. The committed fixture host ends 2026-09-25 (D) /
 * 2026-09-17 (5m), before the 2026-09-29 FHFA + JOLTS releases the real-data
 * alignment checks need. Weekdays only, no holidays; W keyed by Monday; 5m =
 * bar-START unix seconds 04:00-20:00 ET (DST-aware via `closeUtcSeconds`).
 */
function synthHost(through, sessions5) {
  let seed = 20260929
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const addDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const wd = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()
  const D = []
  let px = 470
  for (let d = '2024-01-02'; d <= through; d = addDay(d)) {
    if (wd(d) === 0 || wd(d) === 6) continue
    const o = px; const c = +(o * (1 + (rnd() - 0.48) * 0.02)).toFixed(2)
    D.push({ t: d, o, h: +(Math.max(o, c) * (1 + rnd() * 0.006)).toFixed(2), l: +(Math.min(o, c) * (1 - rnd() * 0.006)).toFixed(2), c, v: 4e7 })
    px = c
  }
  const W = []
  for (const b of D) {
    const dt = new Date(`${b.t}T00:00:00Z`)
    const mon = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
    const w = W[W.length - 1]
    if (w && w.t === mon) { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += b.v } else W.push({ ...b, t: mon })
  }
  const F = []
  for (const iso of sessions5) {
    const start = closeUtcSeconds(iso) - 12 * 3600                           // 04:00 ET
    let p = (D.find((b) => b.t === iso) || D[D.length - 1]).o
    for (let k = 0; k < 192; k++) {
      const o = p; const c = +(o * (1 + (rnd() - 0.5) * 0.002)).toFixed(2)
      F.push({ t: start + k * 300, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 2e5 })
      p = c
    }
  }
  return { _provenance: `host SYNTHETIC (seeded random walk, NOT market data) D 2024-01-02..${through}, 5m sessions ${sessions5.join(',')}`,
    symbol: 'SYNTH_SPY', D, W, 5: F }
}
const HOST = SRC === 'api'
  ? synthHost(params.get('through') || '2026-09-29', ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29'])
  : fixture('host_SYNTH_SPY')

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
  // ── real-data scenarios (?src=api; the fixtures do not carry these series) ──
  nfp: { title: '(g) Primary · monthly histogram · Nonfarm payrolls change (k persons, negatives)', kind: 'primary',
    series: ['USNFPCHG'], apiOnly: true },
  tradebal: { title: '(g2) Primary · monthly histogram · Trade balance (usd_compact, negatives)', kind: 'primary',
    series: ['USTRADEBAL'], apiOnly: true },
  cpiyoy: { title: '(h) Primary · DERIVED line · CPI y/y (yoy_pct of CPI NSA)', kind: 'primary', series: ['USCPIYOY'], apiOnly: true },
  t10y2y: { title: '(h2) Primary · DERIVED line · 10y-2y spread (pp)', kind: 'primary', series: ['UST10Y2Y'], apiOnly: true },
  fhfa: { title: '(i) Primary · FHFA HPI (as-of aware)', kind: 'primary', series: ['USFHFAHPI'], apiOnly: true,
    probeValue: { symbol: 'USFHFAHPI', ps: '2026-06-01' } },
  jolts: { title: '(i2) Primary · JOLTS openings (as-of aware)', kind: 'primary', series: ['USJOLTSO'], apiOnly: true,
    probeValue: { symbol: 'USJOLTSO', ps: '2026-07-01' } },
  'overlay-fhfa-d': { title: '(j) Overlay · daily host (SYNTHETIC) + FHFA HPI + JOLTS + CPI', kind: 'overlay', tf: 'D',
    series: ['USFHFAHPI', 'USJOLTSO', 'USCPI'], apiOnly: true,
    probe: [{ symbol: 'USFHFAHPI', pe: '2026-07-31', expectFirstBar: '2026-09-29' },
      { symbol: 'USJOLTSO', pe: '2026-08-31', expectFirstBar: '2026-09-29' },
      { symbol: 'USCPI', pe: '2026-08-31' }] },
  'overlay-jolts-5': { title: '(k) Overlay · 5-minute host (SYNTHETIC) + JOLTS + FHFA', kind: 'overlay', tf: '5',
    series: ['USJOLTSO', 'USFHFAHPI'], apiOnly: true,
    probe: [{ symbol: 'USJOLTSO', pe: '2026-08-31', expectFirstBarUtc: '2026-09-29T14:00:00Z' },
      { symbol: 'USFHFAHPI', pe: '2026-07-31', expectFirstBarUtc: '2026-09-29T13:00:00Z' }] },
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
document.getElementById('sub').textContent = `src=${SRC} · placement=${PLACEMENT}${ASOF != null ? ` · AS-OF ${new Date(ASOF * 1000).toISOString()}` : ''}${SC.kind === 'overlay' ? ' · host bars SYNTHETIC (not market data)' : ''}`
const nav = document.getElementById('nav')
for (const k of Object.keys(SCENARIOS)) {
  const a = document.createElement('a')
  a.href = `?scenario=${k}&src=${SRC}${PLACEMENT === 'period' ? '&placement=period' : ''}${ASOF != null ? `&asof=${ASOF}` : ''}`
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
    const e = await loadEconomicSeries(sym, ASOF != null ? { asof: ASOF } : {})
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
  const cur = SC.series.map((s) => {
    const e = STATE.entries.get(s)
    const c = e && e.currentnessView
    return c ? `${s}: ${c.state}${c.backendState ? ` (${c.backendState})` : ''} · latest ${c.latestPeriod || '—'} · ${c.nextRelease.text}` : null
  }).filter(Boolean)
  return [...cur, ...prov, ...(SC.kind === 'overlay' ? [HOST._provenance] : []), ...STATE.errors.map((e) => `ERROR ${e}`)].join('  ·  ')
}

// ─── audit ──────────────────────────────────────────────────────────────────
const PROBES = SC.probe ? [].concat(SC.probe) : []
function probeBarTime() {
  const probe = PROBES[0]
  if (!probe) return undefined
  const e = STATE.entries.get(probe.symbol)
  if (!e || !e.points) return undefined
  const bi = binder.bindings().find((b) => b.instanceId === `e${SC.series.indexOf(probe.symbol)}`)
  if (!bi) return undefined
  const col = columnFor(probe.symbol)
  if (!col) return undefined
  const k = col.__econ.indices.findIndex((j) => j >= 0 && col.__econ.points[j].pe === probe.pe)
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
/**
 * Every provider-stated MISSING period (v: null): where it sits, and proof it is a
 * GAP on screen -- no bar that selected it holds a value, and no render series
 * holds a finite point at any such bar.
 */
function nullPeriodAudit(sym, pts, col) {
  const nulls = pts.filter((p) => p.v === null)
  if (!nulls.length || !col || !col.__econ) return []
  const b = binder.bindings().find((x) => x.instanceId === `e${SC.series.indexOf(sym)}`)
  const drawn = new Set()
  if (b) for (const s of [b.series, ...(b.runSeries || [])]) for (const q of s.data()) if (Number.isFinite(q.value)) drawn.add(timeKey(q.time))
  return nulls.map((p) => {
    const j = col.__econ.points.indexOf(p) >= 0 ? col.__econ.points.indexOf(p)
      : col.__econ.points.findIndex((q) => q.ps === p.ps && q.pe === p.pe && q.v === null)
    const rows = []
    for (let i = 0; i < col.__econ.indices.length; i++) if (col.__econ.indices[i] === j) rows.push(i)
    return { period: `${p.ps}..${p.pe}`, placedAt: `${fmtEt(p.t)} ET`, bars: rows.length,
      firstBar: rows.length ? isoOfT(BARS[rows[0]].t) : null, lastBar: rows.length ? isoOfT(BARS[rows[rows.length - 1]].t) : null,
      valuedBars: rows.filter((i) => Number.isFinite(col[i])).length,
      drawnPoints: rows.filter((i) => drawn.has(timeKey(adjustTime(BARS[i].t)))).length }
  })
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
    asof: ASOF, asofIso: ASOF != null ? new Date(ASOF * 1000).toISOString() : null,
    series: {}, bindings: [], alignment: PROBES.length ? [] : null, probeValue: null }

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
      sampleValue: lastFinite, axisText: undefined, legendText: undefined,
      currentness: e && e.currentness ? e.currentness : null, currentnessView: e ? e.currentnessView : null,
      view: e ? e.view : null, nullPeriods: nullPeriodAudit(sym, pts, col) }
  }
  if (SC.probeValue) {
    const { symbol, ps } = SC.probeValue
    const e = STATE.entries.get(symbol)
    const pt = e && e.points.find((q) => q.ps === ps)
    out.probeValue = { symbol, ps, view: e ? e.view : null, asof: ASOF, value: pt ? pt.v : null,
      placedAt: pt ? new Date(pt.t * 1000).toISOString() : null, legendAtRow: null }
    if (pt && STATE.timeline) {
      const k = BARS.findIndex((b) => b.t === etDateOf(pt.t))
      const chip = k >= 0 ? chipsAt(adjustTime(BARS[k].t)).find((c) => c.instanceId === `e${SC.series.indexOf(symbol)}`) : null
      out.probeValue.legendAtRow = chip ? chip.text : null
      out.probeValue.row = k >= 0 ? BARS[k].t : null
    }
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

  for (const probe of PROBES) {
    const { symbol, pe } = probe
    const e = STATE.entries.get(symbol)
    const col = columnFor(symbol)
    const pt = e && e.points.find((p) => p.pe === pe)
    if (!pt || !col) { out.alignment.push({ symbol, periodEnd: pe, error: 'period not loaded' }); continue }
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
    const inst = `e${SC.series.indexOf(symbol)}`
    const chip = k >= 0 ? chipsAt(adjustTime(BARS[k].t)).find((c) => c.instanceId === inst) : null
    const prev = k > 0 ? chipsAt(adjustTime(BARS[k - 1].t)).find((c) => c.instanceId === inst) : null
    const firstBarUtc = k >= 0 && typeof BARS[k].t === 'number' ? new Date(BARS[k].t * 1000).toISOString() : null
    const a = { symbol, period: `${pt.ps}..${pt.pe}`, periodEnd: pt.pe, releasedAt: `${fmtEt(pt.t)} ET`,
      releasedAtUtc: new Date(pt.t * 1000).toISOString(),
      firstBarIndex: k, firstBarTime: k >= 0 ? isoOfT(BARS[k].t) : null, firstBarUtc,
      firstBarAfterPeriodEnd: k >= 0 ? (typeof BARS[k].t === 'number' ? etDateOf(BARS[k].t) : BARS[k].t) > pt.pe : null,
      observationAtFirstBar: k >= 0 ? observationAtIndex(col, k) : null,
      observationAtPreviousBar: k > 0 ? observationAtIndex(col, k - 1) : null,
      legendAtFirstBar: chip ? chip.text : null, legendAtPreviousBar: prev ? prev.text : null,
      barsShowingBeforeRelease: leaks }
    if (probe.expectFirstBar) a.expectFirstBar = probe.expectFirstBar
    if (probe.expectFirstBarUtc) a.expectFirstBarUtc = probe.expectFirstBarUtc
    a.ok = k >= 0 && leaks === 0
      && (!probe.expectFirstBar || BARS[k].t === probe.expectFirstBar)
      && (!probe.expectFirstBarUtc || firstBarUtc === new Date(probe.expectFirstBarUtc).toISOString())
    out.alignment.push(a)
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
