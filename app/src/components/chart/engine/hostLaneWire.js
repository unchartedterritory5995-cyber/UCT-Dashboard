// app/src/components/chart/engine/hostLaneWire.js
//
// ─── ⭐⭐ HOST WORKER — WHAT CROSSES BETWEEN THE CHART'S THREAD AND THE HOST LANE'S WORKER ─────────
//
// docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md. The host lane's VALUES
// (`astColumns.js::astColumnsGiven`) are computed in a worker for a document whose recurrences hold
// the main thread (`hostLaneAsync.js`). The SAME function runs on both threads; this module is what
// makes its arguments and its answer the same on both sides of a `postMessage`:
//
//   rows     every field every bar carries, column by column: a field whose every value is a number
//            rides a `Float64Array` (transferred, not copied: no main-thread copy of 11,534 bars), any
//            other a plain array. ⛔ NOT a fixed list of fields: a daily bar's `t` is an ISO date
//            STRING and an intraday one a number (`objectRenderState.makeBarClock`), and whatever
//            else a bar carries reaches the worker too, so the worker's rows read as the chart's.
//   context  the fields `astColumnsFor` reads (`HOST_CTX_FIELDS`, held to the closure by
//            `hostLaneWorker.rail.test.js`), the other-symbol and intraday bars a document reads
//            (only the entries its own decision asked for), and the answers `exchangeOf` gave
//            (a function does not cross; the table of its answers does).
//   answer   every enumerable column (a `Float64Array`'s buffer transferred back) and the records
//            the values carry beside them (`astColumns.js::astSideRecordsOf`), re-attached on the
//            chart's side exactly as `astColumnsFor` attaches them.
//
// ⛔ HOST-NEUTRAL: no worker, no window, no network. Both threads import it.

/** A field kind: every value a number, carried in a `Float64Array` (exact: a double is a double,
 *  `-0`, `NaN` and `Infinity` included), or anything else, carried as it is. */
const F64 = 'f64'
const ANY = 'any'

/** The rows' fields, column by column, and the buffers a post may transfer.
 *  @returns {{pack: {n: number, fields: Array<[string, string, ArrayLike<unknown>]>}, transfer: ArrayBuffer[]}} */
export function packRows(rows) {
  const n = Array.isArray(rows) ? rows.length : 0
  const names = []
  const seen = new Set()
  for (let i = 0; i < n; i += 1) {
    const r = rows[i]
    if (!r || typeof r !== 'object') continue
    for (const k in r) {
      if (!seen.has(k) && Object.prototype.hasOwnProperty.call(r, k)) { seen.add(k); names.push(k) }
    }
  }
  const fields = []
  const transfer = []
  for (const name of names) {
    let numeric = true
    for (let i = 0; i < n; i += 1) {
      const r = rows[i]
      if (!r || typeof r[name] !== 'number') { numeric = false; break }
    }
    if (numeric) {
      const col = new Float64Array(n)
      for (let i = 0; i < n; i += 1) col[i] = rows[i][name]
      fields.push([name, F64, col])
      transfer.push(col.buffer)
    } else {
      const col = new Array(n)
      for (let i = 0; i < n; i += 1) {
        const r = rows[i]
        col[i] = r && Object.prototype.hasOwnProperty.call(r, name) ? r[name] : undefined
      }
      fields.push([name, ANY, col])
    }
  }
  return { pack: { n, fields }, transfer }
}

/** The rows `packRows` packed: one plain object per bar, each holding the fields its bar held. */
export function unpackRows(pack) {
  const n = pack && Number.isInteger(pack.n) ? pack.n : 0
  const rows = new Array(n)
  for (let i = 0; i < n; i += 1) rows[i] = {}
  for (const [name, kind, col] of (pack && pack.fields) || []) {
    if (kind === F64) {
      for (let i = 0; i < n; i += 1) rows[i][name] = col[i]
    } else {
      for (let i = 0; i < n; i += 1) if (col[i] !== undefined) rows[i][name] = col[i]
    }
  }
  return rows
}

/** ⭐ THE PLAIN FIELDS OF THE CONTEXT `astColumnsFor` READS (beside `symbol`, `secondary`,
 *  `exchangeOf` and `lowerTf`, which cross below). ⛔ ONE LIST: `hostLaneWorker.rail.test.js` walks
 *  the closure of `astColumns.js` and fails on a `ctx.<field>` read this list and those four do
 *  not carry, so a new read cannot compute differently in the worker without a red.
 *  ⭐ RS RATING L11 — `requestCode` and `below` are the RUN's request (`runtime/requestSupply.js` sets
 *  them per request; the host lane's context never holds them): carried all the same, so a context
 *  that holds one answers the same on both threads, and one that does not stays without it (only a
 *  defined field is imaged, and `otherSymbols` asks `hasOwnProperty`). `chartNewestDay` (L11 PR 2) is
 *  the chart's newest day, which `astColumnsFor` derives from the rows themselves (`withChartNewestDay`)
 *  on whichever thread runs it: carried for the same reason, never needed. ⭐ RS RATING L12 PR 2 — `chartBars`
 *  (the seed's intraday landing, `otherSymbols.js::utcMidnightAtOrAfterOf`) is derived by the same
 *  `withChartNewestDay` from the same rows: likewise carried, never needed (a chart's context never holds it). */
// ⭐⭐ (2026-11-20) `listingStart`: the listing FACT on a weekly / monthly chart where it is not served (`listingSeed.
// listingStartOf`), read by the host lane's notes (`astColumns.listingOptsFor`, `interpret.chartClockSentence`)
export const HOST_CTX_FIELDS = Object.freeze(['tf', 'newestBarIsForming', 'historyFromListing', 'barIndexFromFirstBar', 'framed',
  'requestCode', 'below', 'chartNewestDay', 'chartBars', 'listingStart'])
/** The context fields that cross by their own rule (not plain). `workSink` is the headless export's
 *  counter and never on a chart's context. ⭐⭐ U-DAILY (e96) — `dailyFrame` (the daily bars a daily read is computed
 *  on, with the chart's projection as `place`, a function) never crosses: a document handed one is computed on the
 *  main thread (`hostLaneAsync.hostLaneColumns` answers null before anything is posted). */
export const HOST_CTX_CARRIED = Object.freeze(['symbol', 'secondary', 'exchangeOf', 'lowerTf', 'workSink', 'dailyFrame'])

/** A value as plain data: primitives, and plain objects and arrays of them; a function is left out. */
function plainOf(v, depth = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v
  if (depth > 6) return undefined
  if (Array.isArray(v)) return v.map((x) => plainOf(x, depth + 1))
  const out = {}
  for (const [k, x] of Object.entries(v)) {
    const p = plainOf(x, depth + 1)
    if (p !== undefined || x === undefined) out[k] = p
  }
  return out
}

/** One bars-map entry (`{bars, status, exchange, sourceCode, …}`) as plain data, its bars packed. */
function entryImageOf(entry, transfer) {
  if (!entry || typeof entry !== 'object') return { absent: entry === undefined ? 'u' : 'n' }
  const out = {}
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'bars' && Array.isArray(v)) {
      const { pack, transfer: t } = packRows(v)
      out.bars = { packed: pack }
      transfer.push(...t)
    } else if (v === null || typeof v !== 'object') {
      if (typeof v !== 'function') out[k] = v
    } else {
      const p = plainOf(v)
      if (p !== undefined) out[k] = p
    }
  }
  return { entry: out }
}

function entryFromImage(img) {
  if (!img || img.absent) return img && img.absent === 'n' ? null : undefined
  const out = { ...img.entry }
  if (out.bars && out.bars.packed) out.bars = unpackRows(out.bars.packed)
  return out
}

/**
 * The context image a job carries: the plain fields, the symbol, and — ONLY for the keys its own
 * decision asked (`asked`, recorded on the chart's thread by `hostLaneAsync.recordedDecision`) —
 * the other-symbol entries, the intraday entries and `exchangeOf`'s answers.
 * @param {object} ctx the chart's context, as `astColumnsFor` would be handed it
 * @param {{secondary: Set<string>, lowerTf: Set<string>, exchange: Map<string, unknown>}} asked
 * @returns {{image: object, transfer: ArrayBuffer[]}}
 */
export function ctxImageOf(ctx, asked) {
  const c = ctx || {}
  const image = {}
  const transfer = []
  for (const f of HOST_CTX_FIELDS) if (c[f] !== undefined) image[f] = plainOf(c[f])
  if (c.symbol !== undefined) image.symbol = plainOf(c.symbol)
  const mapImage = (map, keys) => {
    if (!map || typeof map.get !== 'function') return map === undefined ? undefined : null
    return [...(keys || [])].map((k) => [k, entryImageOf(map.get(k), transfer)])
  }
  const sec = mapImage(c.secondary, asked && asked.secondary)
  if (sec !== undefined) image.secondary = sec
  const ltf = mapImage(c.lowerTf, asked && asked.lowerTf)
  if (ltf !== undefined) image.lowerTf = ltf
  if (typeof c.exchangeOf === 'function') {
    image.exchange = [...((asked && asked.exchange) || new Map())].map(([k, v]) => [k, plainOf(v)])
  }
  return { image, transfer }
}

/** The context `ctxImageOf` imaged, as the worker's `astColumnsFor` reads it. */
export function ctxFromImage(image) {
  const img = image || {}
  const ctx = {}
  for (const f of HOST_CTX_FIELDS) if (Object.prototype.hasOwnProperty.call(img, f)) ctx[f] = img[f]
  if (Object.prototype.hasOwnProperty.call(img, 'symbol')) ctx.symbol = img.symbol
  const mapOf = (entries) => {
    if (entries === null) return null
    const m = new Map()
    for (const [k, e] of entries) {
      const v = entryFromImage(e)
      if (v !== undefined) m.set(k, v)
    }
    return m
  }
  if (Object.prototype.hasOwnProperty.call(img, 'secondary')) ctx.secondary = mapOf(img.secondary)
  if (Object.prototype.hasOwnProperty.call(img, 'lowerTf')) ctx.lowerTf = mapOf(img.lowerTf)
  if (Object.prototype.hasOwnProperty.call(img, 'exchange')) {
    const table = new Map(img.exchange)
    ctx.exchangeOf = (k) => (table.has(k) ? table.get(k) : null)
  }
  return ctx
}

/** A values map as an answer: every enumerable column, the records beside them, and the buffers to
 *  transfer (each once: two columns may be one array). */
export function answerImageOf(out, sidesOf) {
  const columns = {}
  const buffers = new Set()
  for (const k of Object.keys(out || {})) {
    const col = out[k]
    columns[k] = col
    if (col && ArrayBuffer.isView(col) && col.buffer instanceof ArrayBuffer) buffers.add(col.buffer)
  }
  return { answer: { columns, sides: sidesOf(out) }, transfer: [...buffers] }
}

/** The values map an answer carried, its records re-attached (`withSides`). */
export function answerFromImage(answer, withSides) {
  const out = {}
  for (const [k, col] of Object.entries((answer && answer.columns) || {})) out[k] = col
  return withSides(out, answer && answer.sides)
}

// ⭐ A THROW CROSSES BY THE ONE RULE FOR ERRORS AT A WORKER BOUNDARY (`runtime/errorImage.js`, #1749):
// its name, its message and every own field that is plain data, rebuilt with every one it carried. The
// runtime lane's worker and this one share it, so a field a lane adds tomorrow crosses both, unnamed.
export { errorImageOf, errorFromImage } from './runtime/errorImage.js'
