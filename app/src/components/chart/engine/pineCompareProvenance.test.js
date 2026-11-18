// app/src/components/chart/engine/pineCompareProvenance.test.js
//
// ⭐⭐ engine 78 (#1858) — every TradingView reading in the shared vector table
// (`tests/fixtures/ast/pine_compare_vectors.json`, read by `pineCompare.test.js` AND `tests/test_pine_compare.py`)
// is the reading of a COMMITTED capture. A vector typed wrong, or a capture re-taken with a different answer, turns
// this red: the table is derived from the evidence, never a second authority beside it.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const H = '../tests/fixtures/vendor/harness'
const TABLE = JSON.parse(readFileSync('../tests/fixtures/ast/pine_compare_vectors.json', 'utf8'))
const caps = new Map()
const capture = (id) => {
  if (!caps.has(id)) caps.set(id, JSON.parse(readFileSync(`${H}/${id}.json`, 'utf8')))
  return caps.get(id)
}
const colOf = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  expect(plot, title).toBeTruthy()
  const at = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[at])
}
/** The one plot a vector row names (`T04 center 1e-13` -> `T04_center_1e-13`). */
const rowPlot = (cap, vectorId) => {
  const rid = vectorId.split(' ')[0]
  const hits = cap.study.plots.filter((p) => p.title.split('_')[0] === rid)
  expect(hits.map((p) => p.title), vectorId).toHaveLength(1)
  return hits[0].title
}

// Q-FCMP's rows encode one operator each (0 / 1), so each of its five vectors names the plot(s) and bar that hold it
const QFCMP = {
  'Q-FCMP F01/F02 (0.1+0.2) vs 0.3': { eq: ['F01_sum_eq_point3', -1] },
  'Q-FCMP F03/F04 1+3e-14 vs 1': { eq: ['F04_y_eq_x_3e-14', -1] },
  'Q-FCMP F11/F12 tie literals': { eq: ['F12_tie_literals_eq', -1] },
  'Q-FCMP SPY bar 5333 up vs down (F05-F07)': { bar: 5333 },
  'Q-FCMP SPY bar 5453 up vs down (F05-F07)': { bar: 5453 },
}

describe('the vector table is the committed captures\' readings', () => {
  it('every vector names a committed capture', () => {
    for (const v of TABLE.vectors) expect(existsSync(`${H}/${v.capture}.json`), v.capture).toBe(true)
    expect(TABLE.vectors.length).toBeGreaterThanOrEqual(122)
  })
  for (const v of TABLE.vectors) {
    it(v.id, () => {
      const cap = capture(v.capture)
      if (v.id.startsWith('Q-FCMP')) {
        const q = QFCMP[v.id]
        expect(q, v.id).toBeTruthy()
        if (q.eq) {
          const col = colOf(cap, q.eq[0])
          expect(col[col.length - 1]).toBe(v.eq)
          return
        }
        // the bar's operands are the capture's own up / down moves, and the three orderings its answer
        expect(colOf(cap, 'F09_up')[q.bar]).toBe(v.a)
        expect(colOf(cap, 'F10_down')[q.bar]).toBe(v.b)
        const gt = colOf(cap, 'F05_up_gt_down')[q.bar]
        const lt = colOf(cap, 'F06_up_lt_down')[q.bar]
        const eq = colOf(cap, 'F07_up_eq_down')[q.bar]
        expect(eq + 2 * (1 - eq) + 4 * lt + 8 * (lt || eq ? 1 : 0) + 16 * gt + 32 * (gt || eq ? 1 : 0)).toBe(v.code)
        return
      }
      const col = colOf(cap, rowPlot(cap, v.id))
      const last = col[col.length - 1]
      if ('code' in v) expect(last).toBe(v.code)
      else expect(last & 1).toBe(v.eq)
    })
  }
})
