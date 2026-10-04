// app/src/components/chart/engine/__tests__/vendorHarness/ourSide.js
//
// ─── OUR SIDE: the member door, run on the VENDOR'S bars ──────────────────────
//
// ⛔⛔ THIS IS NOT AN EVALUATOR. It calls, in order, exactly what a member's
// paste reaches:
//
//   memberPaneDefinition({source, id})   — MemberPane.jsx's own call
//   installUserDefinitions([definition]) — the install door (it re-validates and
//                                          can refuse what the builder accepted)
//   computeFor(def, bars, inputs, ctx)   — what `binder.sync` calls per instance
//   createBinder(...).sync(...)          — the real binder over the repo's own
//                                          recording chart double, so a colour
//                                          is read off the POINTS the renderer
//                                          was handed, not re-derived here
//   objectReaderFor → evaluateObjects → toRenderState
//                                        — the object lane, counting what the
//                                          render state KEEPS
//
// A harness that evaluated differently from the product would measure itself.
// Nothing here computes a value; it only moves the vendor's bars into the shape
// the product's bars have and reads back what the product produced.
//
// ⚠️ It lives under `__tests__/` on purpose: it is test infrastructure (the
// reachability rail's TEST_INFRA rule), invoked by the harness tests and the
// vitest CLI entry, and must never be imported by a member surface.

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { createBinder, drawShiftOf, paintColoursFor } from '../../binder'
import { bindingKey } from '../../pool'
import { addInstance } from '../../instanceControls'
import { mergeChartSettings } from '../../../chartDefaults'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
// ⭐ RT5 — a runtime document's own drawings.
import { runtimeObjectsOf, runtimeObjectsWithheldOf, drawsRuntimeObjects } from '../../runtime/runtimeObjects'
import { maxLookback } from '../../ast/interpret'
// ⭐ H8 — what the member's CHART hides, the pane's own predicate (never `hidden`,
// which is the screener's "not a column" and includes constants TradingView draws).
import { hiddenOnChart } from '../../ast/pine'
import { paneObjectsGate } from '../../ast/paneGate'
import { otherSymbolRequestsOf, storeTickerOf } from '../../otherSymbols'
import { lowerTfCodesOf, LOWER_TF_SOURCE } from '../../lowerTf'
import SYMBOL_SCOPE from '../../ast/symbolScope.json'
import { createFakeChart } from '../fakeChart'
import { normalizeColor } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import fs from 'node:fs'
import path from 'node:path'

// ─── ⭐⭐ C26 — ANOTHER SYMBOL'S BARS, FROM COMMITTED CAPTURES ONLY ─────────────
//
// A script that reads another symbol needs that symbol's bars on OUR side, and
// the only honest source is a capture TradingView gave us: the vendor's own bars,
// receipt-verified, of that listing at the chart's timeframe. The chart supplies
// the same thing from `/api/bars` (`useSecondarySources`); the harness supplies it
// from `tests/fixtures/vendor/harness/`. ⛔ Nothing is synthesised: a symbol with
// no committed capture is supplied NOTHING, and the note names the capture that
// is missing.

const OTHER_CAPTURE_DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
let otherIndex = null
// ⭐⭐ C41 — THE CHART SYMBOL'S OWN INTRADAY BARS, FROM COMMITTED CAPTURES ONLY: the
// supply an `ltf` read (`request.security(syminfo.tickerid, "60", …)` on a daily
// chart) needs. `TICKER|minutes` → the union of every capture of that listing at
// that intraday timeframe, REGULAR session (`symbol.session` `0930-1600`) kept
// apart from every other: a 60-minute bar of an extended-hours chart opens on the
// clock hour, off the 09:30 grid, and mixing the two would mark its days
// incomplete. Filled in the same pass as `otherIndex`.
let intradayIndex = null
const REGULAR_SESSION = '0930-1600'

/** `TICKER|tf` → `{bars, exchange, file, last}` over the committed native
 *  captures (receipt-verified). Where two captures hold one listing at one
 *  timeframe, the one reaching the later bar wins (then the deeper one). */
function otherCaptureIndex() {
  if (otherIndex) return otherIndex
  otherIndex = new Map()
  intradayIndex = new Map()
  if (!fs.existsSync(OTHER_CAPTURE_DIR)) return otherIndex
  for (const name of fs.readdirSync(OTHER_CAPTURE_DIR).sort()) {
    if (!name.endsWith('.json')) continue
    let cap
    try { cap = JSON.parse(fs.readFileSync(path.join(OTHER_CAPTURE_DIR, name), 'utf8')) } catch { continue }
    if (!cap || cap.schema !== 'uct.vendor-capture/v1' || !cap.bars || !Array.isArray(cap.bars.rows)) continue
    if (!validateCapture(cap).ok) continue
    const { ticker, exchange } = symbolOf(cap)
    if (!ticker) continue
    const key = `${String(ticker).toUpperCase()}|${tfCodeOf(cap.timeframe)}`
    const bars = toProductBars(cap)
    const last = bars.length ? String(bars[bars.length - 1].t) : ''
    if (/^[0-9]+$/.test(tfCodeOf(cap.timeframe))) {
      const session = cap.symbol && cap.symbol.session === REGULAR_SESSION ? 'regular' : 'other'
      if (!intradayIndex.has(key)) intradayIndex.set(key, { regular: null, other: null })
      const slot = intradayIndex.get(key)
      if (!slot[session]) slot[session] = { byT: new Map(), files: [] }
      // a bar two captures share keeps the one from the capture reaching later
      for (const b of bars) {
        const had = slot[session].byT.get(b.t)
        if (!had || had.last < last) slot[session].byT.set(b.t, { b, last })
      }
      slot[session].files.push(name)
    }
    // ⭐ C29 — the UNION of every capture of one listing at one timeframe, keyed by
    // the bar's own date: each is TradingView's own bars of the same series, so a
    // short recent capture (the 2026-09-30 SPY probes, 300 bars) EXTENDS a deeper
    // older one instead of replacing it (which left C26's 632 RDDT dates short —
    // red at base `bcac5dd34`). A date two captures share keeps the capture
    // reaching the later bar (its newest bar may have closed since).
    const held = otherIndex.get(key)
    if (!held) {
      otherIndex.set(key, { byT: new Map(bars.map((b) => [String(b.t), { b, last }])),
        exchange: storeExchangeOfCapture(cap, exchange), files: [name], last })
      continue
    }
    for (const b of bars) {
      const k = String(b.t)
      const had = held.byT.get(k)
      if (!had || had.last < last) held.byT.set(k, { b, last })
    }
    held.files.push(name)
    if (last > held.last) held.last = last
  }
  for (const entry of otherIndex.values()) {
    entry.bars = [...entry.byT.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v.b)
    entry.file = entry.files.join(', ')
  }
  return otherIndex
}

/** OUR STORE's exchange spelling for a captured listing — the key
 *  `symbolScope.json::confirmed` is written in. A capture carries TradingView's
 *  spelling (`AMEX` for SPY), and the store's (`NYSE Arca`) is linked to it only
 *  by a confirmed row's WITNESS: the row whose witness IS this listing answers.
 *  Failing that, a store key that is its own Pine spelling (`NYSE`, `NASDAQ`,
 *  `OTC`) is the same string in both worlds. `AMEX` without a witness is
 *  ambiguous (`NYSE Arca` and `NYSE American` both answer it): null. */
function storeExchangeOfCapture(cap, tvExchange) {
  const pro = String((cap.symbol && (cap.symbol.pro_name || cap.symbol.full_name)) || '').toUpperCase()
  const confirmed = (SYMBOL_SCOPE && SYMBOL_SCOPE.confirmed) || {}
  for (const [store, row] of Object.entries(confirmed)) {
    if (store.startsWith('_') || !row || typeof row !== 'object') continue
    if (String(row.witness || '').toUpperCase() === pro) return store
  }
  const tv = typeof tvExchange === 'string' ? tvExchange : ''
  const own = confirmed[tv]
  return own && typeof own === 'object' && own.pine === tv ? tv : null
}

/** ⭐⭐ C41 — the lower-timeframe supply a capture's script asks for
 *  (`ctx.lowerTf`), and the notes naming what was and was not supplied. Per code:
 *  the committed captures of the CHART'S OWN listing at the store timeframe that
 *  code is built from (`LOWER_TF_SOURCE`), else at the deepest other timeframe
 *  the code's buckets can be built from. ⛔ Nothing is synthesised: a code with no
 *  such capture is supplied nothing, its reads are UNKNOWN, and the note names
 *  the capture that is missing. */
function lowerTfSupply(def, capture) {
  const codes = lowerTfCodesOf(def)
  if (!codes.length) return { lowerTf: null, notes: [] }
  otherCaptureIndex()
  const { ticker } = symbolOf(capture)
  const held = new Map() // minutes → {bars, files}
  for (const [key, slot] of intradayIndex) {
    const [t, tf] = key.split('|')
    if (t !== String(ticker).toUpperCase()) continue
    const pick = slot.regular || slot.other
    if (!pick.bars) {
      pick.bars = [...pick.byT.entries()].sort(([a], [b]) => a - b).map(([, v]) => v.b)
    }
    held.set(tf, pick)
  }
  const lowerTf = new Map()
  const notes = []
  for (const code of codes) {
    const want = LOWER_TF_SOURCE[code]
    const fits = [...held.keys()].filter((tf) => Number(code) % Number(tf) === 0)
    // ⭐ C49 (wave-11 merge) — THE SUPPLY REACHING FURTHEST BACK, the store's own
    // source timeframe winning a tie. This read `fits.includes(want) ? want : <the
    // longest other>`. Capture round 3 (2026-10-01) then committed a 15-minute
    // capture of SPY — 3,300 bars, 127 sessions — and `want` for 60 / 240 is 15, so
    // the eleven-year 60-minute capture C41's rows are graded on was displaced by
    // it: 2,950 graded sessions → 125. A shallower capture must not shadow a deeper
    // one; where the store's source timeframe reaches as far back as any other (RDDT:
    // 15-minute bars from the listing) it is still the one used, as the product builds it.
    // compared by the first bar's DAY: two captures that both start on the listing
    // day tie, whatever minute their first bucket opens
    const firstT = (tf) => { const b = held.get(tf).bars; return b.length ? Math.floor(Number(b[0].t) / 86400) : Infinity }
    const tf = fits.slice().sort((a, b) => (firstT(a) - firstT(b)) || ((b === want) - (a === want))
      || (held.get(b).bars.length - held.get(a).bars.length))[0]
    if (!tf) {
      notes.push(`lower timeframe ${code}: no committed capture of ${ticker} at ${want} minutes `
        + '(regular session) — the vendor bars this read would need')
      continue
    }
    lowerTf.set(`code:${code}`, { bars: held.get(tf).bars, status: 'available', sourceCode: tf })
    notes.push(`lower timeframe ${code}: built from the committed ${tf}-minute capture(s) ${held.get(tf).files.join(', ')}`)
  }
  return { lowerTf, notes }
}

/** The secondary supply a capture's script asks for, and the notes naming what
 *  could not be supplied. */
function otherSymbolSupply(def, capture) {
  const requests = otherSymbolRequestsOf(def)
  if (!requests.length) return { secondary: null, exchangeOf: null, notes: [] }
  const tf = tfCodeOf(capture.timeframe)
  const index = otherCaptureIndex()
  const secondary = new Map()
  const notes = []
  for (const { ticker } of requests) {
    const hit = index.get(`${ticker}|${tf}`)
    if (hit) {
      // ⭐ C29 — keyed as the product keys it: our store's ticker (`BRK-B`).
      secondary.set(storeTickerOf(ticker), { bars: hit.bars, status: 'available', exchange: hit.exchange })
      for (const f of hit.files) notes.push(`other symbol ${ticker}: bars from the committed capture ${f}`)
    } else {
      secondary.set(storeTickerOf(ticker), { bars: [], status: 'no_data' })
      notes.push(`other symbol ${ticker}: no committed capture of ${ticker} at ${capture.timeframe} — `
        + 'the vendor bars (and listing) this read would need')
    }
  }
  const exchangeOf = (t) => {
    const e = secondary.get(t)
    return e && e.exchange ? e.exchange : null
  }
  return { secondary, exchangeOf, notes }
}

/** The id every harness run installs under. Satisfies `defSchema.ID_RE` (it is
 *  the member pane's own prefix) and is uninstalled after every run. */
export const HARNESS_DEF_ID = 'u_member-pane-vendorharness'

/** TradingView interval string → the chart's own timeframe code. An interval
 *  the chart has no code for is passed through unchanged, which folds nothing
 *  (`timeframeFlags` returns null for an unknown code rather than guessing). */
export function tfCodeOf(interval) {
  const s = String(interval || '').trim()
  if (/^\d+$/.test(s)) return s
  if (/^1?D$/i.test(s)) return 'D'
  if (/^1?W$/i.test(s)) return 'W'
  if (/^1?M$/.test(s)) return 'M'
  return s
}

const isDailyLike = (interval) => /^\d*[DWM]$/.test(String(interval || '').trim())

/** The ISO date a unix time falls on, in the exchange's timezone. */
export function isoDateIn(unixSeconds, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Etc/UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return f.format(new Date(unixSeconds * 1000))
}

/**
 * The vendor's bars in the SHAPE the product's bars have: `/api/bars` returns an
 * ISO date for a daily/weekly/monthly bar and unix seconds for an intraday one
 * (`tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json` is that payload).
 * The NUMBERS are the vendor's, untouched. A missing volume becomes 0 and the
 * verdict carries the adapter's note saying so.
 */
export function toProductBars(capture) {
  const tz = capture.symbol && capture.symbol.timezone
  const daily = isDailyLike(capture.timeframe)
  const iso = capture.bars.timeUnit === 'iso-date'
  const code = tfCodeOf(capture.timeframe)
  return capture.bars.rows.map(([t, o, h, l, c, v]) => ({
    t: iso ? t : (daily ? productPeriodKey(isoDateIn(t, tz), code) : t),
    o, h, l, c, v: v === null || v === undefined ? 0 : v,
  }))
}

/** ⭐ THE DAY THE PRODUCT KEYS A W / M BAR BY (2026-09-28), not the day the
 *  vendor stamps it: `/api/bars` dates a weekly bar by the FRIDAY of its ISO week
 *  (`bars_fetch._resample_weekly_iso`, holiday Fridays included — the startup
 *  fingerprint's `weekly_dating=friday-close`) and a monthly bar by the 1st of
 *  its month (`_resample_monthly_iso`). Until this rule the harness keyed both by
 *  the vendor's own first-session date, a shape the product never serves. The
 *  clock maps any day of the ISO week / month to the same opening instant
 *  (`barOpenInstant`), so the grade is unchanged by construction; what changed
 *  is that the harness now feeds the engine what a member's chart does. */
export function productPeriodKey(isoDate, code) {
  if (code !== 'W' && code !== 'M') return isoDate
  const [y, m, d] = isoDate.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  if (code === 'M') return `${isoDate.slice(0, 8)}01`
  at.setUTCDate(at.getUTCDate() + (4 - ((at.getUTCDay() + 6) % 7)))
  return at.toISOString().slice(0, 10)
}

/** `{ticker, exchange}` for the bind-time fold, from the capture's symbol. */
function symbolOf(capture) {
  const s = capture.symbol || {}
  const pro = String(s.pro_name || s.full_name || s.name || '')
  const ticker = pro.includes(':') ? pro.split(':').pop() : (s.name || pro)
  const tv = s.exchange || (pro.includes(':') ? pro.split(':')[0] : null)
  // ⭐ C29 — the product hands the fold OUR STORE's exchange spelling (`NYSE
  // Arca` for SPY), never TradingView's (`AMEX`). A capture carries the vendor's,
  // so it is linked to the store's by the same witness rule the other-symbol
  // supply uses; where no witness links it, the vendor's spelling is kept (what
  // the harness did before, so nothing unlinked changes).
  const exchange = storeExchangeOfCapture(capture, tv) || tv
  return { ticker, exchange }
}

/** The reach of a plot's per-bar colour rule, or null when it has none. */
function colourRuleLookback(o) {
  const p = o && o.presentation
  if (!p) return null
  const reaches = ['colorIndex', 'colorCondition', 'colorGradient']
    .map((k) => (p[k] && p[k].ast ? lookbackOf(p[k].ast) : null))
    .filter((n) => Number.isInteger(n))
  return reaches.length ? Math.max(...reaches) : null
}

function lookbackOf(ast) {
  try {
    const n = maxLookback(ast)
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

/** Colour a series point/option to `#rrggbbaa`, folding a plot opacity in. */
function withOpacity(hex, opacity) {
  const c = normalizeColor(hex)
  if (!c || !Number.isFinite(opacity)) return c
  const a = Math.max(0, Math.min(255, Math.round(opacity * 255))).toString(16).padStart(2, '0')
  return `${c.slice(0, 7)}${a}`
}

/** ⭐ RT6 — the paint records the pairing reads (`paintColours.gradePaints`).
 *  For a host-lane document they are the translation's own. A RUNTIME document
 *  draws a paint the host withheld for its colour (the run computes it): such a
 *  paint, found on the document by its kind and line, is graded as drawn rather
 *  than reported "withheld"; every other record is the translation's, verbatim. */
function runtimeAwarePaints(built, def) {
  const host = ((built.translation && built.translation.presentation) || {}).paints || []
  if (built.lane !== 'runtime') return host
  const drawn = new Set((def.paints || []).map((p) => `${p.kind}@${p.line}`))
  return host.map((p) => {
    if (!p || !drawn.has(`${p.kind}@${p.line}`)) return p
    const { withheld: _w, na: _n, ...rest } = p
    return rest
  })
}

/** Drive the real binder over the recording double; per plot key, the colour
 *  the renderer was handed for every bar (point colour, else series colour). */
function drawnColours(def, bars, ctx) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const out = new Map()
  if (!instances.length) return { ok: false, reason: 'addInstance produced no instance', byKey: out }
  // ⭐ B1 — the chart's own candles (an overlay `bgcolor` with no series of its own is
  // drawn through them) and the `barcolor` overrides, exactly as StockChart hands them.
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries || 'CandlestickSeries', {}, 0)
  let barColours = null
  const res = binder.sync({
    priceSeries: () => candles,
    setBarColours: (map) => { barColours = map },
    enabled: true,
    cs,
    instances,
    registry,
    bars,
    tf: ctx.tf,
    symbol: ctx.symbol,
    newestBarIsForming: ctx.newestBarIsForming,
    historyFromListing: ctx.historyFromListing === true,
    barIndexFromFirstBar: ctx.barIndexFromFirstBar === true,
    secondary: ctx.secondary || null,
    exchangeOf: ctx.exchangeOf,
    lowerTf: ctx.lowerTf || null,
    adjustTime: (t) => t,
    applyData: (series, data) => series.setData(data),
    plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
  })
  const plotByKey = new Map((def.plots || []).map((p) => [p.key, p]))
  for (const b of binder.bindings()) {
    if (!b || !b.series) continue
    const sets = fake.calls.filter((c) => c.method === 'setData' && c.id === b.series.__id)
    const data = sets.length ? sets[sets.length - 1].args[0] : null
    if (!Array.isArray(data)) continue
    const plot = plotByKey.get(b.plotKey) || {}
    const seriesColor = b.series.__options && b.series.__options.color
    const byTime = new Map(data.map((p) => [String(p.time), p]))
    // ⭐⭐ A DISPLACED PLOT'S COLOUR IS READ WHERE THE RENDERER DREW IT.
    // `offset = -N` draws the value computed on bar i at bar i - N (the binder's
    // `displacedColumn`), and TradingView's study data keys that value — and its
    // colour — to the computing bar i (the VALUES agree bar for bar, which is how
    // this was established). Reading the point at the undisplaced bar i found
    // nothing there: measured 2026-09-28 on liquidity-pools (offset -4, 46 bars
    // "vendor #787b86ff vs ours none"), price-action-as-in-book (-5, 26 bars) and
    // the legacy trendlines capture (-15). A value that would sit left of bar 0
    // was never drawn by either platform, so its colour is not a reading
    // (`undefined`, which the comparator skips), not a "none".
    // ⛔ The shift is the binder's OWN `drawShiftOf`, never re-derived here.
    const shift = drawShiftOf(plot)
    const colors = bars.map((_bar, i) => {
      const at = i + shift
      if (at < 0) return undefined
      const p = at < bars.length ? byTime.get(String(bars[at].t)) : null
      if (!p || !Number.isFinite(p.value)) return null
      // ⭐⭐ WHAT THE RENDERER WAS HANDED IS FINAL. The pool already folded the
      // plot's opacity into a point colour and a series colour (`withAlpha`,
      // which MULTIPLIES through); re-applying `opacity` here REPLACED the
      // colour's alpha. ⚰️ Measured 2026-09-28 on Ultimate Pivot Points' Pivot:
      // the `na` branch is a palette entry `rgba(0, 0, 0, 0)`, the plot's
      // opacity is 0.9, the renderer drew it at alpha 0 — and this read it
      // `#000000e6`, a visible black line nobody drew. Only the definition's
      // own colour, when the renderer was handed none, still takes the opacity.
      const drawn = p.color || seriesColor
      return drawn ? normalizeColor(drawn) : withOpacity(plot.color, plot.opacity)
    })
    out.set(b.plotKey, colors)
  }
  // ⭐ B1 — every background the binder attached, and what each was told to draw.
  const backgrounds = fake.calls
    .filter((c) => c.method === 'attachPrimitive' && c.args[0] && typeof c.args[0].options === 'function')
    .map((c) => ({ seriesId: c.id, colors: c.args[0].options().colors || null }))
  // ⛔ read BEFORE the teardown: releasing the binder clears the overrides it handed.
  const handed = barColours
  binder.teardown()
  return { ok: true, reason: null, byKey: out, sync: res, paints: { backgrounds, barColours: handed } }
}

/** ⭐ C45 — does the capture's OWN `bar_index` control row print 0, 1, 2 … on
 *  its bars? The vendor's statement that this series starts at its bar 0. Every
 *  bar is checked, not the first: a row that starts at 0 and skips is not it. */
export function barIndexStartsAtZero(capture) {
  const plots = (capture && capture.study && capture.study.plots) || []
  const control = plots.find((p) => /^[A-Za-z]\d\d_bar_index(_CONTROL)?$/.test(p.title || ''))
  const pv = capture && capture.plotValues
  if (!control || !pv || !Array.isArray(pv.rows) || !pv.rows.length) return false
  const at = pv.fields.indexOf(control.id)
  if (at < 0) return false
  const bars = (capture.bars && capture.bars.rows) || []
  if (bars.length !== pv.rows.length) return false
  for (let i = 0; i < pv.rows.length; i += 1) {
    if (pv.rows[i][0] !== bars[i][0] || pv.rows[i][at] !== i) return false
  }
  return true
}

/** ⭐⭐ RT5 — a runtime document's LIVE set at the last bar, made by its own run
 *  (`runtime/runtimeObjects.js`), in the same shape the object lane reports. */
function runtimeObjectsReport(def, bars, ctx, cols) {
  const withheldRun = runtimeObjectsWithheldOf(cols)
  if (withheldRun) {
    return { drawsObjects: true, ok: false, lane: 'runtime', withheld: withheldRun.guard,
      reason: `withheld by name (${withheldRun.guard}) — ${withheldRun.reason}` }
  }
  const payload = runtimeObjectsOf(cols)
  if (!payload) {
    const errs = registry.columnErrors ? registry.columnErrors(cols) : null
    const first = errs ? Object.values(errs)[0] : null
    return { drawsObjects: true, ok: false, lane: 'runtime',
      reason: `the run drew nothing${first ? ` (${first.guard || ''}: ${first.message || ''})` : ''}` }
  }
  const run = { live: payload.live, pineVersion: payload.pineVersion }
  const state = toRenderState(run.live, { bars, tf: ctx.tf, pineVersion: payload.pineVersion })
  return { ...heldReport(run.live, state, payload.pineVersion), lane: 'runtime',
    runStatus: payload.status, runReason: payload.reason || null, runWithheld: payload.withheld || {},
    undrawnProps: payload.undrawnProps || {}, chartClock: [] }
}

/** ⭐⭐ RT9 — a hybrid document's drawings, made by its own run, in the same shape. */
function hybridObjectsReport(payload, bars, ctx) {
  const state = toRenderState(payload.live, { bars, tf: ctx.tf, pineVersion: payload.pineVersion })
  return { ...heldReport(payload.live, state, payload.pineVersion),
    runStatus: payload.status, runReason: payload.reason || null, runWithheld: payload.withheld || {},
    undrawnProps: payload.undrawnProps || {}, chartClock: [] }
}

/** Counts, texts and held objects off a LIVE set and its render state. */
function heldReport(live, state, pineVersion) {
  const cells = state.tables.flatMap((t) => t.cells || [])
  const held = { line: 0, label: 0, box: 0 }
  const heldTexts = { label: [], box: [] }
  for (const o of live || []) {
    if (!o || !Object.prototype.hasOwnProperty.call(held, o.family)) continue
    held[o.family] += 1
    if (heldTexts[o.family]) {
      const t = o.props ? o.props.text : undefined
      heldTexts[o.family].push(t === undefined || t === null ? '' : String(t))
    }
  }
  return {
    drawsObjects: true,
    ok: true,
    counts: { lines: held.line, labels: held.label, boxes: held.box, tables: state.tables.length, tableCells: cells.length },
    drawn: { lines: state.lines.length, labels: state.labels.length, boxes: state.boxes.length },
    texts: { labels: heldTexts.label, boxes: heldTexts.box, tableCells: cells.map((c) => c.text) },
    dropped: state.dropped || null,
    held: live || [],
    tables: state.tables || [],
    pineVersion,
  }
}

/** ⭐⭐ F3 (2026-10-02) — A SCRIPT THAT DRAWS, WHOSE DRAWING THE DOOR WITHHELD,
 *  IS NOT A SCRIPT WITH "NO DRAWING PROGRAM". The host translation carried
 *  drawing steps (`objectDiagnostics.attemptedOps`), and the door kept none of
 *  them: either the object gate withheld the whole program for a lost removal
 *  (`paneObjectsGate`, the member's own "its drawings are not shown" sentence),
 *  or the program kept none of the steps it attempted (a create whose text
 *  reads an unbounded `ta.barssince`, another symbol's `request.security`).
 *  Graded as a GAP, by name — the verdict a withholding gets — never as a
 *  script that draws nothing. ⛔ Host lane only: a runtime-lane document has no
 *  drawing program of its own yet (RT5), and saying so is the true sentence. */
function drawingWithheldBy(built) {
  if (!built || built.lane === 'runtime') return null
  const t = built.translation
  const d = (t && t.objectDiagnostics) || {}
  if (!(Number.isInteger(d.attemptedOps) && d.attemptedOps > 0)) return null
  const gate = paneObjectsGate(t)
  if (!gate.draw) {
    const keys = [...new Set(((gate.loss && gate.loss.removes) || []).map((r) => r.key))]
    return { guard: gate.guard, reason: `the object gate withheld the whole drawing program for a lost removal (${keys.join(', ') || 'unnamed'})` }
  }
  if (t.objects && (t.objects.ops || []).length) return null
  const reasons = [
    ...Object.entries(d.dropReasons || {}).map(([k, n]) => `${k} ×${n}`),
    ...(((gate.loss && gate.loss.readerNames) || []).length ? [`never carried: ${gate.loss.readerNames.join(', ')}`] : []),
  ]
  const why = (d.createDropWhy || []).map((w) => (/ (pine:[a-z-]+)/.exec(w) || [])[1]).filter(Boolean)
  return {
    guard: 'pine:object-ops-refused',
    reason: `the program carried none of its ${d.attemptedOps} drawing steps (dropped: ${reasons.join(', ') || 'none named'}${why.length ? `; ${[...new Set(why)].join(', ')}` : ''})`,
  }
}

/** The object lane's LIVE set at the last bar, as counts and texts. */
function objectsOf(def, bars, ctx, cols, built = null) {
  if (drawsRuntimeObjects(def)) return runtimeObjectsReport(def, bars, ctx, cols)
  if (!def.objects || !(def.objects.ops || []).length) {
    const w = drawingWithheldBy(built)
    return w ? { drawsObjects: false, withheld: w.guard, reason: w.reason } : { drawsObjects: false }
  }
  try {
    const reader = objectReaderFor(def, bars, {
      inputs: undefined, tf: ctx.tf, symbol: ctx.symbol, newestBarIsForming: ctx.newestBarIsForming,
      historyFromListing: ctx.historyFromListing === true,
      barIndexFromFirstBar: ctx.barIndexFromFirstBar === true,
      secondary: ctx.secondary || null, exchangeOf: ctx.exchangeOf,
      lowerTf: ctx.lowerTf || null,
    })
    if (!reader) return { drawsObjects: true, ok: false, reason: 'objectReaderFor returned null' }
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime,
      readUnknown: reader.readUnknown,
      // ⭐ F1 — the binder's own statement (`binder.js`): off the listing a `var`
      // list of drawings is withheld whole (`objectRuntime.js`, `withheldBy`).
      offListing: reader.historyFromListing !== true,
    })
    if (run.withheldBy && run.withheldBy['objects:off-listing']) {
      const fams = run.withheldBy['objects:off-listing']
      // the same report shape as a drawing the door's gate withholds (F3,
      // `drawingWithheldBy`): a withheld family is a gap, graded as one
      return { drawsObjects: false, withheld: 'objects:off-listing',
        reason: `the ${fams.join(' / ')} drawings live in a \`var\` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable`,
        // the run's live set, for DIAGNOSTICS only (F4's window analysis reads it):
        // never graded — there is no `ok`, so `gradeCapture` pairs nothing
        held: [...(run.live || []), ...(run.offListingLive || [])].sort((x, y) => x.id - y.id) }
    }
    const state = toRenderState(run.live, { bars, tf: ctx.tf, pineVersion: reader.program.pineVersion })
    const cells = state.tables.flatMap((t) => t.cells || [])
    // ⭐⭐ LINES, LABELS AND BOXES ARE COUNTED AS THE SCRIPT HOLDS THEM — the
    // runtime's LIVE set at the last bar — because that is what the capture's
    // counts are. TradingView's `graphics()` collections keep an object whose
    // coordinate is `na`: measured 2026-09-27 on Zero-Lag MA Trend Levels
    // (NYSE:RDDT 1D), 18 box records, five of them with a null top or bottom
    // (`ta.atr(200)` is still warming when they are made). The render state
    // cannot draw those five and drops them, so counting IT compared 13 drawable
    // boxes against 18 held ones — a divergence between two different questions,
    // not between two engines. The render state's own drops are still reported
    // (`dropped`) so an undrawable object is named, never hidden.
    // ⚠️ Tables and cells keep the render state's count: no capture yet shows a
    // held-but-undrawn table or cell, so there is nothing to say they differ.
    const held = { line: 0, label: 0, box: 0 }
    const heldTexts = { label: [], box: [] }
    for (const o of run.live || []) {
      if (!o || !Object.prototype.hasOwnProperty.call(held, o.family)) continue
      held[o.family] += 1
      if (heldTexts[o.family]) {
        const t = o.props ? o.props.text : undefined
        heldTexts[o.family].push(t === undefined || t === null ? '' : String(t))
      }
    }
    return {
      drawsObjects: true,
      ok: true,
      counts: {
        lines: held.line,
        labels: held.label,
        boxes: held.box,
        tables: state.tables.length,
        tableCells: cells.length,
      },
      drawn: { lines: state.lines.length, labels: state.labels.length, boxes: state.boxes.length },
      // ⭐ `boxes` is reported, never graded by v1's comparator (it reads
      // labels and cells) — the zero-lag rail pins it against the records.
      texts: { labels: heldTexts.label, boxes: heldTexts.box, tableCells: cells.map((c) => c.text) },
      dropped: state.dropped || null,
      // ⭐ C37 — the objects themselves (the runtime's LIVE set, and the render
      // state's tables), for the colour column: a colour is compared on an object
      // PAIRED by value, which a count cannot do. ⭐ C44 — `gradeCapture` pairs
      // them (`objectColours.js`) and hands the slot rows to the verdict.
      // ⛔ The objects themselves are never written to a verdict file.
      held: run.live || [],
      tables: state.tables || [],
      pineVersion: reader.program.pineVersion,
      // ⭐ C36 — why drawings that read `time(<timeframe>)` are withheld here.
      chartClock: reader.chartClock || [],
    }
  } catch (err) {
    return { drawsObjects: true, ok: false, reason: `the object lane threw: ${String((err && err.message) || err)}` }
  }
}

/**
 * The two doors a member's paste passes through, and nothing else: the builder
 * (`memberPaneDefinition`, MemberPane.jsx's own call) and the install door
 * (`installUserDefinitions`, which re-validates and can refuse what the builder
 * accepted). `def` is the installed definition, or null with the door's own
 * sentence in `refusal`.
 *
 * ⛔ ONE AUTHORITY FOR "CAN THE MEMBER DOOR BUILD THIS". `runOurSide` below and
 * the vendor-batch manifest census (`memberDoorCensus.measure.test.js`) both
 * call this, so the batch never targets a script the grader would then refuse
 * for a reason the census did not see.
 *
 * ⚠️ On any path that reached the install door, the caller owns the uninstall
 * (`registry.uninstallUserDefinition(HARNESS_DEF_ID)`).
 */
export function enterMemberDoor(source) {
  const built = memberPaneDefinition({ source, id: HARNESS_DEF_ID, name: 'vendor harness' })
  if (!built.ok) {
    return { built, def: null, stage: 'builder', refusal: `member door refused${built.guard ? ` (${built.guard})` : ''}: ${built.reason}` }
  }
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  if (!installed.length) {
    return { built, def: null, stage: 'install', refusal: `install door refused: ${errors.join(' | ')}` }
  }
  return { built, def: installed[0], stage: null, refusal: null }
}

/** What a withholding code is about, for the note that names it. */
function whatWithheld(code) {
  if (code.startsWith('bar-index:')) return '`bar_index`'
  if (code.startsWith('seed:')) return 'a recursive series\' seed'
  return 'time(<timeframe>)'
}

/**
 * Run the member door on the capture's bars.
 *
 * @returns {{ok: boolean, refusal: string|null, plots: object[], objects: object,
 *            ctx: object, notes: string[]}}
 */
export function runOurSide(capture) {
  const notes = []
  const source = capture && capture.source && capture.source.text
  const door = enterMemberDoor(source)
  const built = door.built
  if (!built.ok) {
    return { ok: false, refusal: door.refusal, plots: [], notes }
  }
  try {
    if (!door.def) {
      return { ok: false, refusal: door.refusal, plots: [], notes }
    }
    const def = door.def
    const bars = toProductBars(capture)
    const tf = tfCodeOf(capture.timeframe)
    if (tf === capture.timeframe && !/^\d+$/.test(tf) && !['D', 'W', 'M'].includes(tf)) {
      notes.push(`timeframe ${JSON.stringify(capture.timeframe)} has no chart code — the bind-time fold folds nothing`)
    }
    const ctx = {
      tf,
      symbol: symbolOf(capture),
      newestBarIsForming: capture.newestBarIsForming ?? null,
      // ⭐ C12w — the product states this from the listing date
      // (`StockChart`, `listingSeed.historyFromListingOf`); a capture states it as
      // `history.startsAtBar0`, asserted only when the vendor's loaded history
      // stopped growing AND began on the listing day. Same fact, same door.
      historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true),
      // ⭐⭐ C45 — `bar_index` is TradingView's only where the series starts at
      // the bar TradingView counted as 0. A capture PROVES that about itself when
      // its own `plot(bar_index, …)` control row reads 0, 1, 2 … on its bars (an
      // intraday or weekly capture whose `startsAtBar0` asserts nothing about a
      // listing still can); one with no control row, or one that reads 8175 on its
      // first bar, does not — and what depends on the count is withheld by name,
      // exactly as the member's chart withholds it.
      barIndexFromFirstBar: barIndexStartsAtZero(capture),
    }
    // ⭐ C26 — another symbol's bars, from committed captures only.
    const supply = otherSymbolSupply(def, capture)
    if (supply.secondary) { ctx.secondary = supply.secondary; ctx.exchangeOf = supply.exchangeOf }
    notes.push(...supply.notes)
    // ⭐ C41 — the chart symbol's own intraday bars, from committed captures only.
    const lower = lowerTfSupply(def, capture)
    if (lower.lowerTf) ctx.lowerTf = lower.lowerTf
    notes.push(...lower.notes)
    const cols = registry.computeFor(def, bars, undefined, ctx)
    // ⭐ F8 — a column the door computed nothing for carries the door's own
    // sentence (`columnErrors`, what `runtimeRunStopOf` shows the member), so the
    // verdict names WHY instead of "no column".
    const colErrors = (registry.columnErrors && registry.columnErrors(cols)) || {}
    // ⭐ B1 — each carried paint's colour on every bar, through the binder's own
    // `paintColoursFor` (the function the chart draws with), keyed as the binder keys.
    const paintCols = new Map(Object.keys(cols || {}).map((k) => [bindingKey('harness', k), cols[k]]))
    const paints = (def.paints || []).map((p) => ({
      kind: p.kind, line: p.line ?? null, title: p.title ?? null,
      colors: paintColoursFor(p, 'harness', paintCols, bars.length),
    }))
    const lowerReport = registry.lowerTfReport(cols)
    if (lowerReport) {
      for (const c of lowerReport.served) notes.push(`lower timeframe ${c}: served`)
      for (const r of lowerReport.refused) notes.push(`lower timeframe ${r.code}: refused (${r.refusal}) — ${r.reason}`)
    }
    const otherReport = registry.otherSymbolReport(cols)
    if (otherReport) {
      for (const t of otherReport.served) notes.push(`other symbol ${t}: served`)
      for (const r of otherReport.refused) notes.push(`other symbol ${r.ticker}: refused (${r.code}) — ${r.reason}`)
    }
    // ⭐ C36 — a plot whose `time(<timeframe>)` is withheld on this chart, by name.
    // ⭐⭐ C45 — and one whose value depends on `bar_index` off the listing
    // (`bar-index:window`). A plot the door withholds on EVERY bar, by name, has
    // NO served value: it is graded "not compared — withheld by name", never as a
    // value that differs. ⚰️ Graded as a column of `na` it read DIVERGE, the
    // verdict a WRONG value gets, which is the one thing a withholding is not.
    // ⛔ Only `bar-index:window`: the C36 whole-series codes keep their grading
    // (changing another lane's verdict is not this one's to do).
    const clockReport = registry.chartClockReport(cols)
    // ⭐ F5 — per plot, the bars a recursive series' seed withholds off the
    // listing, with the bound each was decided from (`compare.mjs::seedWithheldAt`).
    const seedReport = registry.seedWarmupReport(cols)
    const withheldWhole = new Map()
    if (clockReport) {
      for (const r of clockReport.withheld) {
        const what = whatWithheld(r.code)
        notes.push(`${what} withheld (${r.code}) on ${r.plots.length} plot(s) — ${r.reason}`)
        // ⭐ H6 — `cum:window` (`ta.obv`'s level off the listing) is the same kind
        // of withholding: every bar, by name, never a value that differs.
        if (r.code === 'bar-index:window' || r.code === 'cum:window') for (const key of r.plots) withheldWhole.set(key, r.code)
      }
    }

    let colours
    try {
      colours = drawnColours(def, bars, ctx)
    } catch (err) {
      colours = { ok: false, reason: `binder threw: ${String((err && err.message) || err)}`, byKey: new Map() }
    }
    if (!colours.ok) notes.push(`colours unresolvable: ${colours.reason}`)

    const rowByAst = new Map((built.rows || []).map((r) => [r.ast, r]))
    // ⭐ A RUNTIME-LANE document (`memberPaneDefinition`'s route for a script the
    // columnar lane refuses) has no tree per output — each row names the host
    // output it draws instead, and is matched by that.
    const rowByOutput = new Map((built.rows || [])
      .filter((r) => Number.isInteger(r.output)).map((r) => [r.output, r]))
    const plots = []
    // ⭐ F8 — a runtime document says by name why it does not draw a row (its
    // `meta.disclosures`, one entry per withheld row, named as the door names it:
    // the title, else `<kind> <n>`). The verdict carries that sentence instead of
    // "did not carry this output".
    const disclosedWhy = new Map(((def.meta && def.meta.disclosures) || [])
      .map((d) => [d && d.name, d && d.note]))
    const ordOfKind = new Map()
    for (const [index, o] of (built.translation.outputs || []).entries()) {
      if (o && o.kind === 'alertcondition') continue
      const ord = (ordOfKind.get(o && o.kind) || 0) + 1
      ordOfKind.set(o && o.kind, ord)
      const doorLabel = (o && o.title) || `${o && o.kind} ${ord}`
      const row = built.lane === 'runtime'
        ? (rowByOutput.get(index) || null)
        : (o && o.ast ? rowByAst.get(o.ast) : null)
      const heldBy = row ? withheldWhole.get(row.key) : undefined
      const col = row && !heldBy ? cols[row.key] : undefined
      let missingReason = null
      if (heldBy) {
        missingReason = `withheld on this chart on every bar, by name (${heldBy}) — nothing is drawn for it`
      } else if (!row) {
        missingReason = built.lane === 'runtime' && disclosedWhy.has(doorLabel)
          ? `withheld by name on this runtime document — ${String(disclosedWhy.get(doorLabel)).slice(0, 400)}`
          : o && o.refusal
            ? `the translator refused this plot (${(o.refusal && (o.refusal.guard || o.refusal.message)) || 'refusal'})`
            : built.lane === 'runtime' && o && (hiddenOnChart(o) || o._authorHidden === true)
              ? `hidden on this runtime document (${(o && o.hiddenReason) || 'display.none'}): a hidden row computes no column here`
              : 'the member pane did not carry this output (hidden helper or beyond its row ceiling)'
      } else if (!col) {
        const e = colErrors[row.key]
        missingReason = `computeFor returned no column for ${row.key}`
          + (e ? ` — ${e.guard || 'refused'}: ${String(e.message || '').slice(0, 400)}` : '')
      }
      plots.push({
        title: o ? o.title : null,
        // ⭐ F8 — the output's KIND (`plot` / `plotshape` / `plotchar` / `plotarrow`),
        // which a repeated-title pairing must agree on (`compare.mjs::pairRepeatedTitles`),
        // and why OUR side hid the row (`pine.js` `hiddenReason`), which the verdict
        // reads to tell "the author hid it" from "this engine did not draw it".
        kind: o ? o.kind || null : null,
        // ⭐ H8 — only a row the CHART hides carries a reason: a constant the pane now
        // draws (`plot(0)`) and that another wall withholds is named by that wall.
        hiddenReason: o && hiddenOnChart(o) ? (o.hiddenReason || 'unstated') : null,
        formula: o ? o.formula : null,
        key: row ? row.key : null,
        hidden: !!(o && hiddenOnChart(o)),
        column: col || null,
        missingReason,
        lookback: o && o.ast ? lookbackOf(o.ast) : null,
        // ⭐ F2 — the colour rule's own reach (`compare.mjs::colourWarmupOf`).
        colorLookback: colourRuleLookback(o),
        colors: row && colours.byKey.has(row.key) ? colours.byKey.get(row.key) : null,
        // ⭐ F5 — the seed withholding, or null (see `seedReport`).
        seedWithheld: row && col && seedReport && seedReport[row.key] ? seedReport[row.key] : null,
        // A positive `offset = N` the translator wrote INTO the tree as `x[N]`
        // (its `_treeShift` hand-off) — see compare.mjs `leadBy`.
        treeShift: o && Number.isInteger(o._treeShift) && o._treeShift > 0 ? o._treeShift : 0,
        // Why there are no colours, when there are none — so the verdict names the
        // cause instead of "could not be resolved".
        colorsReason: row && !colours.byKey.has(row.key)
          ? (o && hiddenOnChart(o)
            ? `our pane draws no series for this row — hidden (${o.hiddenReason || 'unstated'})`
            : (colours.ok ? 'the binder bound no series for this row' : colours.reason))
          : null,
      })
    }
    // ⭐ RT4 — the binder's own gate: a runtime document whose run computed
    // nothing here draws none of its object program (`runtimeObjectsWithheld`).
    const objectsWithheld = registry.runtimeObjectsWithheld(def, cols)
    // ⭐⭐ RT9 — a host document whose drawings come from its own run: the binder's
    // own reader decides (`objectsRunFor`) — the run's drawings, or the host program.
    const hybrid = objectsWithheld ? null : registry.objectsRunFor(def, bars, undefined, ctx)
    if (hybrid && !hybrid.payload) {
      notes.push(`drawings: the run's are not drawn here (${hybrid.withheld.guard}) — ${hybrid.withheld.message}; the host object program is graded instead`)
    }
    const objects = objectsWithheld
      ? { drawsObjects: true, ok: false, withheld: objectsWithheld.guard, reason: `withheld by name (${objectsWithheld.guard}) — ${objectsWithheld.message}` }
      : (hybrid && hybrid.payload
        ? { ...hybridObjectsReport(hybrid.payload, bars, ctx), lane: 'hybrid' }
        : objectsOf(def, bars, ctx, cols, built))
    if (objects && hybrid) objects.objectsRun = { drawn: !!hybrid.payload, withheld: hybrid.withheld }
    for (const r of (objects && objects.chartClock) || []) {
      const what = whatWithheld(r.code)
      notes.push(`${what} withheld (${r.code}) in the object lane — ${r.reason}`)
    }
    if (objects && objects.ok && objects.drawn) {
      for (const f of ['lines', 'labels', 'boxes']) {
        const gap = objects.counts[f] - objects.drawn[f]
        if (gap > 0) notes.push(`${gap} of ${objects.counts[f]} held ${f} cannot be drawn (a coordinate is na) — counted as held, the way the capture counts them`)
      }
    }
    return {
      ok: true,
      refusal: null,
      plots,
      objects,
      ctx,
      notes,
      bars,
      // ⭐ B1 — what the door carried (every call, withheld ones included, in source
      // order), what the document draws, and what the binder handed the chart.
      paints,
      translationPaints: runtimeAwarePaints(built, def),
      drawnPaints: colours && colours.paints ? colours.paints : null,
    }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
