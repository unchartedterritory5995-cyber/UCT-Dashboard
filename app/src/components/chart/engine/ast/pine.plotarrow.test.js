import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

/**
 * `plotarrow(series)` is ONE column, and was filed with the four-column calls.
 *
 * ⚰️ IT SAT IN `CHART_ONLY_CALLS` beside `plotcandle` and `plotbar`, under a
 * comment reading "each needs more than one column to mean anything (`plotcandle`
 * takes four)". True of those two. Never true of this one: `plotarrow` takes a
 * single series and draws an up arrow where it is positive, a down arrow where it
 * is negative, nothing at zero or `na`.
 *
 * ⚰️⚰️ AND IT WAS HELD THERE BY A FALSE PREMISE THAT READ AS HUMILITY. The comment
 * justifying the whole family said "WHETHER `plotshape`/`hline`/`fill` YIELD A
 * COLUMN ON TRADINGVIEW IS UNDOCUMENTED — its docs group them under 'plots' but
 * the screener article names only the two." It is documented, and the article
 * names SEVEN: TradingView's "Pine Screener: key features and requirements" says
 * a screening filter needs at least one of `plot()`, `plotbar()`, `plotcandle()`,
 * `plotchar()`, `plotshape()`, `plotarrow()` or `hline()` — or an
 * `alertcondition()`. The sentence did not even describe the code beside it:
 * `plotshape` and `plotchar` were already being read as outputs.
 *
 * ⭐ A CLAIM OF IGNORANCE IS STILL A CLAIM, and this is the shape that survives
 * longest — nobody re-checks a comment that already admits it does not know.
 */
describe('plotarrow is an output', () => {
  const src = (body) => `//@version=5\nindicator("t")\n${body}\n`

  const only = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row
  }

  it('⭐ a script whose ONLY output is plotarrow now translates', () => {
    // Before: zero outputs collected, so `pine:no-output` — "the pasted script
    // offers no plot and no alert condition to filter on", said of a script whose
    // plot TradingView's own screener will filter on.
    const row = only(translatePine(src('plotarrow(close - open)')))
    expect(row.ast).toEqual({
      type: 'op', name: '-',
      args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }],
    })
  })

  it('⭐ …and it is the ARROW\'S OWN SERIES, not a direction we invented', () => {
    // ⛔ THE VALUE IS THE NUMBER THE AUTHOR COMPUTED. Its SIGN is what Pine draws
    // from, and it would have been easy to "helpfully" translate that into a
    // boolean or a ±1. A member screening on this filters their own series, which
    // is both what the plot is made of and what TradingView offers for it.
    const row = only(translatePine(src('d = ta.sma(close, 5) - ta.sma(close, 20)\nplotarrow(d)')))
    expect(row.formula).toBe('sma(close, 5) - sma(close, 20)')
  })

  it('⭐ it takes a named `series` argument too', () => {
    const row = only(translatePine(src('plotarrow(series = close - open)')))
    expect(row.ast.name).toBe('-')
  })

  // ─── the ones that genuinely DO need more than one column ─────────────────

  it('⛔ plotcandle still refuses — four series is a different problem', () => {
    // ⛔⛔ NOT FIXED BY THIS CHANGE, AND MUST NOT LOOK LIKE IT WAS. `plotcandle`
    // takes open, high, low and close; offering one of them under the script's
    // title is a quarter of a candle. It waits for the multi-column output shape.
    const out = translatePine(src('plotcandle(open, high, low, close)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:no-output')
  })

  it('⛔ and so does plotbar', () => {
    const out = translatePine(src('plotbar(open, high, low, close)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:no-output')
  })

  it('⛔ paint that TradingView does NOT list stays paint', () => {
    // The residue is now measured rather than assumed: `bgcolor`, `barcolor`,
    // `fill` and `alert` are absent from TradingView's seven, so a script offering
    // only those still has nothing a screen could read.
    for (const call of ['bgcolor(color.red)', 'barcolor(color.red)']) {
      const out = translatePine(src(call))
      expect(out.refusal, call).toBeTruthy()
      expect(out.refusal.guard, call).toBe('pine:no-output')
    }
  })
})
