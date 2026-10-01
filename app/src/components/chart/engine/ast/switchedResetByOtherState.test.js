// ─── ⭐⭐ C22 — A SWITCHED COUNTER WHOSE RESET READS ANOTHER `var` ─────────────
//
// trend-duration-forecast-chartprime counts the bars of the current trend:
//
//     var trend = bool(na)                       // itself `accum(…, … self …)`
//     if barstate.isconfirmed
//         if ta.rising(hma, 3)  trend := true
//         if ta.falling(hma, 3) trend := false
//     var TrendCount = 0
//     if trend or not trend
//         TrendCount += 1
//     if trend != trend[1]
//         TrendCount := 0
//
// C12s admits a counter with a RESET arm whose condition does not read the
// counter (`forgetsOnReset`). This one's condition reads `trend` — ANOTHER
// accumulator — and the gate walked into that accumulator's body, found ITS
// `self`, and refused the reset: `pine:state`, "a running total with no
// window". `self` is the nearest recurrence's (`interpret.js::structuralMaps`
// binds it that way); the gate now asks the same question
// (`containsFreeSelfSeries`, the manifest's own `recurrence.body` slot).
//
// These rails pin: the gate (admitted; the outer state's own reads still
// refuse), and EXACT — every published bar equals a Pine replay written here,
// from the first bar where the reset condition reads two real values (so the
// oracle never leans on what `na` compares as), both behind the curtain (the
// switched window: published only where a reset lies in the window) and from
// the listing (C12w).
import { describe, it, expect } from 'vitest'
import { translatePine, forgetsOnReset } from './pine.js'
import { interpret, switchedSeedOf } from './interpret.js'
import { TABLE } from './parse.js'

const N = 420
const W = 250
// Swings of a few dozen bars, so the direction flips well inside every window.
const CLOSE = Array.from({ length: N }, (_, i) => 100 + 12 * Math.sin(i / 9) + 3 * Math.sin(i / 2.3))
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }))
const LF = String.fromCharCode(10)
const pine = (lines) => ['//@version=5', 'indicator("c22")', ...lines].join(LF)
const SRC = pine([
  'var int dir = 0',
  'if close > close[1] + 1',
  '    dir := 1',
  'if close < close[1] - 1',
  '    dir := -1',
  'var int count = 0',
  'count += 1',
  'if dir != dir[1]',
  '    count := 0',
  'plot(count)',
])
const treeOf = (src) => {
  const t = translatePine(src)
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal).slice(0, 300)}`)
  return (t.outputs || []).find((o) => o && o.ast).ast
}
const run = (ast, opts) => Array.from(interpret(ast, BARS, {}, undefined, undefined, opts))
const outerAccum = (t) => (t && t.type === 'call' && t.name === 'accum' ? t : null)

/** Pine, bar by bar, from bar 0. `dir` holds its value between sets (seeded 0);
 *  `count` counts the bars since `dir` last changed. */
const reference = () => {
  const dir = []
  const count = []
  let d = 0
  let n = 0
  for (let i = 0; i < N; i += 1) {
    if (i > 0 && CLOSE[i] > CLOSE[i - 1] + 1) d = 1
    if (i > 0 && CLOSE[i] < CLOSE[i - 1] - 1) d = -1
    dir.push(d)
    n += 1
    if (i > 0 && d !== dir[i - 1]) n = 0
    count.push(n)
  }
  // the first bar the reset condition compares two real values AND fires
  const firstFlip = dir.findIndex((x, i) => i > 0 && x !== dir[i - 1])
  return { dir, count, firstFlip }
}

describe('⭐⭐ C22 — the gate: a reset whose condition reads another accumulator', () => {
  it('translates (was `pine:state`), and its seed carries the switched mark', () => {
    const acc = outerAccum(treeOf(SRC))
    expect(acc).not.toBeNull()
    expect(switchedSeedOf(acc.args[0])).toEqual({ type: 'num', value: 0 })
    // the reset condition holds the OTHER accumulator, whose body reads its own `self`
    const cond = acc.args[1].args[0]
    expect(JSON.stringify(cond)).toContain('"name":"accum"')
    expect(forgetsOnReset(acc.args[1], TABLE)).toBe(true)
  })

  const self = { type: 'series', name: 'self' }
  const close = { type: 'series', name: 'close' }
  const num = (value) => ({ type: 'num', value })
  const op = (name, ...args) => ({ type: 'op', name, args })
  const other = { type: 'call', name: 'accum', args: [num(0), op('?:', op('>', close, num(100)), num(1), self), num(W)] }
  const flip = op('!=', other, { type: 'offset', value: 1, args: [other] })

  it('⭐ the inner accumulator\'s `self` is ITS state, not this one\'s', () => {
    expect(forgetsOnReset(op('?:', flip, num(0), op('+', self, num(1))), TABLE)).toBe(true)
  })

  it('⭐ …and so is its HISTORY: `self[1]` inside the inner body is no lagged read of this state', () => {
    const lagged = { type: 'call', name: 'accum', args: [num(0),
      op('?:', op('>', close, num(100)), op('+', { type: 'offset', value: 1, args: [self] }, num(1)), self), num(W)] }
    const flip2 = op('!=', lagged, { type: 'offset', value: 1, args: [lagged] })
    expect(forgetsOnReset(op('?:', flip2, num(0), op('+', self, num(1))), TABLE)).toBe(true)
  })

  it.each([
    ['a condition that reads THIS state beside the other one', op('?:', op('&&', flip, op('>', self, num(3))), num(0), op('+', self, num(1)))],
    ['a lagged read of THIS state', op('?:', flip, num(0), op('+', { type: 'offset', value: 1, args: [self] }, num(1)))],
    ['no reset arm at all', op('+', self, other)],
  ])('⛔ still refuses: %s', (_name, body) => {
    expect(forgetsOnReset(body, TABLE)).toBe(false)
  })
})

describe('⭐⭐ C22 — exact: every published bar is Pine\'s', () => {
  const { count, firstFlip } = reference()

  it('behind the curtain (the switched window): published bars equal Pine, and only where a reset lies in the window', () => {
    const col = run(treeOf(SRC))
    expect(firstFlip).toBeGreaterThan(0)
    let published = 0
    for (let i = firstFlip; i < N; i += 1) {
      if (Number.isNaN(col[i])) continue
      published += 1
      expect(col[i], `bar ${i}`).toBe(count[i])
    }
    // non-vacuity: the switched window publishes a real stretch of the series
    expect(published).toBeGreaterThan(100)
    // nothing is published before a reset has been SEEN — and `dir` itself is
    // behind its own curtain until bar W, so no reset can be seen before it
    for (let i = 0; i <= W; i += 1) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
  })

  it('from the listing (C12w): every bar from the first flip on equals Pine', () => {
    const col = run(treeOf(SRC), { historyFromListing: true })
    for (let i = firstFlip; i < N; i += 1) expect(col[i], `bar ${i}`).toBe(count[i])
  })
})
