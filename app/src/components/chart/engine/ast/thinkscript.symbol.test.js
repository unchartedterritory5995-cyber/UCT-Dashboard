import { describe, it, expect } from 'vitest'

import { translateThinkScript } from './thinkscript.js'

/**
 * `close(symbol = "SPY")` → the `sym` node this engine already ships.
 *
 * ⚰️ THIS DOOR REFUSED IT WITH A SENTENCE THAT WAS FALSE ABOUT THE ENGINE: "a
 * comparison against a benchmark needs a second column, not a second symbol
 * inside this one". A second symbol inside one column is precisely what `sym`
 * IS — the Pine door has emitted it since the node landed, and the scan gate
 * already limits it to the benchmark roster.
 *
 * ⭐ THE WHITELIST IS NOT THIS DOOR'S JOB, and that is deliberate rather than
 * lax. `pine.js` validates only the ticker's SHAPE and lets `assert_scannable`
 * decide whether the roster allows it — one authority, asked once, at the gate
 * that owns the answer. This door does the same, so the two dialects cannot
 * disagree about which benchmarks are allowed.
 */
describe('another symbol inside one column', () => {
  const only = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = (out.outputs || []).find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row
  }

  it('⭐⭐ a literal symbol becomes a `sym` node wrapping the bar field', () => {
    const row = only(translateThinkScript('plot x = close(symbol = "SPY");\n'))
    expect(row.ast).toEqual({
      type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }],
    })
  })

  it('⭐⭐ …and so does one reached through an INPUT, folded to its default', () => {
    // `input benchmark = "SPY"` is how `08-relative-strength-zscore-vs-spy`
    // actually writes it, and the fold is already recorded in `folded` so the
    // member is told which value was frozen.
    const out = translateThinkScript(
      'input benchmark = "SPY";\nplot x = close(symbol = benchmark);\n')
    expect(only(out).ast).toEqual({
      type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }],
    })
    expect((out.folded || []).some((f) => f.folded === 'SPY')).toBe(true)
  })

  it('⭐ the WRAPPED FIELD is the one asked for, not always close', () => {
    // ⛔ THE CONTROL THAT CATCHES A HARD-CODED CHILD. `high(symbol = …)` reading
    // `close` would be a silent mistranslation of exactly the kind this engine
    // exists to refuse, and every assertion above would still pass.
    expect(only(translateThinkScript('plot x = high(symbol = "QQQ");\n')).ast).toEqual({
      type: 'sym', value: 'QQQ', args: [{ type: 'series', name: 'high' }],
    })
  })

  it('⭐ it composes — a ratio against the benchmark is one column', () => {
    // What the corpus script is actually for.
    const row = only(translateThinkScript('plot rs = close / close(symbol = "SPY");\n'))
    expect(row.ast).toEqual({
      type: 'op', name: '/', args: [
        { type: 'series', name: 'close' },
        { type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }] },
      ],
    })
  })

  // ─── what must still refuse ───────────────────────────────────────────────

  it('⛔ a symbol that does not fold to a literal still refuses', () => {
    // A computed symbol is not knowable at translation time, and guessing one
    // would read another instrument entirely.
    const out = translateThinkScript(
      'def s = if close > open then "SPY" else "QQQ";\nplot x = close(symbol = s);\n')
    expect(out.refusal).toBeTruthy()
  })

  it('⛔ an AGGREGATION argument is a different question and still refuses', () => {
    // ⛔ SCOPE. This change is about `symbol` only. `period` asks for another
    // TIMEFRAME, which is `tf`, and folding an `AggregationPeriod` enum onto the
    // servable ladder is its own piece of work with its own evidence.
    const out = translateThinkScript('plot x = close(period = AggregationPeriod.WEEK);\n')
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('thinkscript:aggregation')
  })

  it('⛔ and the ROSTER is still the scan gate\'s decision, not this door\'s', () => {
    // A ticker nobody whitelisted TRANSLATES here and is refused later, by the
    // one authority that owns the roster. If this door started policing it, the
    // two dialects would each carry an opinion and they would drift.
    const row = only(translateThinkScript('plot x = close(symbol = "ZZZZ");\n'))
    expect(row.ast.type).toBe('sym')
    expect(row.ast.value).toBe('ZZZZ')
  })
})
