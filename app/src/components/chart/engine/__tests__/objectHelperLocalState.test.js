// app/src/components/chart/engine/__tests__/objectHelperLocalState.test.js
//
// ─── C21 — WHAT A `pine:state` ON A FUNCTION'S OWN VARIABLE IS, AND WHICH LISTS DIVERGED ─
//
// `dual-view-htf-candlestick-patterns-theultimator5` (NYSE:RDDT 1D, 2026-09-28
// capture) refuses 78 object-pass trees `pine:state`. Measured by instrument:
// every one is ONE construct — a `var` declared inside the `for` of the helper
// `update_drawings` (`var float htf_o = na` … `htf_o := array.get(htf_open, i)`),
// ONE variable across the loop's passes and the bars. The refusal's sentence
// opened with the running-total clause ("what this one needs is a running total
// with no window"), false of it; `guardRefusals` named no subject at all. And its
// 39 `coll:diverged` withheld reads of ten lists whose pushes were lost — the
// count named none of them.
//
// ⭐ NOW: a helper's mutable local says what it is (`HELPER_LOCAL_CLAUSE`, a
// `var` carried in a loop vs a local reassigned as the function runs), the guard
// refusal names it, and `collsDivergedWhy` names the first change each list lost.
// Diagnostics only — every drop, its key and its class are as they were.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../ast/pine'

const HEAD = '//@version=6\nindicator("h", overlay=true)\n'

describe('C21 — a helper\'s own mutable local is named for what it is', () => {
  it('⭐ a `var` carried in a loop of the helper', () => {
    const t = translatePine(`${HEAD}var box b = box.new(bar_index, high, bar_index + 1, low)
upd() =>
    for i = 0 to 1
        var float v = na
        if close > open
            v := close
        if not na(v)
            box.set_top(b, v)
upd()
plot(close)
`)
    expect(t.objectDiagnostics.guardRefusals).toEqual([
      'update@10: pine:state `v` (a `var` carried in a loop of `upd`)',
    ])
  })

  // ⭐ C22 — a chain that only assigns a plain local a value is now read as
  // that value (`foldLocalChain`: `v` IS `close > open ? close : na` here), so
  // the refusal is named on a chain that reads what it assigns.
  it('⭐ a plain local the helper reassigns', () => {
    const t = translatePine(`${HEAD}var box b = box.new(bar_index, high, bar_index + 1, low)
upd() =>
    float v = na
    if close > open
        v := v + close
    if not na(v)
        box.set_top(b, v)
upd()
plot(close)
`)
    const g = t.objectDiagnostics.guardRefusals || []
    expect(g.every((e) => /pine:state `v` \(reassigned inside `upd`\)$/.test(e)), JSON.stringify(g)).toBe(true)
    expect(g.length).toBeGreaterThan(0)
  })

  it('⛔ CONTROL — a helper local read right after its own `:=` resolves, and names nothing', () => {
    const t = translatePine(`${HEAD}var box b = box.new(bar_index, high, bar_index + 1, low)
upd() =>
    float v = na
    v := close
    box.set_top(b, v)
upd()
plot(close)
`)
    expect(t.objectDiagnostics.guardRefusals).toBeUndefined()
  })
})

describe('C21 — `collsDivergedWhy` names the first change each diverged list lost', () => {
  it('⭐ a list edit the reader does not carry (`array.insert`)', () => {
    const t = translatePine(`${HEAD}var array<label> ls = array.new<label>()
if close > open
    array.insert(ls, 0, label.new(bar_index, high, "x"))
if array.size(ls) > 5
    label.delete(array.shift(ls))
plot(close)
`)
    const d = t.objectDiagnostics
    expect(d.collsDiverged).toBe(1)
    expect(d.collsDivergedWhy).toEqual(['ls: coll:insert@5'])
  })

  it('⭐ dual-view: ten lists, each with the change it lost; the 78 are one construct', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..',
      'corpus/committed/dual-view-htf-candlestick-patterns-theultimator5__e0385fb61b.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    const d = t.objectDiagnostics
    expect(d.collsDivergedWhy).toEqual([
      'candle_bodies: coll:push@412',
      'historical_candle_boxes: loop:bounds@771',
      'historical_candle_lower_wicks: loop:bounds@778',
      'historical_candle_upper_wicks: loop:bounds@777',
      'historical_pattern_labels: loop:bounds@802',
      'horizontal_high_lines: coll:push@425',
      'horizontal_low_lines: coll:push@430',
      'lower_wicks: coll:push@421',
      'pattern_labels: guard:loop@906',
      'upper_wicks: coll:push@417',
    ])
    const state = (d.guardRefusals || []).filter((e) => /pine:state/.test(e))
    expect(state.length).toBeGreaterThan(0)
    expect(state.every((e) => /\(a `var` carried in a loop of `update_drawings`\)$/.test(e)), JSON.stringify(state))
      .toBe(true)
  })
})
