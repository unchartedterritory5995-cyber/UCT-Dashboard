// app/src/components/chart/engine/__tests__/vendorHarness/objectColours.js
//
// ─── C37 / C44 — AN OBJECT'S COLOURS, PAIRED WITH THE CAPTURE'S OWN RECORD ────
//
// Test infrastructure (like `ourSide.js`). The pairing and the per-slot reading
// C37 wrote for its census (`colourColumn.js`), moved here UNCHANGED by C44 so
// that the harness verdict (`harness.js::gradeCapture`) can ask it without the
// two files importing each other. One reader: the census, C37's rails and the
// verdict cannot disagree about what "the colour agrees" means.
//
// ⛔ Nothing here computes a colour: our side is what `ourSide.js` (the member
// door) produced, the vendor side is the capture's own record.
//
// Every live object is PAIRED with a vendor record by value (a line's two
// prices, a label's text and price, a box's two prices, a cell's table /
// address / text) and each colour slot is one of:
//   agree             our colour is the vendor's
//   agreeByDefault    the script named none, and our default is the vendor's
//   carriedDiffers    we carry a colour and it is not the vendor's
//   notCarried        the script named one, we carry none, and the default that
//                     stands in for it is not the vendor's
//   themeRelative     the script reads `chart.fg_color` / `chart.bg_color`:
//                     carried as a theme reference (`objectTheme.js`) and NOT
//                     compared with the capture's colour — the capture records
//                     TradingView's theme, our chart wears its own, by design
//   vendorUndecodable the capture's value is not a colour it can decode
//
// What the VERDICT does with those states is said once, in
// `tools/vendor_harness/compare.mjs::objectColourRows`.

import fs from 'node:fs'
import path from 'node:path'

import { objectDefaultsFor } from '../../objectRenderState'
import { isThemeColour } from '../../objectTheme'
import {
  normalizeColor, coloursAgree, decodePackedColour, NO_COLOUR,
} from '../../../../../../../tools/vendor_harness/compare.mjs'

/** The table cell's text colour when the script gave none: the renderer's own
 *  (`objectTableDom.js`). Read off that file rather than typed. */
const TABLE_DOM_SRC = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/objectTableDom.js'), 'utf8')
export const CELL_TEXT_DEFAULT = (TABLE_DOM_SRC.match(/cell\.text_color\)?[^'\n]*\|\|\s*'(#[0-9A-Fa-f]{6})'/) || [])[1] || null

/** ⭐⭐ A VENDOR OBJECT COLOUR IS ONE OF TWO THINGS, AND THE CAPTURE SAYS WHICH.
 *  Where the compiler could enumerate a study's colours it hands every drawing a
 *  palette INDEX into `palette_common` (liquidity-pools: `lines.ci = 2` →
 *  `rgba(14,243,14,0.35)`); where a colour is an expression the record holds the
 *  packed 0xAABBGGRR itself (artemis: 0xcc...). Exactly the plot colorer's two
 *  shapes (`compare.mjs::vendorColorsFor`). ⚰️ Read as packed, an index is a
 *  near-black at alpha 0 and EVERY slot of 22 of the 47 captures "differed" —
 *  1,316 manufactured mismatches on the first run of this census.
 *  `null` (the record's own) is the `na` colour; a value the palette does not
 *  hold is undecodable (`null` here), never guessed. */
export function vendorColourReader(capture) {
  const st = capture.study || {}
  const state = st.paletteState && st.paletteState.palette_common
  const meta = st.palettes && st.palettes.palette_common
  const table = (state && state.colors) || (meta && meta.colors) || null
  const valToIndex = (meta && meta.valToIndex) || null
  if (!table) return { indexed: false, read: (n) => (n === null || n === undefined ? NO_COLOUR : decodePackedColour(Number(n))) }
  return {
    indexed: true,
    read: (n) => {
      if (n === null || n === undefined) return NO_COLOUR
      const idx = valToIndex && Object.prototype.hasOwnProperty.call(valToIndex, String(n)) ? valToIndex[String(n)] : n
      const c = table[String(idx)]
      return normalizeColor(c && typeof c === 'object' ? c.color : c)
    },
  }
}
const ourHex = (c) => {
  if (c === undefined || c === null || c === 'transparent') return NO_COLOUR
  return normalizeColor(String(c))
}
/** ⭐ C44 — `na` IS ONE VALUE, HOWEVER IT IS SPELLED. The capture records an `na`
 *  coordinate as `null`; our runtime holds it as `NaN` (or leaves it unset).
 *  ⚰️ Until C44 a `NaN` fell through to the finite test and paired with nothing,
 *  so every object both sides hold at an `na` price went UNPAIRED and its colours
 *  were never read: all 504 boxes of multi-timeframe-supply-demand, 51 lines of
 *  ultimate-pivot-points, 48 boxes of contraction-box (measured at `e4e24524ef`).
 *  Harmless in a census; in a VERDICT it is a family graded MATCH on colour with
 *  no colour compared. An `na` pairs with an `na`, and with nothing else. */
const isNa = (x) => x === null || x === undefined || (typeof x === 'number' && Number.isNaN(x))
const near = (a, b) => {
  if (isNa(a) || isNa(b)) return isNa(a) && isNa(b)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
}

/** One colour slot of one paired object → its row in the column. */
function slotRowOf(vendorHex, kind, slot, raw, fallback, vendorInt, where) {
  const vendor = vendorHex(vendorInt)
  if (isThemeColour(raw)) return { kind, slot, state: 'themeRelative', vendor, ours: String(raw), where }
  if (vendor === null) return { kind, slot, state: 'vendorUndecodable', vendor: String(vendorInt), ours: ourHex(raw), where }
  const carried = raw !== undefined && raw !== null
  const ours = ourHex(carried ? raw : fallback)
  if (ours !== null && vendor !== null && coloursAgree(ours, vendor)) {
    return { kind, slot, state: carried ? 'agree' : 'agreeByDefault', vendor, ours, where }
  }
  return { kind, slot, state: carried ? 'carriedDiffers' : 'notCarried', vendor, ours, where }
}

/** Pair our live objects with the capture's records, by value and in creation
 *  order (an id that agrees AND carries the same values is preferred). */
export function pairObjects(capture, objects) {
  const rows = []
  const unpaired = { ours: 0, vendor: 0 }
  const R = (capture.objects && capture.objects.records) || {}
  const live = [...(objects.held || [])].sort((a, b) => a.id - b.id)
  const take = (pool, used, id, same) => {
    let hit = pool.find((v) => !used.has(v) && v.id === id && same(v))
    if (!hit) hit = pool.find((v) => !used.has(v) && same(v))
    if (hit) used.add(hit)
    return hit || null
  }
  const used = new Set()
  // the defaults an uncoloured object is DRAWN in — the render state's own, at
  // the program's Pine version (`objectDefaults.js`), never a copy typed here
  const D = objectDefaultsFor(objects.pineVersion)
  const reader = vendorColourReader(capture)
  const slotRow = (...a) => slotRowOf(reader.read, ...a)
  for (const o of live) {
    const p = o.props || {}
    if (o.family === 'line') {
      const v = take(R.lines || [], used, o.id, (x) => near(p.y1, x.y1) && near(p.y2, x.y2))
      if (!v) { unpaired.ours += 1; continue }
      rows.push(slotRow('line', 'color', p.color, D.line.color, v.ci, `line #${o.id}`))
    } else if (o.family === 'label') {
      const text = p.text === undefined || p.text === null ? '' : String(p.text)
      const v = take(R.labels || [], used, o.id, (x) => String(x.t ?? '') === text && near(p.y ?? null, x.y ?? null))
      if (!v) { unpaired.ours += 1; continue }
      rows.push(slotRow('label', 'color', p.color, D.label.color, v.ci, `label #${o.id} ${JSON.stringify(text.slice(0, 24))}`))
      if (text) rows.push(slotRow('label', 'textcolor', p.textcolor, D.label.textcolor, v.tci, `label #${o.id} ${JSON.stringify(text.slice(0, 24))}`))
    } else if (o.family === 'box') {
      const v = take(R.boxes || [], used, o.id, (x) => near(p.top, x.y1) && near(p.bottom, x.y2))
      if (!v) { unpaired.ours += 1; continue }
      rows.push(slotRow('box', 'border_color', p.border_color, D.box.border_color, v.c, `box #${o.id}`))
      rows.push(slotRow('box', 'bgcolor', p.bgcolor, D.box.bgcolor, v.bc, `box #${o.id}`))
      if (v.t && p.text) rows.push(slotRow('box', 'text_color', p.text_color, D.box.text_color, v.tc, `box #${o.id}`))
    }
  }
  for (const f of ['lines', 'labels', 'boxes']) unpaired.vendor += (R[f] || []).filter((v) => !used.has(v)).length

  // tables by position, cells by address + text
  const usedT = new Set()
  const vcells = R.tableCells || []
  const usedC = new Set()
  for (const t of live.filter((o) => o.family === 'table')) {
    const p = t.props || {}
    const position = p.position || D.table.position
    const v = (R.tables || []).find((x) => !usedT.has(x) && x.pos === position)
    if (!v) { unpaired.ours += 1; continue }
    usedT.add(v)
    rows.push(slotRow('table', 'bgcolor', p.bgcolor, D.table.bgcolor, v.bgc, `table ${position}`))
    if (v.frmw > 0) rows.push(slotRow('table', 'frame_color', p.frame_color, undefined, v.frmc, `table ${position}`))
    if (v.brdw > 0) rows.push(slotRow('table', 'border_color', p.border_color, undefined, v.brdc, `table ${position}`))
    for (const c of t.cells || []) {
      const cp = c.props || {}
      if (cp.text === null) continue // a withheld text: the cell is not drawn
      const text = cp.text === undefined ? '' : String(cp.text)
      const vc = vcells.find((x) => !usedC.has(x) && x.tid === v.id && x.col === c.col && x.row === c.row && String(x.t ?? '') === text)
      if (!vc) { unpaired.ours += 1; continue }
      usedC.add(vc)
      const where = `cell (${c.col},${c.row}) ${JSON.stringify(text.slice(0, 24))}`
      if (text) rows.push(slotRow('cell', 'text_color', cp.text_color, D.cell.text_color || CELL_TEXT_DEFAULT, vc.tc, where))
      rows.push(slotRow('cell', 'bgcolor', cp.bgcolor, undefined, vc.bgc, where))
    }
  }
  unpaired.vendor += (R.tables || []).filter((v) => !usedT.has(v)).length + vcells.filter((v) => !usedC.has(v)).length
  return { rows, unpaired, indexed: reader.indexed }
}
