import { describe, it, expect } from 'vitest'

import { translateThinkScript } from './thinkscript.js'

/**
 * `close(period = AggregationPeriod.WEEK)` → the `tf` node this engine ships.
 *
 * ⚰️ THIS DOOR REFUSED IT WITH A SENTENCE THAT WAS FALSE ABOUT THE ENGINE: "a
 * screen answers on the timeframe it is run on". The `tf` node reads a HIGHER
 * timeframe from the bars it is given, and the Pine door has emitted it since it
 * landed.
 *
 * ⛔⛔ BUT `AggregationPeriod.DAY` IS NOT THE IDENTITY, AND THAT DISTINCTION IS
 * THE WHOLE CARE IN THIS FILE. Pine's `timeframe.period` means "whatever this
 * chart is", so reading it as a no-op is exact. thinkorswim's `AggregationPeriod`
 * values are ABSOLUTE — `DAY` means daily bars, full stop. On a daily screen that
 * happens to be the identity; on an INTRADAY chart it is a higher-timeframe read
 * this engine cannot serve, because it resamples only UPWARD from the bars it is
 * handed. Mapping `DAY` to a no-op would be right in the scan lane and silently
 * wrong on a chart, so it refuses.
 *
 * ⭐ ONLY WEEK AND MONTH TRANSLATE, and that is not a shortlist someone typed —
 * it is `TF_RESAMPLABLE`, the engine's own statement of what it can serve from
 * daily bars. Offering a code the interpreter then refuses is the "told it would
 * run, answers nothing" shape this codebase has already paid for twice.
 */
describe('another timeframe inside one column', () => {
  const only = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = (out.outputs || []).find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row
  }

  it('⭐⭐ WEEK becomes a `tf` node wrapping the bar field', () => {
    expect(only(translateThinkScript('plot p = close(period = AggregationPeriod.WEEK);\n')).ast)
      .toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐⭐ MONTH likewise, and the FIELD is the one asked for', () => {
    // ⛔ THE CONTROL THAT CATCHES A HARD-CODED CHILD — `high(period = …)` reading
    // `close` would be a silent mistranslation every other assertion here misses.
    expect(only(translateThinkScript('plot p = high(period = AggregationPeriod.MONTH);\n')).ast)
      .toEqual({ type: 'tf', value: 'M', args: [{ type: 'series', name: 'high' }] })
  })

  it('⭐ …and through an INPUT, folded to its default', () => {
    expect(only(translateThinkScript(
      'input agg = AggregationPeriod.WEEK;\nplot p = close(period = agg);\n')).ast)
      .toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐ `aggregationPeriod =` is the same argument by its other spelling', () => {
    expect(only(translateThinkScript(
      'plot p = close(aggregationPeriod = AggregationPeriod.WEEK);\n')).ast)
      .toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  // ─── what must still refuse ───────────────────────────────────────────────

  it('⛔⛔ DAY refuses — it is ABSOLUTE, not "this chart"', () => {
    // The distinction this whole file turns on. See the header: right in the scan
    // lane, silently wrong on an intraday chart.
    const out = translateThinkScript('plot p = close(period = AggregationPeriod.DAY);\n')
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('thinkscript:aggregation')
  })

  it('⛔ and so does an intraday period the engine cannot resample up to', () => {
    for (const v of ['FIVE_MIN', 'THIRTY_MIN', 'HOUR']) {
      const out = translateThinkScript(`plot p = close(period = AggregationPeriod.${v});\n`)
      expect(out.refusal, v).toBeTruthy()
      expect(out.refusal.guard, v).toBe('thinkscript:aggregation')
    }
  })

  it('⛔ a period that does not fold to a constant refuses', () => {
    const out = translateThinkScript(
      'def a = if close > open then AggregationPeriod.WEEK else AggregationPeriod.MONTH;\n'
      + 'plot p = close(period = a);\n')
    expect(out.refusal).toBeTruthy()
  })

  it('⭐ it composes — a weekly ratio is one column', () => {
    expect(only(translateThinkScript(
      'plot rs = close / close(period = AggregationPeriod.WEEK);\n')).ast).toEqual({
      type: 'op', name: '/', args: [
        { type: 'series', name: 'close' },
        { type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] },
      ],
    })
  })
})
