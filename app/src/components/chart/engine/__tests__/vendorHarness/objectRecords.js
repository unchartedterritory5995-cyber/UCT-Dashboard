// app/src/components/chart/engine/__tests__/vendorHarness/objectRecords.js
//
// ─── OBJECTS v2 — OUR LIVE OBJECTS PAIRED WITH THE CAPTURE'S RECORDS, FIELD BY FIELD ──
//
// Test infrastructure (like `objectColours.js`). v1 grades drawings by counts,
// texts and colours of objects paired BY VALUE; it never asks where a drawing
// is. This file pairs each of our live objects with the capture's record of the
// same family by CREATION ORDER and reads every field the capture holds, one row
// per field: `{field, state, vendor, ours}`.
//
// What a row's state MEANS for the grade, which fields exist, which vendor codes
// decode to what and which fields are not graded (and why) are said ONCE, in
// `tools/vendor_harness/compare.mjs` (`OBJECTS_V2_FIELDS`, `compareObjectsV2`).
// ⛔ Nothing here computes a drawing: our side is what `ourSide.js` (the member
// door) produced, the vendor side is the capture's own record.

import { objectDefaultsFor } from '../../objectRenderState'
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

/** The colour our object is DRAWN in for a slot the script left unset. */
function colourDefault(D, ourFamily, field) {
  if (ourFamily === 'cell' && field === 'text_color') return D.cell.text_color || CELL_TEXT_DEFAULT
  return D[ourFamily] ? D[ourFamily][field] : undefined
}

/** One field of one paired record → its row. */
function fieldRow(spec, ctx, v, p) {
  const { field, kind } = spec
  const raw = p ? p[spec.ours] : undefined
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
    if (undrawn && f.kind !== 'price' && row.state !== 'notApplicable') row = { ...row, state: 'undrawn', wouldBe: row.state }
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
    vendorLineIdOfOurs: new Map(),
    ourFamily: null,
  }
  const families = {}
  // lines first: a linefill's references are graded against the line pairing
  for (const family of ['lines', 'labels', 'boxes']) {
    const spec = OBJECTS_V2_FIELDS[family]
    const vendor = [...(R[family] || [])].filter(Boolean).sort(byId)
    const ours = live.filter((o) => o && o.family === spec.ourFamily)
    const { pairs, unpairedVendor, unpairedOurs } = alignNewest(vendor, ours)
    ctx.ourFamily = spec.ourFamily
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
    families[family] = { unpairedVendor, unpairedOurs, pairs: graded, differsOnlyByCreationOrder }
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
