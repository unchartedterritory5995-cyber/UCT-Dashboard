// tools/vendor_harness/schema.mjs
//
// ─── THE VENDOR-COMPARISON CAPTURE FORMAT, v1 ─────────────────────────────────
//
// One TradingView study, read off the chart's OWN model (never a screenshot,
// never `exportData()` — that one is plan-gated), carrying everything a
// bar-by-bar comparison needs and nothing it has to guess:
//
//   * the VENDOR'S OWN BARS. `tests/fixtures/vendor/README.md` is the reason:
//     with our bars against their plot, a delta has two causes (maths or data)
//     and the harness cannot tell which. With their bars on both sides, any
//     delta IS a maths delta.
//   * every plot the study declares, in `metaInfo().plots` order — NEVER in
//     `Object.keys(styles)` order (capture-procedure.md, "COLUMN ORDER"; Aroon
//     came back swapped that way on 2026-09-10).
//   * colorer plots with their palette, so a per-bar colour is an INDEX plus a
//     table, not a pixel.
//   * the exact Pine source and its sha256, and the input values the study ran
//     with.
//   * a receipt, so transport corruption (a stomped clipboard, a cp1252 round
//     trip, a dropped chunk) is detectable. Same FNV-1a over UTF-16 code units
//     that `tools/visual_conformance/capture_page.js::__uctHash` and
//     `verify_clipboard.py::fnv1a` already compute — one algorithm, three
//     readers, none of them new.
//
// ⛔ PURE ESM, NO ENGINE IMPORTS. This file is read by the Node verifier
// (`verify_capture.mjs`), by the vitest harness, and — the FNV/sha halves — is
// mirrored in the browser snippet (`tv_capture.js`), whose own test asserts the
// two agree byte for byte.

import { createHash } from 'node:crypto'

export const SCHEMA_ID = 'uct.vendor-capture/v1'

/** The bar matrix columns, in order. `time` is UNIX SECONDS for a native capture
 *  (what TradingView's model holds) or an ISO `YYYY-MM-DD` for a legacy capture
 *  whose recorder only kept a date — `timeUnit` says which, and nothing sniffs. */
export const BAR_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume']
export const TIME_UNITS = ['unix-s', 'iso-date']

/** FNV-1a 32-bit over UTF-16 CODE UNITS — identical to `__uctHash`.
 *  ⚠️ JavaScript strings iterate by code unit here (charCodeAt), which is what
 *  the page does; Python's `verify_clipboard.fnv1a` iterates code points and
 *  agrees for the BMP only. This file never leaves JavaScript, so it is exact. */
export function fnv1a(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** sha256 of the UTF-8 bytes of a string, as lowercase hex. */
export function sha256Hex(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** The body a receipt is computed over: the capture WITHOUT its `receipt` key,
 *  serialised with `JSON.stringify` and no indentation.
 *
 *  ⭐ WHY THIS IS STABLE ACROSS A FILE ROUND TRIP: `JSON.parse` preserves key
 *  insertion order and a finite double re-serialises to the same shortest text
 *  it was written as, so parse → strip → stringify reproduces the page's string
 *  exactly. A capture pretty-printed to disk still verifies; a capture whose
 *  numbers were edited, re-ordered or rounded does not. */
export function canonicalBody(capture) {
  const { receipt, ...body } = capture || {}
  return JSON.stringify(body)
}

export function sealCapture(capture) {
  const text = canonicalBody(capture)
  return {
    ...capture,
    receipt: {
      algo: 'fnv1a32-utf16',
      over: 'JSON.stringify(capture without its receipt key)',
      chars: text.length,
      fnv1a: fnv1a(text),
    },
  }
}

export function verifyReceipt(capture) {
  const r = capture && capture.receipt
  if (!r || typeof r !== 'object') return { ok: false, reason: 'no receipt — transport integrity cannot be checked' }
  if (r.algo !== 'fnv1a32-utf16') return { ok: false, reason: `unknown receipt algorithm ${JSON.stringify(r.algo)}` }
  const text = canonicalBody(capture)
  if (text.length !== r.chars) {
    return { ok: false, reason: `receipt length ${r.chars} but the body is ${text.length} chars` }
  }
  const h = fnv1a(text)
  if (h !== r.fnv1a) return { ok: false, reason: `receipt fnv1a ${r.fnv1a} but the body hashes to ${h}` }
  return { ok: true, reason: null }
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const finiteOrNull = (x) => x === null || (typeof x === 'number' && Number.isFinite(x))

/**
 * Structural validation. Returns every problem, not the first — a capture that
 * is wrong in three ways should say so in one run.
 *
 * ⛔ A VALID CAPTURE IS NOT A TRUSTED ONE. This checks SHAPE; the receipt checks
 * TRANSPORT; the source sha checks that the script compared is the script the
 * vendor ran. All three are required before a verdict can be MATCH or DIVERGE.
 */
export function validateCapture(c) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  if (!isObj(c)) return { ok: false, errors: ['capture is not an object'] }

  need(c.schema === SCHEMA_ID, `schema must be ${JSON.stringify(SCHEMA_ID)}, got ${JSON.stringify(c.schema)}`)
  need(isObj(c.symbol) && typeof c.symbol.name === 'string' && c.symbol.name, 'symbol.name is required')
  need(typeof c.timeframe === 'string' && c.timeframe, 'timeframe is required (the chart\'s own interval string)')

  // ── source ──
  const s = c.source
  need(isObj(s), 'source is required')
  if (isObj(s)) {
    need(typeof s.text === 'string' && s.text.trim(), 'source.text must be the exact Pine the vendor ran')
    need(typeof s.sha256 === 'string' && /^[0-9a-f]{64}$/.test(s.sha256), 'source.sha256 must be 64 lowercase hex')
    if (typeof s.text === 'string' && typeof s.sha256 === 'string') {
      need(sha256Hex(s.text) === s.sha256, 'source.sha256 does not match source.text — the script compared would not be the script the vendor ran')
    }
  }

  // ── bars ──
  const b = c.bars
  need(isObj(b), 'bars is required')
  let barTimes = []
  if (isObj(b)) {
    need(Array.isArray(b.fields) && b.fields.join(',') === BAR_FIELDS.join(','), `bars.fields must be ${JSON.stringify(BAR_FIELDS)}`)
    need(TIME_UNITS.includes(b.timeUnit), `bars.timeUnit must be one of ${TIME_UNITS.join(' | ')}`)
    need(Array.isArray(b.rows) && b.rows.length > 0, 'bars.rows must be a non-empty array')
    if (Array.isArray(b.rows)) {
      b.rows.forEach((r, i) => {
        if (!Array.isArray(r) || r.length !== BAR_FIELDS.length) { errors.push(`bars.rows[${i}] must have ${BAR_FIELDS.length} fields`); return }
        const t = r[0]
        const tOk = b.timeUnit === 'iso-date' ? (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) : Number.isFinite(t)
        if (!tOk) errors.push(`bars.rows[${i}][0] is not a ${b.timeUnit} time`)
        for (let k = 1; k < r.length; k++) if (!finiteOrNull(r[k])) errors.push(`bars.rows[${i}][${k}] is not a finite number or null`)
      })
      barTimes = b.rows.map((r) => (Array.isArray(r) ? r[0] : undefined))
      const later = b.timeUnit === 'iso-date'
        ? (x, y) => String(x) > String(y)          // ISO dates order as strings
        : (x, y) => Number(x) > Number(y)
      for (let i = 1; i < barTimes.length; i++) {
        if (!later(barTimes[i], barTimes[i - 1])) {
          errors.push(`bars are not strictly increasing in time at row ${i}`)
          break
        }
      }
    }
    need(b.count === undefined || b.count === (Array.isArray(b.rows) ? b.rows.length : -1), 'bars.count disagrees with bars.rows.length')
  }

  // ── study ──
  const st = c.study
  need(isObj(st), 'study is required')
  let plotIds = []
  if (isObj(st)) {
    need(Array.isArray(st.plots) && st.plots.length > 0, 'study.plots must list the metaInfo plots in order')
    if (Array.isArray(st.plots)) {
      st.plots.forEach((p, i) => {
        if (!isObj(p) || typeof p.id !== 'string' || typeof p.type !== 'string') errors.push(`study.plots[${i}] needs id and type`)
      })
      plotIds = st.plots.map((p) => p && p.id)
      if (new Set(plotIds).size !== plotIds.length) errors.push('study.plots has duplicate ids')
      for (const p of st.plots) {
        if (p && p.type === 'colorer' && p.target && !plotIds.includes(p.target)) {
          errors.push(`colorer ${p.id} targets ${p.target}, which is not a plot of this study`)
        }
      }
    }
  }

  // ── plot values ──
  const pv = c.plotValues
  need(isObj(pv), 'plotValues is required')
  if (isObj(pv) && isObj(b)) {
    const expect = ['time', ...plotIds]
    need(Array.isArray(pv.fields) && pv.fields.join(',') === expect.join(','),
      `plotValues.fields must be ["time", ...study.plots ids in order] = ${JSON.stringify(expect)}`)
    need(Array.isArray(pv.rows), 'plotValues.rows must be an array')
    if (Array.isArray(pv.rows)) {
      const known = new Set(barTimes.map(String))
      let offGrid = 0
      pv.rows.forEach((r, i) => {
        if (!Array.isArray(r) || r.length !== expect.length) { errors.push(`plotValues.rows[${i}] must have ${expect.length} fields`); return }
        if (!known.has(String(r[0]))) offGrid += 1
        for (let k = 1; k < r.length; k++) if (!finiteOrNull(r[k])) errors.push(`plotValues.rows[${i}][${k}] is not a finite number or null`)
      })
      if (offGrid) errors.push(`${offGrid} plotValues rows have a time that is not one of the bars — the two matrices were read off different series`)
    }
  }

  // ── receipt ──
  const rc = verifyReceipt(c)
  if (!rc.ok) errors.push(`receipt: ${rc.reason}`)

  return { ok: errors.length === 0, errors }
}
