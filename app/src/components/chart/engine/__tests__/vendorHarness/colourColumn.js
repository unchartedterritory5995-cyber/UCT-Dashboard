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
// OBJECTS  every live object
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
//
// ⭐ C44 — the object half is no longer only a census: the SAME rows now decide
// the harness verdict (`harness.js::gradeCapture` pairs, `compare.mjs::
// objectColourRows` says what each state means). This file keeps the census
// (per-slot tallies over a directory); the pairing moved to `objectColours.js`.

import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { pairObjects } from './objectColours'

// ⭐ C44 — the pairing itself lives in `objectColours.js` (the harness verdict
// asks it too); it is re-exported so every caller of this file keeps its import.
export { pairObjects, vendorColourReader, CELL_TEXT_DEFAULT } from './objectColours'

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
      tally[k] = tally[k] || { agree: 0, agreeByDefault: 0, carriedDiffers: 0, notCarried: 0, themeRelative: 0, vendorUndecodable: 0, undrawn: 0 }
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
    objects: { slots: 0, agree: 0, agreeByDefault: 0, carriedDiffers: 0, notCarried: 0, themeRelative: 0, vendorUndecodable: 0, undrawn: 0 },
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
      for (const s of ['agree', 'agreeByDefault', 'carriedDiffers', 'notCarried', 'themeRelative', 'vendorUndecodable', 'undrawn']) {
        t.objects[s] += k[s]
        t.objects.slots += k[s]
      }
    }
  }
  return t
}

