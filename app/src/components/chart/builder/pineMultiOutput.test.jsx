// app/src/components/chart/builder/pineMultiOutput.test.jsx
//
// ─── ⭐⭐ C0.1/C0.2: ONE INDICATOR, MANY OUTPUTS ─────────────────────────────
//
// ⚰️ THIS DOOR HANDED BACK ONE COLUMN. A four-plot Pine indicator became four
// separate Apply actions into four unrelated builder rows, each losing every
// relationship to its siblings — and `buildDefinition` has ALWAYS been able to
// write a multi-tree document (`compute.trees`/`treesHash`/`scanPlot`/`sources`).
// Nothing ever handed it more than one tree.
//
// These fixtures are FIRST-PARTY and permanent: `tests/fixtures/pine_multiplot/`.
// Their whole job is to be the shapes a real indicator takes — two plots, three
// plots with different styles, plots plus levels, an overlay band set, and
// independently titled series.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../engine/ast/pine.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_multiplot')
// ⛔ NO existsSync GUARD — a fixture gate that passes with no fixtures is
// `lesson_gate_that_cannot_fail`.
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')
const out = (f) => translatePine(read(f), { paramManifest: true })
const usable = (o) => o.outputs.filter((r) => r.formula && !r.hidden && !r.refusal)

describe('the multi-plot fixtures are real and translate', () => {
  it('⭐ the corpus is really there', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5)
  })

  it('⛔ every fixture translates — a blocked fixture measures nothing', () => {
    const bad = FILES.map((f) => [f, out(f)]).filter(([, o]) => !o.ok)
      .map(([f, o]) => `${f}: ${o.refusal && o.refusal.guard}`)
    expect(bad).toEqual([])
  })

  it('⭐⭐ each declares MORE THAN ONE usable output — that is the point', () => {
    const counts = Object.fromEntries(FILES.map((f) => [f, usable(out(f)).length]))
    for (const [f, n] of Object.entries(counts)) {
      expect(n, `${f} offers ${n} column(s); this set exists to exercise many`).toBeGreaterThan(1)
    }
  })

  it('⭐ titles are independent and survive — not "value", "value 2"', () => {
    const o = out('05-independent-titles.pine')
    expect(usable(o).map((r) => r.title))
      .toEqual(['Momentum Fast', 'Momentum Slow', 'Range'])
  })

  it('⭐ per-output styling is per OUTPUT, not shared', () => {
    const rows = usable(out('02-three-plots-styles.pine'))
    expect(rows.map((r) => r.presentation.style)).toEqual(['line', 'stepline', 'histogram'])
    expect(rows.map((r) => r.presentation.width)).toEqual([2, 3, 1])
    expect(rows.map((r) => r.presentation.color))
      .toEqual(['#9C27B0', '#FF9800', '#2962FF'])
  })

  it('⭐ overlay vs pane is read per FIXTURE, and they differ', () => {
    expect(out('04-overlay-multi-plot.pine').presentation.overlay).toBe(true)
    expect(out('01-two-plots-pane.pine').presentation.overlay).toBe(false)
  })

  it('⭐ levels ride alongside the plots rather than replacing one', () => {
    const o = out('03-plots-with-hlines.pine')
    expect(usable(o)).toHaveLength(2)
    expect(o.presentation.levels.map((l) => l.value)).toEqual([70, 30])
  })

  it('⛔ ORDER IS THE SCRIPT`S ORDER — a set would lose it silently', () => {
    // Ordering is an acceptance condition (C0.2): a member reading three plots
    // must get them in the order the author wrote, or the legend lies.
    expect(usable(out('04-overlay-multi-plot.pine')).map((r) => r.title))
      .toEqual(['Basis', 'Upper', 'Lower'])
  })
})
