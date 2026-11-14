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
import { NOT_SHOWN, runtimeWithheldWhy, runtimeWithheldCause } from '../../ast/objectLoss'
import { toRenderState } from '../../objectRenderState'
// ⭐ RT5 — a runtime document's own drawings.
import { runtimeObjectsOf, runtimeObjectsWithheldOf, drawsRuntimeObjects, runtimeWarmupOf, RUNTIME_WARMUP_KEY, runHalfOf, carriesRunHalf } from '../../runtime/runtimeObjects'
import { runtimeDeclinedTag } from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { maxLookback, CHART_CLOCK_WHOLE, interpret as interpretTree } from '../../ast/interpret'
import { setRuntimeDoorClock } from '../../runtime/runtimeColumns'
import { paneObjectsGate } from '../../ast/paneGate'
import { otherSymbolRequestsOf, storeTickerOf } from '../../otherSymbols'
import { lowerTfCodesOf, LOWER_TF_SOURCE } from '../../lowerTf'
import SYMBOL_SCOPE from '../../ast/symbolScope.json'
import { createFakeChart } from '../fakeChart'
import { normalizeColor } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { fullBarsFor } from '../../../../../utils/barsBackfill'
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
    // ⭐⭐ F7 (step 93) — NO INTRABAR FROM AFTER THE CAPTURE'S OWN CLOCK. The supply is
    // every committed capture of the listing, and a LATER capture holds bars this one
    // could not have seen: CAP round 4's `vw-request-htf-alignment-spy-60-2026-10-02`
    // (bars to 2026-10-02 19:30Z) fed 2026-10-01 / 10-02 60m closes into the 1W capture
    // taken 2026-10-01T03:10Z, so its forming week read 769.65 where TradingView, at
    // that moment, read 762.46. What the chart saw then is the bars that had OPENED.
    const clock = Date.parse((capture && capture.capturedAtUTC) || '')
    const cut = Number.isFinite(clock) ? clock / 1000 : Infinity
    const all = held.get(tf).bars
    const seen = cut === Infinity ? all : all.filter((x) => Number(x.t) < cut)
    lowerTf.set(`code:${code}`, { bars: seen, status: 'available', sourceCode: tf })
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

// ─── ⭐⭐ RC1 — WARM BARS: THE SAME SERIES' OWN HISTORY, FROM COMMITTED CAPTURES ─
//
// A capture that does NOT start at the listing (`history.startsAtBar0 !== true`)
// was computed by TradingView with history BEFORE its first bar: its study engine
// holds more bars than it ships to the chart, so `window.studyBarsLoaded` is the
// output buffer, not the computation depth. Measured 2026-10-04 (lane RC1) on SPY
// 1D, window 2019-08-06..2026-10-02: TradingView's `ema(close, 35)`-based plots are
// numeric ON BAR 0, which no cold start can produce; a cold replay of the 1800
// window bars disagreed on 109 bars across six scripts' paints, and the same
// window with SPY's 1993+ history in front of it agreed on every one.
//
// The member's chart is warm the same way (a standalone D chart loads 12,500 bars
// and `binder.sync` computes over all of them), so replaying [prehistory + window]
// is what the product does, not a tolerance.
//
// ⛔⛔ NOTHING IS SPLICED THAT IS NOT PROVED. A supplier is another committed
// capture of the SAME listing at the SAME timeframe that holds bars before the
// window AND holds the window's first bar. Every window bar inside the supplier's
// span must be in it, equal on time, open, high, low, close AND volume. One field
// off on one bar and that supplier is REFUSED BY NAME (the note says which file,
// which bar, which field); the next supplier is tried, and with none left the
// replay is cold and says so. The deepest proved supplier wins.
// ⛔ A capture whose own `bar_index` control reads 0 on its first bar is never
// warmed: TradingView itself started counting there, so its history did too.
// ⭐ THE LISTING FLAG IS INHERITED FROM THE SUPPLIER, NEVER ASSUMED (lane B1P,
// 2026-10-04, atr-trailing-stop-by-ceyhun-spy): the replay over [prehistory +
// window] carries `historyFromListing` exactly when the SUPPLIER asserts
// `startsAtBar0` (its first bar is the listing, so the replayed series is too, as
// on a member's standalone D chart). A supplier that does not start at the listing
// keeps it off. ⛔ It is NEVER forced on for the short capture itself: that seeds a
// listing-only pass at a bar that is not the listing (B1P probe C: 23 WRONG colours).
const OHLCV_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume']

// ⭐ RC1 — `TICKER|tf` → what each committed capture spans (metadata only, so the index
// costs one parse of the directory and holds no bars). A candidate's own rows are read
// back, and its receipt validated, only once it is actually considered.
// ⛔ Deliberately NOT `otherCaptureIndex`: that validates every capture's receipt up
// front (measured ~57 s for the directory), which every paint capture would then pay.
let warmCandidateIndex = null
const warmCandidateRows = new Map()

function warmCandidates() {
  if (warmCandidateIndex) return warmCandidateIndex
  warmCandidateIndex = new Map()
  if (!fs.existsSync(OTHER_CAPTURE_DIR)) return warmCandidateIndex
  for (const name of fs.readdirSync(OTHER_CAPTURE_DIR).sort()) {
    if (!name.endsWith('.json')) continue
    let cap
    try { cap = JSON.parse(fs.readFileSync(path.join(OTHER_CAPTURE_DIR, name), 'utf8')) } catch { continue }
    if (!cap || cap.schema !== 'uct.vendor-capture/v1' || !cap.bars || !Array.isArray(cap.bars.rows)) continue
    const rows = cap.bars.rows
    if (!rows.length) continue
    const { ticker } = symbolOf(cap)
    if (!ticker) continue
    const key = `${String(ticker).toUpperCase()}|${tfCodeOf(cap.timeframe)}`
    if (!warmCandidateIndex.has(key)) warmCandidateIndex.set(key, [])
    warmCandidateIndex.get(key).push({ file: name, timeUnit: cap.bars.timeUnit,
      firstT: rows[0][0], lastT: rows[rows.length - 1][0],
      listing: !!(cap.history && cap.history.startsAtBar0 === true) })
  }
  return warmCandidateIndex
}

/** A candidate's own rows, or null when its receipt does not validate. */
function warmCandidateRowsOf(file) {
  if (!warmCandidateRows.has(file)) {
    let rows = null
    try {
      const cap = JSON.parse(fs.readFileSync(path.join(OTHER_CAPTURE_DIR, file), 'utf8'))
      if (validateCapture(cap).ok) rows = cap.bars.rows
    } catch { rows = null }
    warmCandidateRows.set(file, rows)
  }
  return warmCandidateRows.get(file)
}

/** The prehistory a capture's paints, plots and objects are replayed over (DIV-1:
 *  plots and objects too), or why there is none.
 *  @returns {{kind: 'warm'|'cold'|'bar0', rows: any[]|null, file: string|null,
 *             bars: number, refused: string[], reason: string}} */
export function warmBarsSupply(capture) {
  const none = (kind, reason, refused = []) => ({ kind, rows: null, file: null, bars: 0, refused, reason, historyFromListing: null })
  if (capture && capture.history && capture.history.startsAtBar0 === true) {
    return none('bar0', 'the capture starts at the listing (history.startsAtBar0); there is no history before bar 0')
  }
  if (barIndexStartsAtZero(capture)) {
    return none('bar0', "the capture's own bar_index control reads 0 on its first bar; TradingView's history started there")
  }
  const rows = (capture && capture.bars && capture.bars.rows) || []
  if (!rows.length) return none('cold', 'the capture holds no bars')
  const { ticker } = symbolOf(capture)
  const key = `${String(ticker || '').toUpperCase()}|${tfCodeOf(capture.timeframe)}`
  const first = rows[0][0]
  const refused = []
  const proved = []
  for (const meta of warmCandidates().get(key) || []) {
    // only a capture that starts BEFORE the window and reaches its first bar
    if (meta.timeUnit !== capture.bars.timeUnit || !(meta.firstT < first) || meta.lastT < first) continue
    const candRows = warmCandidateRowsOf(meta.file)
    if (!candRows) { refused.push(`${meta.file}: its receipt does not validate`); continue }
    const cand = { file: meta.file, rows: candRows, listing: meta.listing }
    const at = cand.rows.findIndex((r) => r[0] === first)
    if (at <= 0) continue // the window's first bar is not in it
    const byT = new Map(cand.rows.map((r) => [r[0], r]))
    const candLast = cand.rows[cand.rows.length - 1][0]
    let why = null
    for (const w of rows) {
      if (w[0] > candLast) break
      const c = byT.get(w[0])
      if (!c) { why = `window bar ${w[0]} is absent from it inside its span`; break }
      for (let k = 1; k < OHLCV_FIELDS.length; k += 1) {
        if (c[k] !== w[k]) { why = `bar ${w[0]} ${OHLCV_FIELDS[k]} ${c[k]} vs the capture's ${w[k]}`; break }
      }
      if (why) break
    }
    if (why) { refused.push(`${cand.file}: ${why}`); continue }
    proved.push({ file: cand.file, rows: cand.rows.slice(0, at), listing: cand.listing })
  }
  if (!proved.length) {
    return none('cold', refused.length
      ? `every candidate supplier was refused, cold replay (${refused.join('; ')})`
      : `no committed capture of ${key} holds bars before ${first}, cold replay`, refused)
  }
  proved.sort((a, b) => (b.rows.length - a.rows.length) || (a.file < b.file ? -1 : 1))
  const pick = proved[0]
  return { kind: 'warm', rows: pick.rows, file: pick.file, bars: pick.rows.length, refused,
    historyFromListing: pick.listing === true,
    reason: `${pick.rows.length} bars of prehistory from ${pick.file}`
      + `${pick.listing ? ' (which starts at the listing: historyFromListing on)' : ' (not from the listing: historyFromListing off)'}`
      + `, every overlapping window bar equal on ${OHLCV_FIELDS.join('/')}` }
}

/** ⭐ DIV-1 — a column map computed over [prehistory + window], as the WINDOW's:
 *  every column sliced past the `pre` prehistory bars, every non-enumerable payload
 *  the readers walk (`columnErrors`, other-symbol / lower-timeframe / chart-clock
 *  reports, the runtime's drawings) carried verbatim — the shape
 *  `calcBarsWindow.widenToChart` uses in the other direction. The runtime's withheld
 *  warm-up (`runtimeWarmupOf`) is the one payload counted in bars, so it is moved
 *  into the window's indices (never below 0, and never dropped: a curtain that
 *  existed still withholds the run's drawings, as on the chart). */
/** ⭐ ENGINE 56 — the union of a plot's per-bar witness withholdings (`registry
 *  .withheldBarsReport`, computed over `calcBars`), sliced to the window: a 0/1 array, or
 *  null when no bar of it was withheld by name. */
export function withheldBarsOf(report, key, pre) {
  const codes = report && report[key]
  if (!codes) return null
  const masks = Object.values(codes)
  if (!masks.length) return null
  const n = masks[0].length
  const out = new Array(Math.max(0, n - (pre || 0))).fill(0)
  for (const m of masks) for (let i = pre || 0; i < n; i++) if (m[i]) out[i - (pre || 0)] = 1
  return out.some(Boolean) ? { bars: out, codes: Object.keys(codes).sort() } : null
}

/** ⭐⭐ ENGINE 56 (S4-4) — THE FLOAT-ORDER FLOOR OF A PLOT FED BY A RUNNING TOTAL, per bar
 *  of the window, or null. Coordinator ruling: where a `cum` (or `sum`) feeds the plot, two
 *  correct engines that add the same terms in a different order differ by a few ulps of the
 *  TOTAL, not of the plot (an `ema(ad, 12) - ema(ad, 26)` of a 1e9 accumulation is a 1e6
 *  difference carrying 1e9's rounding). So the absolute floor on bar i is
 *  `8 · ε · max |total|` over bars 0..i of the computed series (prehistory included). Only
 *  the running-total operand's own magnitude enters: a relative 1e-6 error in the plot is
 *  still a DIVERGE (railed in `vendorHarness.engine56FloatFloor.test.js`). */
export const FLOAT_ORDER_ULPS = 8
const RUNNING_TOTAL_NODES = new Set(['cum', 'cumFrom', 'sum'])
export function floatOrderFloorOf(tree, calcBars, pre) {
  if (!tree || typeof tree !== 'object') return null
  const totals = []
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'call' && RUNNING_TOTAL_NODES.has(n.name)) totals.push(n)
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  if (!totals.length) return null
  const len = calcBars.length
  const mag = new Float64Array(len)
  for (const node of totals) {
    let col
    try { col = interpretTree(node, calcBars, undefined, undefined, undefined, {}) } catch { return null }
    if (!col || typeof col.length !== 'number' || col.length !== len) return null
    let m = 0
    for (let i = 0; i < len; i++) {
      const v = Math.abs(col[i])
      if (Number.isFinite(v) && v > m) m = v
      if (m > mag[i]) mag[i] = m
    }
  }
  const out = []
  for (let i = pre || 0; i < len; i++) out.push(FLOAT_ORDER_ULPS * Number.EPSILON * mag[i])
  return out
}

export function columnsInWindow(cols, pre) {
  if (!cols || typeof cols !== 'object' || !(pre > 0)) return cols
  const out = {}
  for (const [k, col] of Object.entries(cols)) {
    out[k] = col && typeof col.slice === 'function' ? col.slice(pre) : col
  }
  for (const key of Object.getOwnPropertyNames(cols)) {
    if (Object.hasOwn(out, key)) continue
    let value = cols[key]
    if (key === RUNTIME_WARMUP_KEY && value && Number.isInteger(value.withheldBars)) {
      value = { ...value, withheldBars: Math.max(0, value.withheldBars - pre) }
    }
    Object.defineProperty(out, key, { value, enumerable: false, configurable: true })
  }
  return out
}

/** ⭐⭐ DIV-1 — does the PLOT / OBJECT lane replay over the proved prehistory, and why
 *  not when it does not. ONE decision, pure, so every rule is railed on its own.
 *
 *  Replays only what a member's chart computes:
 *   · a proved supplier (`warmBarsSupply` 'warm') — never invented history;
 *   · a DAILY chart — an intraday chart first-paints a shallow window and deepens only
 *     on a pan, so it never computes from the supplier's first bar;
 *   · a script reading no other symbol's / lower timeframe's bars — their prehistory is
 *     not supplied;
 *   · ⭐ r1 (review N2) — at most the depth the product computes: the standalone daily
 *     chart loads `fullBarsFor('D')` bars (the product's own constant, read here, never
 *     restated), so a supplier whose prehistory + window exceeds it would grade a series
 *     no member's chart computes. Then the replay is cold, and graded as before.
 *  ⚠️ What a replayed MATCH speaks for (review N3): the STANDALONE daily chart. A grid
 *  cell first-paints shallow (`backgroundWarm={false}`), and W / M stay cold here.
 *  @returns {{replay: boolean, kind: 'replayed'|'cold'|'bar0', why: string}} */
export function replayDecisionOf({ supplyKind, supplyBars = 0, supplyReason = '', file = null,
  windowBars = 0, tf, readsOtherSymbol = false, readsLowerTf = false } = {}) {
  if (supplyKind !== 'warm') return { replay: false, kind: supplyKind === 'bar0' ? 'bar0' : 'cold', why: supplyReason }
  if (tf !== 'D') {
    return { replay: false, kind: 'cold',
      why: `a proved supplier exists (${file}) but a ${tf} chart first-paints a shallow window and deepens only on a pan, so it does not compute from the supplier's first bar (not a daily chart), cold replay` }
  }
  if (readsOtherSymbol || readsLowerTf) {
    return { replay: false, kind: 'cold',
      why: `a proved supplier exists (${file}) but the script also reads ${readsOtherSymbol ? 'another symbol' : 'a lower timeframe'} whose prehistory is not supplied, cold replay` }
  }
  const depth = fullBarsFor('D')
  if (supplyBars + windowBars > depth) {
    return { replay: false, kind: 'cold',
      why: `a proved supplier exists (${file}) but its ${supplyBars} bars of prehistory + the ${windowBars}-bar window exceed the ${depth} bars a member's daily chart computes (fullBarsFor('D')), cold replay` }
  }
  return { replay: true, kind: 'replayed',
    why: `${supplyReason}; graded as the STANDALONE daily chart computes it (${supplyBars + windowBars} of at most ${depth} bars; a grid cell first-paints shallow, and W / M stay cold)` }
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

/** The ISO date a unix time falls on, in the exchange's timezone.
 *  ⭐ G17 — ONE formatter per timezone, reused. This built a fresh
 *  `Intl.DateTimeFormat` per BAR; `toProductBars` calls it for every daily row of
 *  every committed capture when the other-symbol index is first built, and with
 *  wave 16's 337 captures (163 MB, master: 139 / 78 MB) that build measured 66 s
 *  of a 64 s first `request.security` read — past C26's 60 s case budget. The
 *  formatter is pure, so the dates are byte-identical. */
const ISO_DATE_FORMATTERS = new Map()
export function isoDateIn(unixSeconds, timeZone) {
  const zone = timeZone || 'Etc/UTC'
  let f = ISO_DATE_FORMATTERS.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    ISO_DATE_FORMATTERS.set(zone, f)
  }
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
  // ⭐ DIV-4 — a HOST document draws a `barcolor` the host withheld for its colour
  // when it reads that colour from the per-bar run (`compute.runtimeColours`,
  // `memberPaneDefinition::runtimeReadPaints`): graded as drawn, the same rule.
  const readsRunColours = !!(def && def.compute && def.compute.runtimeColours)
  if (built.lane !== 'runtime' && !readsRunColours) return host
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
  // ⭐ OZ — a family the run withheld whole is graded as a gap with a name, the
  // way the host lane's are (the member reads the same sentence, `runtimeWithheldWhy`).
  const rtWhy = runtimeWithheldWhy(payload.withheld)
  const rtFams = rtWhy ? Object.keys(rtWhy).sort() : []
  return { ...heldReport(run.live, state, payload.pineVersion), lane: 'runtime',
    ...(rtFams.length ? { withheldFamilies: rtFams,
      withheldGuards: [...new Set(rtFams.map((f) => runtimeWithheldCause(payload.withheld[f], f)))].sort(),
      withheldWhy: [...new Set(Object.values(rtWhy))].join(' ') } : {}),
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

/** ⭐ OZ — the families a run withheld by name with nothing of them drawn
 *  (`NOT_SHOWN` guards), merged into the collector's `withheldFamilies`, with the
 *  guards and the member's sentence(s) for the verdict's reason. */
function notShownReport(withheldBy, withheldWhy, base = null) {
  const by = withheldBy || {}
  const guards = Object.values(NOT_SHOWN).filter((g) => Array.isArray(by[g]) && by[g].length)
  if (!guards.length) return {}
  const fams = new Set([...(by['objects:collector'] || []), ...(by['objects:collector-all'] || []), ...(base || [])])
  for (const g of guards) for (const f of by[g]) fams.add(f)
  const why = [...new Set(guards.flatMap((g) => by[g]).map((f) => (withheldWhy || {})[f]).filter(Boolean))]
  return {
    withheldFamilies: [...fams].sort(),
    withheldGuards: [...(by['objects:collector'] ? ['objects:collector'] : []),
      ...(by['objects:collector-all'] ? ['objects:collector-all'] : []), ...guards],
    withheldWhy: why.join(' '),
  }
}

/** ⭐⭐ ENGINE 53 — a host document's RUN HALF (`nativeRegistry.js::withRunHalf`): where the
 *  bind served it, the run's drawings are graded (the binder draws them and not the host
 *  program's); otherwise the host program's, as the chart draws them. The state rides on
 *  the report (`runHalf`, `runHalfCode`) for the census and the regrade. */
function objectsOf(def, bars, ctx, cols, built = null) {
  const half = carriesRunHalf(def) ? runHalfOf(cols) : null
  const tag = half ? { runHalf: half.state, runHalfCode: half.code || null } : {}
  if (half && half.state === 'served') return { ...runtimeObjectsReport(def, bars, ctx, cols), ...tag }
  const r = hostObjectsOf(def, bars, ctx, cols, built)
  return r && half ? { ...r, ...tag } : r
}

/** The object lane's LIVE set at the last bar, as counts and texts. */
function hostObjectsOf(def, bars, ctx, cols, built = null) {
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
      readUnknown: reader.readUnknown, readUnknownOther: reader.readUnknownOther,
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
      // ⭐ W-C22-DEL — families the run withheld WHOLE, by name, because
      // TradingView's collector may have removed objects this run holds
      // (`objectRuntime.js`, `withheldBy['objects:collector']`): graded as a gap.
      ...(run.withheldBy && (run.withheldBy['objects:collector'] || run.withheldBy['objects:collector-all'])
        ? { withheldFamilies: [...new Set([...(run.withheldBy['objects:collector'] || []),
          ...(run.withheldBy['objects:collector-all'] || [])])].sort() } : {}),
      // ⭐ OZ — and a family the run drew NONE of for a cause of the engine's own
      // (`objectRuntime.js`, `notShown`), by the same name the member reads.
      ...notShownReport(run.withheldBy, run.withheldWhy),
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
    // ⭐ WS-0: a refusal the RUNTIME lane declined (pane on) says so, by code, so a
    // runtime-on harness run can count its walls; with the pane dark it never appears.
    return { built, def: null, stage: 'builder', refusal: `member door refused${built.guard ? ` (${built.guard})` : ''}${built.runtimeDeclined ? ` ${runtimeDeclinedTag(built.runtimeDeclined.code)}` : ''}: ${built.reason}` }
  }
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  if (!installed.length) {
    return { built, def: null, stage: 'install', refusal: `install door refused: ${errors.join(' | ')}` }
  }
  return { built, def: installed[0], stage: null, refusal: null }
}

/** ⭐⭐ THE PARITY CLOCK: one that never moves. A grade is a question about VALUES, so
 *  the runtime pane's wall-clock stop (`RUNTIME_PANE_TIME_BUDGET_MS`) must not answer it:
 *  on a busy box delta-rsi's cold run passed 1,000 ms and graded INCONCLUSIVE ("no
 *  column") while its values MATCH. Installed for the length of one grade and restored in
 *  the `finally`; the instruction budgets (`limits.js`) still stop a runaway, and the
 *  member door's budget is railed on its own (`runtimeDoorBudget.rail.test.js`). */
const PARITY_CLOCK = () => 0

/**
 * Run the member door on the capture's bars.
 *
 * @returns {{ok: boolean, refusal: string|null, plots: object[], objects: object,
 *            ctx: object, notes: string[]}}
 */
/** Does this column hold no value on any bar (a by-name withholding that reached
 *  every bar)? A missing column answers no: there is nothing to grade either way. */
export function withholdsEveryBar(column) {
  if (!column || typeof column.length !== 'number' || !column.length) return false
  for (let i = 0; i < column.length; i++) if (column[i] === column[i]) return false
  return true
}

/** ⭐ 2026-11-09 (triage lane WN; review N2) — WHICH PLOTS OUR SIDE WITHHELD BY
 *  NAME ON EVERY BAR: `Map<plotKey, code>` from the door's chart-clock report.
 *  ⛔ The COLUMN decides, for every code, whole-series ones included: a plot whose
 *  column holds no value on any bar is withheld (graded INCONCLUSIVE, with the
 *  code); a code named on a plot that still draws a value is graded on those
 *  values and SAID (`notes`), so a mislabelled served plot cannot hide as
 *  INCONCLUSIVE. Each code's note is pushed here too. */
export function withheldPlotsOf(clockReport, cols, notes) {
  const out = new Map()
  if (!clockReport) return out
  for (const r of clockReport.withheld) {
    const what = r.code.startsWith('bar-index:') ? '`bar_index`'
      : r.code.startsWith('running-total:') ? 'a running total'
        : r.code.startsWith('var-origin:') ? '`var`'
          : r.code.startsWith('pine:') ? 'a value (engine 56 per-bar witness)' : 'time(<timeframe>)'
    notes.push(`${what} withheld (${r.code}) on ${r.plots.length} plot(s) — ${r.reason}`)
    const whole = CHART_CLOCK_WHOLE.includes(r.code)
    for (const key of r.plots) {
      if (out.has(key)) continue
      if (withholdsEveryBar(cols[key])) out.set(key, r.code)
      else if (whole) notes.push(`${key}: named ${r.code} (withheld on every bar) but its column holds values — graded on them`)
    }
  }
  return out
}

export function runOurSide(capture) {
  setRuntimeDoorClock(PARITY_CLOCK)
  try {
    return runOurSideOnTheParityClock(capture)
  } finally {
    setRuntimeDoorClock(null)
  }
}

function runOurSideOnTheParityClock(capture) {
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
    // ⭐⭐ DIV-1 (2026-11-09) — THE PLOT AND OBJECT LANES GRADE WITH THE HISTORY
    // TRADINGVIEW HAD. RC1 (below) already replayed the PAINTS over [prehistory +
    // window]; the plot and object lanes still started cold at the capture's first
    // bar, while TradingView computed every one of these captures with the symbol's
    // history back to the listing in front of it (DIVERGE triage 2026-11-08: 24 SPY
    // 1D captures diverging on a converging prefix). Gated on what the PRODUCT does,
    // measured before this was written: a standalone daily chart first-paints
    // `fullBarsFor('D')` = 12,500 bars (`StockChart._deepFirstPaint`), the server's
    // deep branch serves SPY from its 1993-01-29 listing (8,502 sessions; the 6,677
    // before the SPY windows are the supplier's own sessions, closes equal at the
    // median), the binder computes over every loaded bar, and `historyFromListing`
    // is stated from the listing date. So this makes the harness measure what a
    // member's chart computes; it is not a tolerance.
    // ⛔ ONE SUPPLIER, THE PROVED ONE (`warmBarsSupply`), and the listing flag is the
    // SUPPLIER's. `barIndexFromFirstBar` is NOT stated on the replay: no member
    // surface states it (`nativeRegistry.barIndexAbsoluteFor`); on a listing series
    // `interpret` derives `bar_index` from the listing itself, exactly as on the chart.
    // ⛔ NEVER INVENTED HISTORY: a capture that also reads another symbol's or a lower
    // timeframe's bars stays cold — those series' prehistory is not supplied, and
    // replaying ours against their window-only bars is a series no chart computes.
    // ⛔ DAILY ONLY — the gate measured a DAILY chart. An intraday chart first-paints
    // `firstPaintBarsFor(tf)` (under 1,200 bars) and deepens only when the member pans
    // (`barsBackfill.shouldBackfill`), so its computation does NOT start at the
    // supplier's first bar: replaying intraday would grade a series the chart does not
    // compute. (The paint lane's RC1 replay is its own rule and is unchanged.)
    // ⭐ r1 (review N2) — and never deeper than the product's own daily depth
    // (`replayDecisionOf`, which holds every rule above as one pure decision).
    const replaySupply = warmBarsSupply(capture)
    const decision = replayDecisionOf({
      supplyKind: replaySupply.kind, supplyBars: replaySupply.bars, supplyReason: replaySupply.reason,
      file: replaySupply.file, windowBars: bars.length, tf,
      readsOtherSymbol: !!supply.secondary, readsLowerTf: !!lower.lowerTf,
    })
    const replay = decision.replay
    const replayPre = replay ? replaySupply.bars : 0
    const calcBars = replay
      ? toProductBars({ ...capture, bars: { ...capture.bars, rows: replaySupply.rows.concat(capture.bars.rows) } })
      : bars
    const calcCtx = replay ? { ...ctx, historyFromListing: replaySupply.historyFromListing === true } : ctx
    notes.push(`plots/objects: ${decision.kind}: ${decision.why}`)
    const calcCols = registry.computeFor(def, calcBars, undefined, calcCtx)
    const cols = replay ? columnsInWindow(calcCols, replayPre) : calcCols
    // ⭐ B1 — each carried paint's colour on every bar, through the binder's own
    // `paintColoursFor` (the function the chart draws with), keyed as the binder keys.
    // ⭐⭐ RC1 — over [prehistory + window] when a proved supplier exists
    // (`warmBarsSupply`), then SLICED to the window. (DIV-1: the plot and object
    // lanes now take the same supplier, above; the paint lane's own rules — warm
    // even where DIV-1 stays cold — are unchanged.)
    // (asked whenever the script records a paint at all, so a grade whose paints the
    // door folded to `na` still says which history it stands on)
    const recordsPaints = (def.paints || []).length > 0 || runtimeAwarePaints(built, def).length > 0
    const paintSupply = recordsPaints ? replaySupply : null
    if (paintSupply) notes.push(`paints: ${paintSupply.kind}: ${paintSupply.reason}`)
    const warm = !!(paintSupply && paintSupply.kind === 'warm' && (def.paints || []).length > 0)
    const pre = warm ? paintSupply.bars : 0
    const paintBars = warm ? (replay ? calcBars
      : toProductBars({ ...capture, bars: { ...capture.bars, rows: paintSupply.rows.concat(capture.bars.rows) } }))
      : bars
    // ⭐ the warm replay's own context: the listing flag comes from the SUPPLIER
    const paintCtx = warm ? { ...ctx, historyFromListing: paintSupply.historyFromListing === true } : ctx
    // (with DIV-1 replaying, the paint pass is the SAME computation — same bars, same
    // context — so it is read off `calcCols` rather than run twice)
    const paintColsRaw = warm ? (replay ? calcCols : registry.computeFor(def, paintBars, undefined, paintCtx)) : cols
    const paintCols = new Map(Object.keys(paintColsRaw || {}).map((k) => [bindingKey('harness', k), paintColsRaw[k]]))
    const paints = (def.paints || []).map((p) => {
      const all = paintColoursFor(p, 'harness', paintCols, paintBars.length)
      return { kind: p.kind, line: p.line ?? null, title: p.title ?? null,
        colors: Array.isArray(all) ? all.slice(pre) : all }
    })
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
    // ⭐⭐ 2026-11-09 (`fix/pine-cumulative-off-listing`, triage lane WN) — EVERY
    // whole-series code, not only `bar-index:window`. ⚰️ The C36 codes
    // (`time-anchor:not-daily`, `time-own:chart-unwitnessed`, …) were left out "to
    // keep another lane's verdict", and their all-`na` columns graded DIVERGE: 13
    // captures over vw-time-tf / vw-bar-counters / vw-bar-origin read as WRONG
    // values where the door had withheld them by name. A per-bar code
    // (`time-anchor:period-open-missing`, `bar-index:early-bars`, …) withholds some
    // bars; a plot it names whose column holds NO value on any bar is withheld
    // whole just the same, and graded the same way. A plot with values keeps its
    // comparison: the bars the door drew are still judged.
    const withheldWhole = withheldPlotsOf(registry.chartClockReport(cols), cols, notes)
    // ⭐ ENGINE 56 — the bars each plot was withheld on by a per-bar witness code
    const withheldBarsReport = registry.withheldBarsReport(calcCols)
    let colours
    // ⭐ DIV-1 — the plot colours the binder draws over the SAME replayed bars the
    // values were computed on, each sliced to the window.
    let calcColours = null
    try {
      if (replay) {
        calcColours = drawnColours(def, calcBars, calcCtx)
        colours = { ...calcColours,
          byKey: new Map([...calcColours.byKey].map(([k, c]) => [k, Array.isArray(c) ? c.slice(replayPre) : c])),
          paints: null }
      } else {
        colours = drawnColours(def, bars, ctx)
      }
    } catch (err) {
      colours = { ok: false, reason: `binder threw: ${String((err && err.message) || err)}`, byKey: new Map() }
    }
    if (!colours.ok) notes.push(`colours unresolvable: ${colours.reason}`)
    // ⭐ RC1 — what the binder hands the chart for the PAINTS, over the same warm
    // bars the paints were graded on, sliced to the window (backgrounds by index,
    // candle overrides by the window's own bar times).
    let drawnPaints = colours && colours.paints ? colours.paints : null
    if (warm) {
      try {
        // (the DIV-1 pass above IS this pass when it replayed: same bars, same context)
        const w = replay && calcColours ? calcColours : drawnColours(def, paintBars, paintCtx)
        const keep = new Set(bars.map((b) => String(b.t)))
        drawnPaints = w && w.paints ? {
          backgrounds: w.paints.backgrounds.map((b) => ({ ...b, colors: Array.isArray(b.colors) ? b.colors.slice(pre) : b.colors })),
          barColours: w.paints.barColours
            ? new Map([...w.paints.barColours].filter(([t]) => keep.has(String(t)))) : w.paints.barColours,
        } : null
      } catch (err) {
        notes.push(`paints: the warm binder pass threw (${String((err && err.message) || err)}); no drawn paints`)
        drawnPaints = null
      }
    }

    const rowByAst = new Map((built.rows || []).map((r) => [r.ast, r]))
    // ⭐ A RUNTIME-LANE document (`memberPaneDefinition`'s route for a script the
    // columnar lane refuses) has no tree per output — each row names the host
    // output it draws instead, and is matched by that.
    const rowByOutput = new Map((built.rows || [])
      .filter((r) => Number.isInteger(r.output)).map((r) => [r.output, r]))
    // ⭐ UIE PHASE 2 — a runtime run off the listing WITHHOLDS its warm-up
    // (`runtimeColumns.js::computeOffListing`): those bars are blank on the chart, so
    // they are the plot's warm-up region here, exactly as a tree's own lookback is.
    const curtain = built.lane === 'runtime' ? runtimeWarmupOf(cols) : null
    const plots = []
    for (const [index, o] of (built.translation.outputs || []).entries()) {
      if (o && o.kind === 'alertcondition') continue
      const row = built.lane === 'runtime'
        ? (rowByOutput.get(index) || null)
        : (o && o.ast ? rowByAst.get(o.ast) : null)
      const heldBy = row ? withheldWhole.get(row.key) : undefined
      // ⚠️ `bar-index:window` keeps the shape C45 pinned (no column at all); every
      // other by-name withholding keeps its all-`na` column for the rails that read
      // it, and carries `withheldBy` — which `compare.mjs` grades exactly as it grades
      // a missing column: INCONCLUSIVE, with the reason.
      const col = row && heldBy !== 'bar-index:window' ? cols[row.key] : undefined
      let missingReason = null
      if (heldBy) {
        missingReason = `withheld on this chart on every bar, by name (${heldBy}) — nothing is drawn for it`
      } else if (!row) {
        missingReason = o && o.refusal
          ? `the translator refused this plot (${(o.refusal && (o.refusal.guard || o.refusal.message)) || 'refusal'})`
          : 'the member pane did not carry this output (hidden helper or beyond its row ceiling)'
      } else if (!col) {
        // ⭐ HONESTY-SWEEP r3 — say WHY, when the door recorded it. A runtime run stopped by
        // its wall-clock budget (`runtime:time-budget`, 1,000 ms) read here as a bare "no
        // column", so a measure-pair could not tell a load-sensitive stop from a lane that
        // dropped its columns (delta-rsi RDDT, MATCH -> INCONCLUSIVE, 2026-11-08).
        const why = registry.columnErrors(cols)[row.key]
        missingReason = `computeFor returned no column for ${row.key}`
          + (why && why.guard ? ` (${why.guard})` : '')
      }
      const heldBars = row && col ? withheldBarsOf(withheldBarsReport, row.key, replayPre) : null
      if (heldBars) notes.push(`${row.key}: ${heldBars.bars.filter(Boolean).length} bar(s) withheld by name (${heldBars.codes.join(', ')}) — not compared`)
      plots.push({
        title: o ? o.title : null,
        formula: o ? o.formula : null,
        key: row ? row.key : null,
        withheldBy: heldBy || null,
        // ⭐ ENGINE 56 — 0/1 per window bar: withheld by name, graded "not compared"
        withheldBars: heldBars ? heldBars.bars : null,
        withheldBarsCodes: heldBars ? heldBars.codes : null,
        // ⭐ ENGINE 56 (S4-4) — the float-order floor where a running total feeds the plot
        floatOrderFloor: built.lane !== 'runtime' && o && o.ast && col ? floatOrderFloorOf(o.ast, calcBars, replayPre) : null,
        hidden: !!(o && o.hidden),
        column: col || null,
        missingReason,
        lookback: curtain ? curtain.withheldBars : (o && o.ast ? lookbackOf(o.ast) : null),
        // ⭐ DIV-1 — the bars of proved prehistory this plot was computed over before
        // the window (`compare.mjs` reads it into the warm-up region), or null (cold).
        historyReplayed: replay ? { bars: replayPre, file: replaySupply.file } : null,
        // ⭐ F2 — the colour rule's own reach (`compare.mjs::colourWarmupOf`).
        colorLookback: colourRuleLookback(o),
        colors: row && colours.byKey.has(row.key) ? colours.byKey.get(row.key) : null,
        // A positive `offset = N` the translator wrote INTO the tree as `x[N]`
        // (its `_treeShift` hand-off) — see compare.mjs `leadBy`.
        treeShift: o && Number.isInteger(o._treeShift) && o._treeShift > 0 ? o._treeShift : 0,
        // Why there are no colours, when there are none — so the verdict names the
        // cause instead of "could not be resolved".
        colorsReason: row && !colours.byKey.has(row.key)
          ? (o && o.hidden
            ? `our pane draws no series for this row — hidden (${o.hiddenReason || 'unstated'})`
            : (colours.ok ? 'the binder bound no series for this row' : colours.reason))
          : null,
      })
    }
    // ⭐ RT4 — the binder's own gate: a runtime document whose run computed
    // nothing here draws none of its object program (`runtimeObjectsWithheld`).
    const objectsWithheld = registry.runtimeObjectsWithheld(def, cols)
    const objects = objectsWithheld
      ? { drawsObjects: true, ok: false, withheld: objectsWithheld.guard, reason: `withheld by name (${objectsWithheld.guard}) — ${objectsWithheld.message}` }
      // ⭐ DIV-1 — the LIVE set at the last bar of the replayed series: the window's
      // last bar, after every bar TradingView ran before it
      : objectsOf(def, calcBars, calcCtx, calcCols, built)
    for (const r of (objects && objects.chartClock) || []) {
      const what = r.code.startsWith('bar-index:') ? '`bar_index`' : 'time(<timeframe>)'
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
      // ⭐ RC1 — which bars the paints were replayed over: `warm` (with the
      // supplier's file and bar count), `cold`, or `bar0`. Read by `gradePaints`.
      paintSupply: paintSupply ? { kind: paintSupply.kind, file: paintSupply.file, bars: paintSupply.bars,
        replayed: warm,
        historyFromListing: warm ? paintCtx.historyFromListing : ctx.historyFromListing,
        refused: paintSupply.refused, reason: paintSupply.reason } : null,
      // ⭐ DIV-1 — which bars the PLOT and OBJECT lanes were computed over.
      historyReplay: { kind: decision.kind, file: replay ? replaySupply.file : null, bars: replayPre,
        historyFromListing: calcCtx.historyFromListing === true, reason: decision.why,
        // ⚠️ review N3 — what a replayed MATCH speaks for
        speaksFor: replay ? 'the standalone daily chart (not a grid cell, which first-paints shallow; W / M stay cold)' : null },
      translationPaints: runtimeAwarePaints(built, def),
      drawnPaints,
      // ⭐ ENGINE 53 — what the door did with the run half (minted / declined by code); the bind's
      // answer (served / refused) rides on `objects.runHalf`.
      runHalfDoor: built.runHalf ? 'minted' : (built.runHalfDeclined ? `declined:${built.runHalfDeclined.code}` : null),
    }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
