// app/src/components/chart/engine/ast/htfNewestNarrow.test.js
//
// ─── ⭐⭐ HTF-NEWEST-NARROW (coordinator ruling 2026-11-19) — THE HOST LANE WITHHOLDS ONLY WHAT READS THE MERGE ON ITS ───
//     NEWEST BAR
//
// A `tf_merge` read (Pine's `request.security(..., 'W' | 'M')`, look-ahead off) cannot know the newest bar when that
// bar is finished and inside its period (`tfMergeMask`, `request:htf-newest-unconfirmed`). The bar was withheld for the
// plot's WHOLE tree, so `x[1]` (the bar before's merge, settled) was blank wherever `x` was: a wrong refusal. Now engine
// 56's dependency walk (`witnessMask`) decides, every merge a site unknown on its newest bar only. Pinned per shape, on
// twelve weekdays ending Tuesday 2026-11-17, closes 1..12 (a value names the bar whose close it is):
//   x                       withheld          x[1]                  10 (Monday 11-16 read the week of 11-13)
//   x[2]                    10                nz(x, 0)              withheld (x on the newest bar)
//   na(x) ? x[1] : x        withheld          sma(x, 3)             withheld (a window over x)
//   cum(x)                  withheld          close                 12 (reads no merge)
//   x[1] + close            22                a merge under a merge withheld (the whole-tree rule, kept)
// and the controls: a forming newest bar and a Friday (a week closed) draw every shape.
import { describe, it, expect } from 'vitest'
import { interpret, TF_MERGE, TF_MERGE_NEWEST_CODE } from './interpret'

const CLOSE = { type: 'series', name: 'close' }
const num = (value) => ({ type: 'num', value })
const merge = (code, arg = CLOSE) => ({ type: TF_MERGE, value: code, args: [arg] })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const X = merge('W')
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10',
  '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 100 }))
const newest = (tree, days, forming = false, sink) => {
  const col = interpret(tree, barsOn(days), {}, undefined, undefined,
    { tf: 'D', historyFromListing: true, newestBarIsForming: forming, ...(sink ? { chartClockSink: sink } : {}) })
  const v = col[days.length - 1]
  return Number.isFinite(v) ? v : null
}

const SHAPES = [
  ['x', X, null, 12],
  ['x[1]', off(1, X), 10, 10],
  ['x[2]', off(2, X), 10, 10],
  ['nz(x, 0)', call('nz', X, num(0)), null, 12],
  ['na(x) ? x[1] : x', op('?:', call('na', X), off(1, X), X), null, 12],
  ['sma(x, 3)', call('sma', X, num(3)), null, (10 + 10 + 12) / 3],
  ['close', CLOSE, 12, 12],
  ['x[1] + close', op('+', off(1, X), CLOSE), 22, 22],
]

describe('a finished newest bar inside its week: only a root that reads x on that bar is withheld', () => {
  for (const [name, tree, finished] of SHAPES) {
    it(`${name}: ${finished === null ? 'withheld' : finished}`, () => {
      expect(newest(tree, DAYS)).toBe(finished)
    })
  }
  it('cum(x): withheld (a running value carries x on the newest bar)', () => {
    expect(newest(call('cum', X), DAYS)).toBe(null)
  })
  it('the code is named only for a tree that withholds: x names it, x[1] does not', () => {
    const named = new Map()
    newest(X, DAYS, false, named)
    expect(named.has(TF_MERGE_NEWEST_CODE)).toBe(true)
    const quiet = new Map()
    newest(off(1, X), DAYS, false, quiet)
    expect(quiet.has(TF_MERGE_NEWEST_CODE)).toBe(false)
  })
  it('⛔ a merge under another merge keeps the whole-tree rule: its x[1] is still withheld', () => {
    const long = []
    for (let d = new Date('2026-06-01T00:00:00Z'); d.toISOString().slice(0, 10) <= '2026-11-17'; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) long.push(d.toISOString().slice(0, 10))
    }
    const nested = off(1, merge('W', merge('M')))
    const col = interpret(nested, barsOn(long), {}, undefined, undefined, { tf: 'D', historyFromListing: true })
    expect(Number.isFinite(col[long.length - 2])).toBe(true)          // CONTROL: the bar before is drawn
    expect(newest(nested, long)).toBe(null)
  })
})

describe('CONTROLS: a newest bar whose merge is known draws every shape', () => {
  for (const [name, tree, , forming] of SHAPES) {
    it(`forming (in session): ${name} = ${forming}`, () => {
      expect(newest(tree, DAYS, true)).toBeCloseTo(forming, 9)
    })
  }
  it('a Friday that closes its week: x = 10 and nz(x, 0) = 10', () => {
    const toFriday = DAYS.slice(0, 10)
    expect(newest(X, toFriday)).toBe(10)
    expect(newest(call('nz', X, num(0)), toFriday)).toBe(10)
  })
})
