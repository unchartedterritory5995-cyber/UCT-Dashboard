// app/src/components/chart/engine/__tests__/objectDivergedAfterState.test.js
//
// ─── ⭐ C12r — A LIST `statePass` DIVERGES IS DIVERGED FOR ITS READERS TOO ─────
//
// C14's open item (objects-triage § C14): `statePass` withholds a push it
// cannot carry and records the list in `divergedColls` — but it ran AFTER C16's
// diverged-collection pass, so the list's READS survived. Here the push of `a`
// reads `line.get_y1(a)` on a family that lost a create (`state:lost`), and the
// eviction `if array.size(ls) > 3 → line.delete(array.shift(ls))` then ran over
// a list missing its pushes: it would delete lines Pine keeps.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'

const SRC = `//@version=5
indicator("d", overlay=true)
var line[] ls = array.new<line>()
var line a = na
if close > open
    a := line.new(bar_index, high, bar_index + 1, high)
if high[bar_index % 7] > close
    line.new(bar_index, low, bar_index + 1, low)
if line.get_y1(a) > close
    array.push(ls, a)
if array.size(ls) > 3
    line.delete(array.shift(ls))
plot(close)
`

describe('C12r — reads of a list statePass diverged are withheld', () => {
  it('⛔ the eviction over the list is withheld by name and counted as a lost removal', () => {
    const t = translatePine(SRC)
    const d = t.objectDiagnostics
    expect(d.dropReasons['state:lost']).toBe(1)
    expect(d.dropReasons['coll:diverged']).toBe(2)
    expect(d.collsDiverged).toBe(1)
    expect(d.lostRemovals).toEqual([{ via: 'coll:diverged', family: 'line', reaches: true }])
    const kinds = t.objects.ops.map((o) => o.k)
    expect(kinds).not.toContain('delete')
    expect(kinds).not.toContain('collremove')
  })
})
