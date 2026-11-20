// app/src/components/chart/engine/__tests__/vendorHarness/objectRecords.js
//
// ─── OBJECTS v2 — OUR LIVE OBJECTS PAIRED WITH THE CAPTURE'S RECORDS, FIELD BY FIELD ──
//
// Test infrastructure (like `objectColours.js`). v1 grades drawings by counts,
// texts and colours of objects paired BY VALUE; it never asks where a drawing
// is. This file pairs each of our live objects with the capture's record of the
// same family by CREATION ORDER (by VALUE where the two counts differ,
// `alignByValue`) and reads every field the capture holds, one row per field:
// `{field, state, vendor, ours}`.
//
// What a row's state MEANS for the grade, which fields exist, which vendor codes
// decode to what and which fields are not graded (and why) are said ONCE, in
// `tools/vendor_harness/compare.mjs` (`OBJECTS_V2_FIELDS`, `compareObjectsV2`).
// ⛔ Nothing here computes a drawing: our side is what `ourSide.js` (the member
// door) produced, the vendor side is the capture's own record.

import { objectDefaultsFor, makeBarClock } from '../../objectRenderState'
import { isThemeColour } from '../../objectTheme'
import {
  OBJECTS_V2_FIELDS, OBJECTS_V2_FAMILIES, tolerancePolicy, valuesAgree, normalizeColor, coloursAgree, NO_COLOUR,
} from '../../../../../../../tools/vendor_harness/compare.mjs'
import { vendorColourReader, pairUndrawn, CELL_TEXT_DEFAULT } from './objectColours'

const isNa = (x) => x === null || x === undefined || (typeof x === 'number' && Number.isNaN(x))
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)
const ourHex = (c) => (c === undefined || c === null || c === 'transparent' ? NO_COLOUR : normalizeColor(String(c)))
const byId = (a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)

/** Align two creation-ordered lists at their NEWEST end. */
function alignNewest(vendor, ours) {
  const n = Math.min(vendor.length, ours.length)
  const v = vendor.slice(vendor.length - n)
  const o = ours.slice(ours.length - n)
  return { pairs: v.map((rec, i) => [rec, o[i]]), unpairedVendor: vendor.length - n, unpairedOurs: ours.length - n }
}

/** ⭐⭐ WHEN THE COUNTS DIFFER, PAIR BY VALUE (coordinator ruling 2026-11-19): each record of the SMALLER side, newest
 *  first, takes the unused record of the other side it agrees with best on every field the capture holds (geometry and
 *  style: fewest fields that differ, then most that agree), never the one at its position. Ties fall back to the
 *  newest-end position, then the lower id, so records that agree wherever they pair are paired exactly as before.
 *  ⚰️ MEASURED: rsi-support-resistance-by-dgt draws its 5 level lines and withholds its 200 oscillator lines by name.
 *  Aligned at the newest end, our 5 level lines were graded against TradingView's 5 NEWEST lines (oscillator lines) and
 *  "differed" in y, though each equals one of TradingView's dotted level lines bit for bit (local capture, RDDT 1D).
 *  Equal counts keep creation order (and `alignById`'s diagnostic): nothing a capture already pairs moves.
 *  @param {(v: object, o: object) => {differ: number, agree: number}} score */
const lexLess = (a, b) => {
  for (let q = 0; q < a.length; q += 1) if (a[q] !== b[q]) return a[q] < b[q]
  return false
}
function alignByValue(vendor, ours, score) {
  if (vendor.length === ours.length) return alignNewest(vendor, ours)
  const n = Math.min(vendor.length, ours.length)
  const vendorSmaller = vendor.length < ours.length
  const small = vendorSmaller ? vendor : ours
  const large = vendorSmaller ? ours : vendor
  const off = large.length - n // where the newest-end alignment puts small[i]: large[i + off]
  const used = new Set()
  const pairs = []
  for (let i = small.length - 1; i >= 0; i -= 1) {
    let best = -1
    let bestKey = null
    for (let j = 0; j < large.length; j += 1) {
      if (used.has(j)) continue
      const s = vendorSmaller ? score(small[i], large[j]) : score(large[j], small[i])
      const key = [s.differ, -s.agree, Math.abs(j - (i + off)), j]
      if (!bestKey || lexLess(key, bestKey)) {
        best = j
        bestKey = key
      }
    }
    used.add(best)
    pairs.push(vendorSmaller ? [small[i], large[best]] : [large[best], small[i]])
  }
  pairs.reverse()
  return { pairs, unpairedVendor: vendor.length - n, unpairedOurs: ours.length - n, byValue: true }
}

/** The alternate pairing: records whose ids are EQUAL on both sides first (the
 *  capture's id and ours are both creation counters), the rest aligned at the
 *  newest end. Used only to SAY whether a difference is a creation-order one. */
function alignById(vendor, ours) {
  const oursById = new Map(ours.map((o) => [o.id, o]))
  const pairs = []
  const usedV = new Set()
  const usedO = new Set()
  for (const v of vendor) {
    const o = oursById.get(v.id)
    if (o && !usedO.has(o)) { pairs.push([v, o]); usedV.add(v); usedO.add(o) }
  }
  const rest = alignNewest(vendor.filter((v) => !usedV.has(v)), ours.filter((o) => !usedO.has(o)))
  return { pairs: [...pairs, ...rest.pairs], unpairedVendor: rest.unpairedVendor, unpairedOurs: rest.unpairedOurs }
}

// ─── U13 (G1) — x, ON BOTH SIDES, AS A BAR OF THE CAPTURE'S WINDOW ──────────────────
//
// The common unit is `k`, the bar's position in the capture's own `bars.rows`
// (0 = its first bar; `rows.length + n - 1` = n bars past the last one, a future
// bar). The vendor's x is a position in the capture's x table (`objects.xIndex`,
// `tv_capture.js::readXIndex`), each entry a model bar index; ours is a bar of the
// bars our object lane ran on (`ourSide.js` `objects.xFrame`: the replayed
// prehistory, if any, then the window), placed by `xloc` exactly as the render
// state places it (`makeBarClock`: `bar_time` lands on the bar whose span holds it).
// ⛔ EITHER SIDE THAT CANNOT ANSWER SAYS WHY (`missing`), and the field is
// `xMissing`: never a guessed bar, never an agreement.

// ⭐ THE xmap SIDECAR (capture session S10, 2026-11-15). Before `tv_capture.js` recorded the
// table, the capture agent read `graphics()._indexes` at capture time into
// `<run>/xmap/<capture id>.json` (`firstBarIndex`, `lastBarIndex`, `indexes`, `times`,
// `barIndex = index - firstBarIndex`), verified against printed `bar_index` labels. The
// harness attaches it here (`harness.js::loadCapture`), BESIDE the capture, never into it (the
// capture's receipt covers its own bytes). The capture's own `objects.xIndex` wins.
const X_SIDECARS = new WeakMap()

/** The x table an xmap sidecar holds, in `objects.xIndex`'s shape, or `{found: false, reason}`. */
export function xIndexOfSidecar(sidecar, capture) {
  const bad = (reason) => ({ found: false, source: 'xmap-sidecar', reason })
  if (!sidecar || typeof sidecar !== 'object') return bad('the xmap sidecar is not an object')
  if (!capture || sidecar.id !== capture.id) return bad('the xmap sidecar names another capture')
  const { firstBarIndex: first, lastBarIndex: last, indexes, times, barIndex } = sidecar
  if (!Number.isInteger(first) || !Number.isInteger(last) || !Array.isArray(indexes) || !Array.isArray(times)
      || times.length !== indexes.length || !indexes.every(Number.isInteger)) return bad('the xmap sidecar is malformed')
  // its own arithmetic must hold: barIndex = index - firstBarIndex
  if (Array.isArray(barIndex) && !barIndex.every((b, j) => b === indexes[j] - first)) return bad('the xmap sidecar\'s barIndex disagrees with its indexes')
  const rows = (capture.bars && capture.bars.rows) || []
  if (rows.length && sidecar.firstBarTime !== undefined && sidecar.firstBarTime !== rows[0][0]) return bad('the xmap sidecar\'s first bar is not the capture\'s')
  return { found: true, source: 'xmap-sidecar', path: 'graphics()._indexes (xmap sidecar)', indexes, times,
    modelBars: { first, last, count: last - first + 1, contiguous: true } }
}

/** Attach a capture's xmap sidecar (test infrastructure; `harness.js::loadCapture`). */
export function attachXSidecar(capture, sidecar) {
  if (capture && typeof capture === 'object') X_SIDECARS.set(capture, xIndexOfSidecar(sidecar, capture))
  return capture
}

/** The x table the grade reads for this capture: its own, else its sidecar's, else undefined. */
export function xTableOf(capture) {
  const own = capture && capture.objects ? capture.objects.xIndex : undefined
  return own || (capture && typeof capture === 'object' ? X_SIDECARS.get(capture) : undefined)
}

/** The capture's x table → `at(x) → {bar} | {missing}`. */
export function vendorXResolver(capture) {
  const X = xTableOf(capture)
  const no = (missing) => ({ at: () => ({ missing }) })
  if (!X) return no('the capture records no x table (taken before U13)')
  if (X.found !== true) return no(`the capture's x table was not read (${X.ambiguous ? 'ambiguous' : (X.reason || 'not found')})`)
  const rows = (capture.bars && capture.bars.rows) || []
  const mb = X.modelBars
  if (!mb || mb.contiguous !== true || mb.count !== rows.length || !Array.isArray(X.indexes) || !Array.isArray(X.times)) {
    return no('the x table\'s model bars do not line up with the capture\'s bars')
  }
  return {
    at(x) {
      if (!Number.isInteger(x) || x < 0 || x >= X.indexes.length) return { missing: 'the vendor x is outside its x table' }
      // ⭐ S11 (inside-bar-setup, smart-money-concepts RDDT): TradingView files some objects at
      // timepoint -2000000, far below any model bar: an `na` x, or one off the loaded bars. Named.
      if (X.indexes[x] <= -1000000) return { missing: 'the vendor x is TradingView\'s off-chart timepoint (-2000000: an na x, or one off the loaded bars)' }
      const k = X.indexes[x] - mb.first
      if (!Number.isInteger(k) || k < 0) return { missing: 'the vendor x is before the first loaded bar' }
      // ⛔ the table's own time must be the bar's: a table that disagrees is not trusted
      if (k < rows.length && X.times[x] !== rows[k][0]) return { missing: 'the x table\'s time disagrees with the capture\'s bar' }
      return { bar: k }
    },
  }
}

/** Our object lane's bars → `at(value, xloc) → {bar} | {missing}`. */
export function ourXResolver(objects) {
  const F = objects ? objects.xFrame : undefined
  const no = (missing) => ({ at: () => ({ missing }) })
  if (!F || !Array.isArray(F.bars) || !Number.isInteger(F.windowStart)) return no('our side exposes no x frame')
  let clock = null
  let keyAt = null
  return {
    at(value, xloc) {
      const v = typeof value === 'number' ? value : (value === null || value === undefined || value === '' ? NaN : Number(value))
      if (!Number.isFinite(v)) return { missing: 'our x is na' }
      if (xloc === 'bar_time') {
        if (!clock) {
          clock = makeBarClock(F.bars, F.tf)
          keyAt = new Map(F.bars.map((b, i) => [String(b.t), i]))
        }
        const t = clock.timeAtInstant(v / 1000)
        const i = t === null || t === undefined ? undefined : keyAt.get(String(t))
        if (i === undefined) return { missing: 'our bar_time x is not on a loaded bar' }
        return { bar: i - F.windowStart }
      }
      return { bar: Math.round(v) - F.windowStart }
    },
  }
}

/** The colour our object is DRAWN in for a slot the script left unset. */
function colourDefault(D, ourFamily, field) {
  if (ourFamily === 'cell' && field === 'text_color') return D.cell.text_color || CELL_TEXT_DEFAULT
  return D[ourFamily] ? D[ourFamily][field] : undefined
}

/** One field of one paired record → its row. */
export function fieldRow(spec, ctx, v, p) {
  const { field, kind } = spec
  const raw = p ? p[spec.ours] : undefined
  if (kind === 'x') {
    const xloc = p && p.xloc !== undefined && p.xloc !== null ? p.xloc
      : (ctx.D[ctx.ourFamily] ? ctx.D[ctx.ourFamily].xloc : undefined)
    const vr = has(v, spec.vendor) ? ctx.vendorX.at(v[spec.vendor]) : { missing: 'the vendor record holds no x' }
    const or = ctx.ourX.at(raw, xloc)
    if (vr.missing || or.missing) {
      return { field, x: true, state: 'xMissing', why: vr.missing || or.missing, vendor: vr.bar ?? null, ours: or.bar ?? null }
    }
    return { field, x: true, state: vr.bar === or.bar ? 'agree' : 'differ', vendor: vr.bar, ours: or.bar }
  }
  if (kind === 'colour') {
    // ⛔ ONLY THE FIELDS THE CAPTURE HOLDS ARE GRADED: an absent colour key is
    // undecoded, never read as the na colour (review #1150 note 1).
    if (!has(v, spec.vendor)) return { field, state: 'undecoded', vendor: 'absent', ours: ourHex(raw) }
    const vendorInt = v[spec.vendor]
    const vendor = ctx.readVendorColour(vendorInt)
    if (isThemeColour(raw)) return { field, state: 'themeRelative', vendor, ours: String(raw) }
    if (vendor === null) return { field, state: 'undecoded', vendor: String(vendorInt), ours: ourHex(raw) }
    const carried = raw !== undefined && raw !== null
    const ours = ourHex(carried ? raw : colourDefault(ctx.D, ctx.ourFamily, spec.ours))
    return { field, state: ours !== null && coloursAgree(ours, vendor) ? 'agree' : 'differ', vendor, ours }
  }
  let vendor
  if (has(v, spec.vendor)) vendor = v[spec.vendor]
  else if (has(spec, 'vendorDefault')) vendor = spec.vendorDefault
  else return { field, state: 'undecoded', vendor: 'absent', ours: raw === undefined ? null : raw }
  // an unset property is compared as what is DRAWN: Pine's default where the table
  // states one, else the render state's own default (`objectDefaultsFor`)
  const drawnDefault = ctx.D[ctx.ourFamily] ? ctx.D[ctx.ourFamily][spec.ours] : undefined
  const ours = raw === undefined ? (has(spec, 'default') ? spec.default : drawnDefault) : raw
  if (kind === 'price') {
    return { field, state: valuesAgree(ours, vendor, ctx.tol) ? 'agree' : 'differ', vendor, ours: isNa(ours) ? null : ours }
  }
  if (kind === 'number') {
    const a = isNa(ours) ? null : Number(ours)
    const b = isNa(vendor) ? null : Number(vendor)
    return { field, state: a === b ? 'agree' : 'differ', vendor: b, ours: a }
  }
  if (kind === 'enum') {
    // ⭐ Engine 52 — a v6 INT text size (points) is served on the words' scale, but no
    // capture records a point size's pixels (`ts` / `sz` are words in every one): NOT graded,
    // never compared with a word (`objectCanvas.js::POINT_SIZE_ANCHORS`).
    if ((field === 'size' || field === 'text_size') && typeof ours === 'number') return { field, state: 'pointSize', vendor, ours }
    if (!has(spec.codes, String(vendor))) return { field, state: 'undecoded', vendor, ours: ours ?? null }
    const decoded = spec.codes[String(vendor)]
    return { field, state: decoded === ours ? 'agree' : 'differ', vendor: decoded, ours: ours ?? null }
  }
  if (kind === 'text') {
    const a = ours === undefined ? null : ours === null ? null : String(ours)
    const b = vendor === null || vendor === undefined ? '' : String(vendor)
    return { field, state: a === b ? 'agree' : 'differ', vendor: b, ours: a }
  }
  throw new Error(`objects v2: unknown field kind ${JSON.stringify(kind)}`)
}

/** Every field of one paired record. */
function recordRows(family, ctx, v, p, undrawn) {
  const spec = OBJECTS_V2_FIELDS[family]
  const rows = []
  const ourText = p && p.text !== undefined && p.text !== null ? String(p.text) : ''
  const vendorText = v && v.t !== undefined && v.t !== null ? String(v.t) : ''
  for (const f of spec.fields) {
    let row = fieldRow(f, ctx, v, p)
    if (f.onlyAtPrice) {
      const yl = (p && p.yloc) || 'price'
      if (yl !== 'price' || (has(v, 'yl') && v.yl !== 'pr')) row = { ...row, state: 'notApplicable' }
    }
    if (f.onlyWithText && !ourText && !vendorText) row = { ...row, state: 'notApplicable' }
    if (f.onlyIfVendor && !(Number(v[f.onlyIfVendor]) > 0)) row = { ...row, state: 'notApplicable' }
    // ⭐ C44 ruling, kept: an object drawn by NEITHER side shows a member nothing,
    // so nothing but its coordinates (which agree as `na` on both) is graded.
    // (x is a coordinate too, U13: graded on an undrawn pair like the prices)
    if (undrawn && f.kind !== 'price' && f.kind !== 'x' && row.state !== 'notApplicable') row = { ...row, state: 'undrawn', wouldBe: row.state }
    rows.push(row)
  }
  return rows
}

/**
 * Pair our live objects with the capture's records and read every field.
 * @param {object} capture   a v1 capture with `objects.records`
 * @param {object} objects   `ourSide.js`'s object report (`held` is the live set)
 * @returns {{families: Object<string, {pairs: object[], unpairedVendor: number, unpairedOurs: number}>}}
 */
export function pairRecords(capture, objects) {
  const R = (capture.objects && capture.objects.records) || {}
  const live = [...(objects.held || [])].sort(byId)
  const ctx = {
    tol: tolerancePolicy(capture),
    D: objectDefaultsFor(objects.pineVersion),
    readVendorColour: vendorColourReader(capture).read,
    vendorX: vendorXResolver(capture),
    ourX: ourXResolver(objects),
    vendorLineIdOfOurs: new Map(),
    ourFamily: null,
  }
  const families = {}
  // lines first: a linefill's references are graded against the line pairing
  for (const family of ['lines', 'labels', 'boxes']) {
    const spec = OBJECTS_V2_FIELDS[family]
    const vendor = [...(R[family] || [])].filter(Boolean).sort(byId)
    const ours = live.filter((o) => o && o.family === spec.ourFamily)
    ctx.ourFamily = spec.ourFamily
    // the score is the grade's own field rows: what differs and what agrees, x included
    const score = (v, o) => {
      const p = o.props || {}
      let differ = 0
      let agree = 0
      for (const r of recordRows(family, ctx, v, p, pairUndrawn(spec.ourFamily, p, v))) {
        if (r.state === 'differ') differ += 1
        else if (r.state === 'agree' || r.state === 'agreeByDefault' || r.state === 'themeRelative') agree += 1
      }
      return { differ, agree }
    }
    const { pairs, unpairedVendor, unpairedOurs, byValue } = alignByValue(vendor, ours, score)
    const rowsOf = ([v, o]) => {
      const p = o.props || {}
      return { vendorId: v.id, ourId: o.id, where: `${spec.ourFamily} #${o.id}`, fields: recordRows(family, ctx, v, p, pairUndrawn(spec.ourFamily, p, v)) }
    }
    if (family === 'lines') for (const [v, o] of pairs) ctx.vendorLineIdOfOurs.set(o.id, v.id)
    const graded = pairs.map(rowsOf)
    // ⭐ DIAGNOSTIC ONLY: does the difference vanish when equal ids pair first?
    // Then the two sides created the same drawings in a different ORDER (a label
    // TradingView re-created later), which the report says rather than hides.
    const differs = (list) => list.some((x) => x.fields.some((r) => r.state === 'differ'))
    let differsOnlyByCreationOrder = false
    if (differs(graded)) {
      const alt = alignById(vendor, ours)
      // a record one side lacks is a difference no re-ordering explains (review #1150 note 2)
      differsOnlyByCreationOrder = unpairedVendor === 0 && unpairedOurs === 0
        && alt.unpairedVendor === 0 && alt.unpairedOurs === 0
        && !differs(alt.pairs.map(rowsOf))
    }
    families[family] = { unpairedVendor, unpairedOurs, pairs: graded, differsOnlyByCreationOrder, ...(byValue ? { pairedByValue: true } : {}) }
  }
  {
    const spec = OBJECTS_V2_FIELDS.linefills
    const vendor = [...(R.linefills || [])].filter(Boolean).sort(byId)
    const ours = live.filter((o) => o && o.family === spec.ourFamily)
    // ⭐ A LINEFILL IS PAIRED BY ITS TWO LINES, not by creation order: Pine keeps
    // ONE fill per pair of lines (a new `linefill.new` on the same pair replaces
    // it), so the pair is the fill's identity, and the runtime re-creating a fill
    // TradingView kept would otherwise misalign every fill after it. Our lines go
    // through the line pairing (`{__ref: id}`, `objectRuntime.js::fillRefs`); a
    // fill whose pair has no vendor fill (or the reverse) is unpaired: a count
    // difference, said as one.
    const refOf = (r) => (r && typeof r === 'object' ? (r.__ref ?? r.id) : r)
    const keyOf = (x, y) => [x, y].map(String).sort().join('|')
    const usedV = new Set()
    const pairs = []
    let unpairedOurs = 0
    for (const o of ours) {
      const p = o.props || {}
      const a = ctx.vendorLineIdOfOurs.get(refOf(p.line1))
      const b = ctx.vendorLineIdOfOurs.get(refOf(p.line2))
      const v = a === undefined || b === undefined ? null
        : vendor.find((x) => !usedV.has(x) && keyOf(x.line1, x.line2) === keyOf(a, b))
      if (!v) { unpairedOurs += 1; continue }
      usedV.add(v)
      pairs.push([v, o])
    }
    ctx.ourFamily = spec.ourFamily
    families.linefills = {
      unpairedVendor: vendor.length - usedV.size,
      unpairedOurs,
      pairs: pairs.map(([v, o]) => ({ vendorId: v.id, ourId: o.id, where: `linefill #${o.id}`, fields: recordRows('linefills', ctx, v, o.props || {}, false) })),
    }
  }
  // tables by creation order, cells by (paired table, column, row)
  const vt = [...(R.tables || [])].filter(Boolean).sort(byId)
  const ot = live.filter((o) => o && o.family === 'table')
  const tp = alignNewest(vt, ot)
  ctx.ourFamily = 'table'
  families.tables = {
    unpairedVendor: tp.unpairedVendor,
    unpairedOurs: tp.unpairedOurs,
    pairs: tp.pairs.map(([v, o]) => ({ vendorId: v.id, ourId: o.id, where: `table #${o.id}`, fields: recordRows('tables', ctx, v, o.props || {}, false) })),
  }
  const vcells = [...(R.tableCells || [])].filter(Boolean)
  const cellPairs = []
  let unpairedOursCells = 0
  const usedCells = new Set()
  ctx.ourFamily = 'cell'
  for (const [v, o] of tp.pairs) {
    for (const c of o.cells || []) {
      const vc = vcells.find((x) => !usedCells.has(x) && x.tid === v.id && x.col === c.col && x.row === c.row)
      if (!vc) { unpairedOursCells += 1; continue }
      usedCells.add(vc)
      cellPairs.push({ vendorId: vc.id, ourId: `${o.id}:${c.col},${c.row}`, where: `cell (${c.col},${c.row}) of table #${o.id}`, fields: recordRows('tableCells', ctx, vc, c.props || {}, false) })
    }
  }
  const pairedTableIds = new Set(tp.pairs.map(([v]) => v.id))
  families.tableCells = {
    unpairedVendor: vcells.filter((x) => !usedCells.has(x) && pairedTableIds.has(x.tid)).length
      + vcells.filter((x) => !pairedTableIds.has(x.tid)).length,
    unpairedOurs: unpairedOursCells + ot.slice(0, tp.unpairedOurs).reduce((n, t) => n + (t.cells || []).length, 0),
    pairs: cellPairs,
  }
  for (const f of OBJECTS_V2_FAMILIES) if (!families[f]) families[f] = { pairs: [], unpairedVendor: 0, unpairedOurs: 0 }
  return { families }
}
