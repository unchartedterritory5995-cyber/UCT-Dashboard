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
import { isStrategyCapture, validateStrategyProvenance, STRATEGY_TOOL_VERSION } from './strategy_capture.mjs'

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

// ─── ⛔⛔ TRADINGVIEW'S COMPILED SCRIPT NEVER ENTERS THIS PUBLIC REPO (coordinator ruling 2026-11-23) ─────────────────
// Every capture records the study's inputs as TradingView lists them, and that list carries a hidden input
// (`id: 'text'`, `name: 'ILScript'`) whose value is TradingView's own ENCRYPTED COMPILED FORM of the script: their
// artifact, not the script author's source. A committed capture carries it REDACTED: the value replaced by
// REDACTED_COMPILED_SCRIPT, the capture RE-SEALED by `redact_capture.mjs`, and a `redactions` note naming the field, the
// original receipt and the tool. ⛔ A re-seal is accepted ONLY through that note, and the note is checked against the
// original receipt's LENGTH: putting back `originalChars` characters at the field and dropping the note must reproduce
// `originalReceipt.chars` exactly, so no other edit can hide inside a re-seal. (The original fnv1a cannot be re-checked
// without the value itself; that is the price of not holding it.) No grade reads this input: `captureInputs.js` reads
// only `in_N` inputs and `compare.mjs::nonDefaultInputs` skips hidden ones.
// ⭐ ENFORCED AT THE FILE BOUNDARY, not in `validateCapture`: every capture FILE a grade reads goes through
// `harness.js::loadCapture` (and `verify_capture.mjs`), which refuse a redacted file whose note does not verify; the
// rail `redactions.test.js` walks every committed fixture. An in-memory capture a test perturbs and re-seals is not a
// file and is not held to its original receipt.
export const COMPILED_SCRIPT_INPUT = 'ILScript'
export const REDACTED_COMPILED_SCRIPT = '[redacted: TradingView compiled script]'
export const REDACTION_TOOL = 'tools/vendor_harness/redact_capture.mjs'
// the input carries the compiled script in its `value` and, on many captures, again in its `defval`: both are redacted
export const REDACTION_FIELDS = Object.freeze({ value: 'study.inputs[name=ILScript].value', defval: 'study.inputs[name=ILScript].defval' })

/** Indexes of `study.inputs` entries that are TradingView's compiled script. */
export function compiledScriptInputs(capture) {
  const list = capture && capture.study && Array.isArray(capture.study.inputs) ? capture.study.inputs : []
  const out = []
  list.forEach((x, i) => { if (x && typeof x === 'object' && x.name === COMPILED_SCRIPT_INPUT) out.push(i) })
  return out
}

const clearText = (v) => typeof v === 'string' && v !== '' && v !== REDACTED_COMPILED_SCRIPT

/** True when the capture carries TradingView's compiled script in the clear (a non-empty, unredacted value or defval). */
export function carriesCompiledScript(capture) {
  return compiledScriptInputs(capture).some((i) => Object.keys(REDACTION_FIELDS).some((k) => clearText(capture.study.inputs[i][k])))
}

/** [{index, prop}] of every redacted slot, in input order then REDACTION_FIELDS order. */
function redactedSlots(capture) {
  const out = []
  for (const i of compiledScriptInputs(capture)) {
    for (const k of Object.keys(REDACTION_FIELDS)) if (capture.study.inputs[i][k] === REDACTED_COMPILED_SCRIPT) out.push({ index: i, prop: k })
  }
  return out
}

/** Checks a capture's `redactions` note (see above). `{ok, reason}`; a capture with no note and no redacted value is ok. */
export function verifyRedactions(capture) {
  const redacted = redactedSlots(capture)
  const notes = capture ? capture.redactions : undefined
  if (notes === undefined) {
    return redacted.length ? { ok: false, reason: `study.inputs[${redacted[0].index}].${redacted[0].prop} is ${JSON.stringify(REDACTED_COMPILED_SCRIPT)} but the capture carries no redactions note: an unexplained re-seal` } : { ok: true, reason: null }
  }
  if (!Array.isArray(notes) || notes.length === 0) return { ok: false, reason: 'redactions must be a non-empty list' }
  if (notes.length !== redacted.length) return { ok: false, reason: `redactions names ${notes.length} field(s) but ${redacted.length} value(s) are redacted` }
  const restored = JSON.parse(JSON.stringify(capture))
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k]
    if (!isObj(n)) return { ok: false, reason: `redactions[${k}] is not an object` }
    const keys = Object.keys(n).sort().join(',')
    if (keys !== 'at,by,field,index,originalChars,originalReceipt,replacedWith') return { ok: false, reason: `redactions[${k}] keys are ${keys}` }
    if (n.field !== REDACTION_FIELDS[redacted[k].prop]) return { ok: false, reason: `redactions[${k}].field ${JSON.stringify(n.field)} is not ${REDACTION_FIELDS[redacted[k].prop]}: no other field may be redacted` }
    if (n.replacedWith !== REDACTED_COMPILED_SCRIPT) return { ok: false, reason: `redactions[${k}].replacedWith is not the marker` }
    if (n.by !== REDACTION_TOOL) return { ok: false, reason: `redactions[${k}].by ${JSON.stringify(n.by)} is not ${REDACTION_TOOL}` }
    if (typeof n.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(n.at)) return { ok: false, reason: `redactions[${k}].at is not an ISO UTC time` }
    if (!Number.isInteger(n.index) || n.index !== redacted[k].index) return { ok: false, reason: `redactions[${k}].index ${n.index} is not the redacted input ${redacted[k].index}` }
    if (!Number.isInteger(n.originalChars) || n.originalChars <= 0) return { ok: false, reason: `redactions[${k}].originalChars must be a positive integer` }
    const r = n.originalReceipt
    if (!isObj(r) || r.algo !== 'fnv1a32-utf16' || !Number.isInteger(r.chars) || !Number.isInteger(r.fnv1a)) return { ok: false, reason: `redactions[${k}].originalReceipt is not a receipt` }
    // the stand-in has the original's JSON length: base64 needs no escaping, and `originalChars` is the escaped length
    restored.study.inputs[n.index][redacted[k].prop] = 'x'.repeat(n.originalChars)
  }
  if (new Set(notes.map((n) => JSON.stringify(n.originalReceipt))).size !== 1) return { ok: false, reason: 'the notes disagree on the original receipt' }
  delete restored.redactions
  const len = canonicalBody(restored).length
  if (len !== notes[0].originalReceipt.chars) {
    return { ok: false, reason: `the redaction does not account for the change: restored at the field the body is ${len} chars, the original receipt says ${notes[0].originalReceipt.chars}` }
  }
  return { ok: true, reason: null }
}


/** A TradingView filled-area id (`fill_0`, `fill_1`, …) — what a per-bar fill
 *  colour's colorer plot targets. Exported so the comparator classifies with
 *  the same rule the validator admits with. */
export const isFillTarget = (id) => typeof id === 'string' && /^fill_\d+$/.test(id)
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
    // ⭐ An objects-only study (no plot() at all) legitimately declares ZERO plots —
    // its answer is `objects`. Empty plots are accepted ONLY beside a readable objects
    // block with counts, so a capture that merely lost its plots is still refused.
    const objectsOnly = Array.isArray(st.plots) && st.plots.length === 0
      && isObj(c.objects) && isObj(c.objects.counts) && Object.keys(c.objects.counts).length > 0
    need(Array.isArray(st.plots) && (st.plots.length > 0 || objectsOnly), 'study.plots must list the metaInfo plots in order')
    if (Array.isArray(st.plots)) {
      st.plots.forEach((p, i) => {
        if (!isObj(p) || typeof p.id !== 'string' || typeof p.type !== 'string') errors.push(`study.plots[${i}] needs id and type`)
      })
      plotIds = st.plots.map((p) => p && p.id)
      if (new Set(plotIds).size !== plotIds.length) errors.push('study.plots has duplicate ids')
      for (const p of st.plots) {
        // A colorer may colour a FILLED AREA (`fill(p1, p2, color=…)` with a
        // per-bar colour): TradingView targets it at `fill_N`, an id from
        // metaInfo().filledAreas, not from plots. Measured 2026-09-27 on the
        // RVOL and Cumulative Volume Delta captures. Anything else still refuses.
        if (p && p.type === 'colorer' && p.target && !plotIds.includes(p.target) && !isFillTarget(p.target)) {
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

  // ── W9-T3a: a strategy capture written by tv_capture.js v3+ must carry its settings. ──
  // Gated on `tool.version` so the v2 strategy fixtures (2026-10-02/03) validate exactly as before.
  if (isStrategyCapture(c) && c.tool && Number(c.tool.version) >= STRATEGY_TOOL_VERSION) {
    errors.push(...validateStrategyProvenance(c))
  }

  // ── receipt ──
  const rc = verifyReceipt(c)
  if (!rc.ok) errors.push(`receipt: ${rc.reason}`)

  return { ok: errors.length === 0, errors }
}
