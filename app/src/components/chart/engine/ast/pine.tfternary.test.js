import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

/**
 * `res = useCurrentRes ? period : resCustom` — the MTF toggle idiom.
 *
 * ⚰️⚰️ `pine.security.test.js` RECORDED THIS AS UNWINNABLE IN THOSE WORDS: "a
 * TERNARY. No literal exists to fold to." Every clause is true and the conclusion
 * is still wrong, because nobody has to fold the ternary to a literal — the
 * CONDITION folds to a constant, and a constant condition names which branch the
 * script actually runs. `useCurrentRes = input(true, …)` is `true`, so `res` IS
 * `period`, which this door has read as the chart's own timeframe since the day
 * `tf` landed.
 *
 * ⭐ THE SAME WIDENING AS `ta.highestbars` AND THE DISPLACED PLOT, for the third
 * time in one file: a narrow true sentence about ONE mechanism ("no literal")
 * standing in for a claim about the WHOLE case ("cannot be resolved"). Two
 * community scripts were held by it, both of them by an author's default that
 * says use the current chart.
 *
 * ⛔ AND THE FOLD MUST READ THE CONDITION, NOT ASSUME A BRANCH. Every test below
 * that flips a default or blocks a fold is there because "always take `yes`"
 * passes the happy case and silently mistranslates the other one.
 */
describe('a timeframe chosen by a ternary', () => {
  const src = (body) => `//@version=4\nstudy("t")\n${body}\n`

  const treeOf = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const first = out.outputs.find((o) => o.refusal === null)
    expect(first, 'no output translated').toBeTruthy()
    return first.ast
  }

  // ─── the idiom, both ways round ────────────────────────────────────────────

  it('⭐⭐ a TRUE default takes `period` — the chart\'s own timeframe, so no tf node', () => {
    // What scripts 19 and 20 actually are: a wrapper that, at its shipped
    // defaults, reads this chart. Translating it as anything else would be
    // translating a script the author did not write.
    const ast = treeOf(translatePine(src(
      `useCurrentRes = input(true, title="Use Current Chart Resolution?")
resCustom = input(title="Other", type=resolution, defval="60")
res = useCurrentRes ? period : resCustom
plot(security(tickerid, res, sma(close, 10)))`)))
    expect(ast).toEqual({
      type: 'call', name: 'sma',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 10 }],
    })
  })

  it('⛔ a FALSE default takes the OTHER branch, and refuses on ITS timeframe', () => {
    // THE CONTROL THAT MAKES THE FOLD SAFE. An implementation that always took
    // `yes` would pass the test above and read this script — which asks for 60
    // minute bars — as the chart's own. That is a silent mistranslation of the
    // timeframe, the single thing this node exists to be exact about.
    const out = translatePine(src(
      `useCurrentRes = input(false, title="Use Current Chart Resolution?")
resCustom = input(title="Other", type=resolution, defval="60")
res = useCurrentRes ? period : resCustom
plot(security(tickerid, res, sma(close, 10)))`))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⭐ …and a FALSE default onto a timeframe we CAN serve becomes that tf node', () => {
    // The other half of the same control: taking the `no` branch is not a
    // synonym for refusing. Weekly is on the ladder today, so it translates.
    const ast = treeOf(translatePine(src(
      `useCurrent = input(false)
other = input(title="Other", type=resolution, defval="W")
res = useCurrent ? period : other
plot(security(tickerid, res, close))`)))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  // ─── what must NOT fold ────────────────────────────────────────────────────

  it('⛔ a condition that depends on the BARS refuses — a branch is not guessable', () => {
    // `close > open` is a different answer on every bar, so there is no single
    // timeframe this script reads. Picking either branch would be inventing one.
    const out = translatePine(src(
      `res = close > open ? period : "W"
plot(security(tickerid, res, close))`))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⛔ a LOCAL binding that shadows `period` reads as the timeframe it NAMES', () => {
    // The shadowing control, the same one `tickerid` needed and for the same
    // reason: recognising a built-in must never become "any variable with this
    // name is the chart's own". Bound to 'W' it is WEEKLY, and reading it as the
    // chart's timeframe would answer off the wrong bars entirely.
    const ast = treeOf(translatePine(src(
      `period = "W"
plot(security(tickerid, period, close))`)))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⛔ and a shadow onto a timeframe off the ladder still refuses', () => {
    // Proves the line above is not passing because shadowing is ignored: the
    // same shape with an unservable code must reach the refusal, not the chart.
    const out = translatePine(src(
      `period = "60"
plot(security(tickerid, period, close))`))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  // ─── the two scripts this is for ───────────────────────────────────────────

  it('⭐ the folded condition is REPORTED, so the member sees which branch ran', () => {
    // A fold that changes what a script means and says nothing is how a member
    // saves a scan that answers a question they did not ask.
    const out = translatePine(src(
      `useCurrentRes = input(true, title="Use Current Chart Resolution?")
resCustom = input(title="Other", type=resolution, defval="60")
res = useCurrentRes ? period : resCustom
plot(security(tickerid, res, close))`))
    const row = out.outputs.find((o) => o.refusal === null)
    const folded = (row.inputsFolded || []).map((f) => f.call)
    expect(folded).toContain('input')
  })
})
