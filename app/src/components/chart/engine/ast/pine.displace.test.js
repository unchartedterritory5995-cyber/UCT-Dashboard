import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { lintRepaint } from './lint.js'

/**
 * `plot(x, offset = n)` — where a value is DRAWN versus what it IS.
 *
 * ⚰️⚰️ THIS DOOR REFUSED EVERY DISPLACED PLOT, AND THE REFUSAL WAS CONFLATING TWO
 * CLAIMS. Its sentence — "a displaced plot writes its value at a different bar
 * from the one that produced it" — is true about the DRAWING and false about the
 * COLUMN. A scan reads the TREE at the last confirmed bar; where the author chose
 * to paint that number changes nothing about what the number is.
 *
 * The cost of the old reading was four community scripts, two of them refused over
 * a line-hiding trick: `11-52-week-high-low` pairs `offset=-9999` with
 * `trackprice=true` so that only the horizontal track shows, and
 * `27-support-resistance-channels` uses `offset=-prd` to put a pivot label back on
 * the pivot bar. Neither displacement is a calculation.
 *
 * ⭐⭐ AND THE POSITIVE CASE TURNED OUT TO BE AN EXACT IDENTITY THIS TABLE ALREADY
 * HELD. `plot(x, offset = N)` shifts RIGHT, so the value standing at bar `j` is
 * bar `j-N`'s — which is `x[N]`, the `offset` node. Chart and scan then agree by
 * construction rather than by anyone remembering to shift one of them.
 */
describe('a displaced plot', () => {
  const src = (body) => `//@version=5\nindicator("t")\n${body}\n`

  const only = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row
  }

  const barsOf = (closes) => closes.map((c, i) => ({
    t: 20260801 + i, o: c, h: c, l: c, c, v: 1000,
  }))

  // ─── the positive case: an exact identity ─────────────────────────────────

  it('⭐⭐ a POSITIVE offset becomes a bar offset in the tree', () => {
    const row = only(translatePine(src('plot(close, offset = 2)')))
    expect(row.ast).toEqual({
      type: 'offset', value: 2, args: [{ type: 'series', name: 'close' }],
    })
    // …and nothing is left over for a renderer to shift a second time.
    expect(row.displace).toBe(0)
  })

  it('…and the VALUE it stands for is the one Pine would draw there', () => {
    // ⛔ THE ARITHMETIC, NOT THE SHAPE. Shifting a plot two bars right puts bar
    // i's value at bar i+2, so what stands at the last bar is two bars old. A
    // translation that produced `close` would draw a different line.
    const row = only(translatePine(src('plot(close, offset = 2)')))
    const col = interpret(row.ast, barsOf([10, 11, 12, 13, 14]))
    expect(col[4]).toBe(12)
  })

  it('⛔ and it does NOT read the future — the badge is unchanged', () => {
    // A bar offset steps BACKWARD. The whole reason the old refusal existed was
    // the fear of a forward reference arriving through a parameter; this asserts
    // the direction rather than trusting it.
    const row = only(translatePine(src('plot(close, offset = 5)')))
    expect(lintRepaint(row.ast).mode).toBe('non-repainting')
  })

  // ─── the negative case: presentation, not calculation ─────────────────────

  it('⭐ a NEGATIVE offset leaves the tree alone and is recorded as presentation', () => {
    // ⛔⛔ THE RULING. Shifting LEFT draws bar i's value at bar i−N, so the value
    // ON DISPLAY at bar j is bar j+N's — a FUTURE bar, and there is deliberately
    // no node for that. But the author's COMPUTED value at each bar is untouched,
    // so the honest translation is the undisplaced tree plus a record of where
    // they drew it.
    const row = only(translatePine(src('plot(close, offset = -3)')))
    expect(row.ast).toEqual({ type: 'series', name: 'close' })
    expect(row.displace).toBe(-3)
  })

  it('⛔⛔ …and the column is the AUTHOR\'S OWN NUMBER, bar for bar', () => {
    // THE CONTROL THAT MAKES THE RULING SAFE. If a negative displacement had been
    // folded into the tree as a shift, this column would be off by three bars —
    // a screen that answers about the wrong day, on every symbol, while looking
    // exactly like one that works.
    const row = only(translatePine(src('plot(sma(close, 2), offset = -3)')))
    const bars = barsOf([10, 20, 30, 40, 50])
    const displaced = interpret(row.ast, bars)
    const plain = interpret(only(translatePine(src('plot(sma(close, 2))'))).ast, bars)
    expect(Array.from(displaced)).toEqual(Array.from(plain))
  })

  it('⭐ a displacement written as an INPUT folds to its default', () => {
    // `offset = -prd` with `prd = input.int(10)` is how both remaining corpus
    // scripts spell it. Reading only a written literal would refuse the commonest
    // spelling in the wild — and refuse the idiom rather than the impossible thing.
    const row = only(translatePine(src('prd = input.int(10)\nplot(close, offset = -prd)')))
    expect(row.displace).toBe(-10)
  })

  // ─── what still refuses ───────────────────────────────────────────────────

  it('⛔ a displacement that depends on a COLUMN still refuses', () => {
    // A per-bar shift is neither a node nor a presentation constant, so there is
    // nothing honest to do with it.
    const out = translatePine(src('plot(close, offset = close > open ? 1 : 2)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:plot-offset')
  })

  it('⛔ …and so does one built from a series', () => {
    const out = translatePine(src('plot(close, offset = -close)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:plot-offset')
  })

  // ─── the two idioms this unblocked, in the wild ───────────────────────────

  it('⭐⭐ the 52-week-high idiom translates — a line-hiding trick is not a calculation', () => {
    // `trackprice = true` draws the horizontal line; `offset = -9999` hides the
    // plot's own line so only the track shows. Refusing a 52-week-high SCREEN
    // over that was the whole cost of reading the drawing as the column.
    const row = only(translatePine(src(
      'h = highest(high, 52)\nplot(h, trackprice = true, offset = -9999)')))
    expect(row.ast).toEqual({
      type: 'call', name: 'highest',
      args: [{ type: 'series', name: 'high' }, { type: 'num', value: 52 }],
    })
    expect(row.displace).toBe(-9999)
  })

  it('⭐ and a pivot label placed back on its pivot bar translates too', () => {
    const row = only(translatePine(src(
      'prd = input.int(10)\nph = pivothigh(high, prd, prd)\n'
      + 'plotshape(ph, location = location.abovebar, offset = -prd)')))
    expect(row.displace).toBe(-10)
    expect(row.ast.type).toBe('call')
    expect(row.ast.name).toBe('pivothigh')
  })
})
