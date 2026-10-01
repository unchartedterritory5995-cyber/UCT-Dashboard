// app/src/components/chart/engine/__tests__/vendorHarness/colourColumn.js
//
// ─── C37 — THE COLOUR COLUMN: one capture → its plot and object colour rows ────
//
// Test infrastructure (like `ourSide.js`): the pairing and the per-slot verdict
// that `colourCensus.measure.test.js` (the whole-directory census) and
// `vendorHarness.c37ObjectColours.test.js` / `c37Theme` (the rails) both ask.
// One reader, so the census and the rails cannot disagree about what "the
// colour agrees" means. ⛔ Nothing here computes a colour: our side is what
// `ourSide.js` (the member door) produced, the vendor side is the capture's own
// record.
//
// PLOTS    the harness verdict already carries the plot half
//          (`stats.colorCompared` / `colorMismatches`); it is copied out.
// OBJECTS  `compareObjects` reads counts and texts only. Here every live object
//          is PAIRED with a vendor record by value (a line's two prices, a
//          label's text and price, a box's two prices, a cell's table / address /
//          text) and each colour slot is one of:
//            agree            our colour is the vendor's
//            agreeByDefault   the script named none, and our default is the vendor's
//            carriedDiffers   we carry a colour and it is not the vendor's
//            notCarried       the script named one, we carry none, and the
//                             default that stands in for it is not the vendor's
//            themeRelative    the script reads `chart.fg_color` / `chart.bg_color`:
//                             carried as a theme reference (`objectTheme.js`) and
//                             NOT GRADED — the capture records TradingView's theme,
//                             our chart wears its own, by design
//            vendorUndecodable the capture's value is not a colour it can decode

import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
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
const near = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null)
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

export function walkCaptures(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkCaptures(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}

/** One capture file (or an already-loaded capture object) → its colour rows. */
export function censusOf(file) {
  const loaded = typeof file === 'string' ? loadCapture(file) : { capture: file }
  const name = typeof file === 'string' ? path.basename(file) : `${file.id}.json`
  if (!loaded.capture) return { file: name, skipped: loaded.reason || loaded.format }
  const { verdict, ours } = gradeCapture(loaded.capture)
  const row = { id: verdict.id, file: name, verdict: verdict.verdict, plots: [], objects: null }
  if (!ours || !ours.ok) return { ...row, refused: (ours && ours.refusal) || verdict.reason }
  // which plots' colour this door could not carry — the translator's own word
  // (`colorDynamic`), by output, whether or not the capture graded that plot
  const src = loaded.capture.source && loaded.capture.source.text
  const built = src ? memberPaneDefinition({ source: src, id: 'u_member-pane-colourcensus', name: 'census' }) : null
  row.uncarriedPlotColours = ((built && built.translation && built.translation.outputs) || [])
    .filter((o) => o && o.kind !== 'alertcondition' && o.presentation && o.presentation.colorDynamic)
    .map((o) => `${o.kind} ${JSON.stringify(o.title ?? null)}`)
  for (const p of verdict.plots || []) {
    const s = p.stats
    if (!s) continue
    row.plots.push({
      id: p.id, title: p.title ?? null, verdict: p.verdict,
      valuesAgree: (s.valueMismatches || 0) === 0 && (s.naMismatches || 0) === 0,
      colour: p.color,
      compared: s.colorCompared || 0,
      mismatches: s.colorMismatches || 0,
      first: s.firstDivergence && s.firstDivergence.kind === 'color'
        ? { vendor: s.firstDivergence.vendorColor, ours: s.firstDivergence.ourColor } : null,
    })
  }
  if (ours.objects && ours.objects.ok && loaded.capture.objects) {
    const { rows, unpaired, indexed } = pairObjects(loaded.capture, ours.objects)
    const tally = {}
    for (const r of rows) {
      const k = `${r.kind}.${r.slot}`
      tally[k] = tally[k] || { agree: 0, agreeByDefault: 0, carriedDiffers: 0, notCarried: 0, themeRelative: 0, vendorUndecodable: 0 }
      tally[k][r.state] += 1
    }
    row.objects = {
      slots: rows.length,
      vendorColours: indexed ? 'palette_common index' : 'packed 0xAABBGGRR',
      tally,
      unpaired,
      examples: rows.filter((r) => r.state === 'carriedDiffers' || r.state === 'notCarried' || r.state === 'themeRelative').slice(0, 60),
    }
    // every slot, for a rail that asserts on them — never serialised by the census
    Object.defineProperty(row.objects, 'rows', { value: rows, enumerable: false })
  }
  return row
}

export function totalsOf(rows) {
  const t = {
    captures: rows.length,
    plots: { valueAgreeing: 0, barsCompared: 0, barsMismatching: 0, plotsMismatching: 0, uncarried: 0 },
    objects: { slots: 0, agree: 0, agreeByDefault: 0, carriedDiffers: 0, notCarried: 0, themeRelative: 0, vendorUndecodable: 0 },
  }
  for (const r of rows) {
    for (const p of r.plots || []) {
      if (!p.valuesAgree) continue
      t.plots.valueAgreeing += 1
      t.plots.barsCompared += p.compared
      t.plots.barsMismatching += p.mismatches
      if (p.mismatches) t.plots.plotsMismatching += 1
    }
    t.plots.uncarried += (r.uncarriedPlotColours || []).length
    for (const k of Object.values((r.objects && r.objects.tally) || {})) {
      for (const s of ['agree', 'agreeByDefault', 'carriedDiffers', 'notCarried', 'themeRelative', 'vendorUndecodable']) {
        t.objects[s] += k[s]
        t.objects.slots += k[s]
      }
    }
  }
  return t
}

