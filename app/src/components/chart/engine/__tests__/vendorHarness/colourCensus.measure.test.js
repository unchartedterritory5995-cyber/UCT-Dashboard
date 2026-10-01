// app/src/components/chart/engine/__tests__/vendorHarness/colourCensus.measure.test.js
//
// ─── C37 — COLOUR, GRADED AS ITS OWN COLUMN (ruling R-G) ─────────────────────
//
// R-G: an uncarried plot colour keeps its line and is fixed by CARRYING the
// colour — and colour is graded as its own column so the defect stays counted.
// The harness's verdict already carried the PLOT half (`stats.colorCompared` /
// `colorMismatches`) and, until C44, no OBJECT half at all. ⭐ C44: the object
// half now JOINS the verdict (`compare.mjs::objectColourRows`, same pairing);
// this census stays as the per-slot tally behind it, for both:
//
//   plots    every plot whose VALUES agree with the vendor: bars whose colour
//            was compared and bars whose colour differs; and, per script, the
//            outputs whose colour this door did not carry at all (`colorDynamic`);
//   objects  every object PAIRED with a vendor record by value (a line's two
//            prices, a label's text and price, a box's two prices, a cell's
//            table / address / text) and, per colour slot, whether our colour
//            is the vendor's, differs although carried, or is not carried (the
//            renderer's default stands in for it).
//
// ⭐ THEME-RELATIVE. `chart.fg_color` / `chart.bg_color` are the chart's OWN
// colours: on TradingView the capture records TradingView's theme, on our chart
// the member's. A slot the script fills from one of them is carried as a theme
// reference (`objectTheme.js`) and counted `themeRelative` — neither agreeing
// nor mismatching, because the two charts are not the same colour by design.
// It is counted only where the script really reads the theme (the reference
// survives to the live object); nothing else can land in that column.
//
// ⛔ OPT-IN, and IT ASSERTS NO COUNT — a pinned mismatch count goes red on the
// progress it measures. It asserts only that it measured something.
//   cd app && PINE_COLOUR_CENSUS=1 PINE_COLOUR_CENSUS_OUT=<file.json> \
//     [PINE_COLOUR_CENSUS_DIR=<dir;dir>] VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1 \
//     npx vitest run src/components/chart/engine/__tests__/vendorHarness/colourCensus.measure.test.js

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './harness'
import { censusOf, totalsOf, walkCaptures, CELL_TEXT_DEFAULT } from './colourColumn'

const RUN = process.env.PINE_COLOUR_CENSUS === '1'
const OUT = process.env.PINE_COLOUR_CENSUS_OUT
const DIRS = process.env.PINE_COLOUR_CENSUS_DIR
  ? process.env.PINE_COLOUR_CENSUS_DIR.split(';').filter(Boolean).map((d) => path.resolve(process.cwd(), d))
  : [HARNESS_DIR]

describe.skipIf(!RUN)('C37 — the colour column over the captures on disk (opt-in)', () => {
  it('grades every plot colour and every paired object colour', () => {
    expect(OUT, 'PINE_COLOUR_CENSUS_OUT must name the output file').toBeTruthy()
    expect(CELL_TEXT_DEFAULT, 'the cell text default could not be read off objectTableDom.js').toMatch(/^#/)
    const files = [...new Set(DIRS.flatMap((d) => walkCaptures(d)))]
    expect(files.length).toBeGreaterThan(0)
    const rows = files.map(censusOf)
    const totals = totalsOf(rows)
    // ⛔ NON-VACUITY: a census that compared no bar and paired no object measured nothing.
    expect(totals.plots.barsCompared).toBeGreaterThan(0)
    expect(totals.objects.slots).toBeGreaterThan(0)
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/colourCensus.measure.test.js',
      dirs: DIRS.map((d) => path.relative(path.resolve(process.cwd(), '..'), d).replace(/\\/g, '/')),
      objectsOnlyFlag: process.env.VITE_PINE_OBJECTS_ONLY_PANE_ENABLED === '1',
      totals,
      rows,
    }, null, 1) + '\n')
    // eslint-disable-next-line no-console
    console.log(`colour census: ${JSON.stringify(totals)} -> ${OUT}`)
  }, 3600000)
})
