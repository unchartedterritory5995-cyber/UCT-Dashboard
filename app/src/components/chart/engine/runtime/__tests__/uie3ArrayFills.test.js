// app/src/components/chart/engine/runtime/__tests__/uie3ArrayFills.test.js
//
// ⭐⭐ UIE PHASE 3 (M5) — two sized-array fills that blocked real scripts, served without a
// guess (`collections.js`):
//   * an UNMEASURED fill (`array.new_color(n)`, bool, string) is held UNREAD — the array
//     is served, and reading a filled slot stops by name. linear-regression-channel's
//     shape (size 2, two colours unshifted in front, only 0 and 1 read) computes;
//   * a sized DRAWING array in a run that owns its drawings holds Pine's `na` handle.
import { describe, it, expect } from 'vitest'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { runtimeObjectsOf } from '../runtimeObjects.js'

const bars = Array.from({ length: 60 }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 4)
  return { t: 1600000000 + i * 86400, o: c - 0.2, h: c + 1, l: c - 1, c, v: 1000 }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const doc = (body, objects = false) => ({
  id: 'f', compute: { kind: 'runtime', fn: 'runtime:f', outputs: { v: 0 }, ...(objects ? { objects: true } : {}),
    source: `//@version=5\nindicator("f", overlay = true)\n${body}` },
})
const run = (body, objects) => computeRuntimeColumns(doc(body, objects), bars, CTX)

describe('⭐ an unmeasured fill is held unread', () => {
  const LR = 'var colors = array.new_color(2)\nif barstate.isfirst\n    array.unshift(colors, color.lime)\n'
    + '    array.unshift(colors, color.red)\n'
  it("linear-regression's shape: the colours it put in front are read; the fill behind is never looked at", () => {
    const out = run(`${LR}float s = 0.0\nfor i = 0 to 2\n    s += close[i]\nplot(s, color = array.get(colors, close > open ? 1 : 0))\nplot(array.size(colors))\n`)
    expect(out.v.slice(2).every((x) => Number.isFinite(x))).toBe(true)   // a 3-bar sum, so from bar 2
  })
  it('⛔ reading the fill stops by name — get, first/last, compare, reduce', () => {
    for (const read of ['array.get(colors, 3)', 'array.last(colors)', 'array.indexof(colors, color.red)']) {
      expect(() => run(`${LR}c = ${read}\nfloat s = 0.0\nfor i = 0 to 2\n    s += close[i]\nplot(s, color = c == color.red ? color.red : color.blue)\n`),
        read).toThrow(/has not been measured/)
    }
  })
})

describe('⭐ a sized drawing array holds `na` handles in a run that owns its drawings', () => {
  const LINES = 'var ls = array.new_line(3)\nfor x = 0 to 2\n    line.delete(array.get(ls, x))\n'
    + '    array.set(ls, x, line.new(bar_index - 5, close - x, bar_index, close + x))\n'
    + 'float s = 0.0\nfor i = 0 to 2\n    s += close[i]\nplot(s)\n'
  it("deleting an unset slot does nothing; the newest three lines are live (linear-regression's loop)", () => {
    const cols = run(LINES, true)
    const live = runtimeObjectsOf(cols).live.filter((o) => o.family === 'line')
    expect(live).toHaveLength(3)
    expect(live.map((o) => o.props.x2)).toEqual([59, 59, 59])
  })
  it('na() of an unset slot is true, of a drawn one false', () => {
    const cols = run('var ls = array.new_line(2)\nif barstate.isfirst\n    array.set(ls, 0, line.new(0, close, 1, close))\n'
      + 'plot(na(array.get(ls, 1)) ? 1 : 0)\nplot(na(array.get(ls, 0)) ? 1 : 0)\n', true)
    expect(cols.v.every((x) => x === 1)).toBe(true)
  })
})
