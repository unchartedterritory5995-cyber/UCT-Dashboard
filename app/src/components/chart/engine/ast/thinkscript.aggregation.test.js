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

  // ─── and the refusal SENTENCE, not just the guard ───────────────────────
  //
  // ⚰️ THE THREE REFUSAL CASES ABOVE ALL PASSED WHILE SHARING ONE FALSE SENTENCE.
  // `REFUSALS['thinkscript:aggregation']` read "what is missing is this
  // translation" — true of the computed period, false of DAY and of every
  // intraday value, which need a NODE this engine does not have. Asserting only
  // `guard` cannot see that, and a member reading "the translation is missing"
  // waits for work that would not help them
  // (`lesson_rail_the_sentence_not_just_the_guard`).

  it('⛔⛔ DAY is refused as an ABSOLUTE period, never as a missing fold', () => {
    const out = translateThinkScript('plot p = close(period = AggregationPeriod.DAY);\n')
    const msg = String(out.refusal.message)
    expect(msg).toMatch(/ABSOLUTELY/)
    expect(msg).toMatch(/resamples only UPWARD/i)
    expect(msg).not.toMatch(/what is missing is this translation/i)
    expect(msg).not.toMatch(/missing is folding this argument/i)
    // ⛔⛔ AND IT MUST OFFER NO REWRITE. The obvious one — drop the `period`
    // argument — is exactly what this file's header rules out: right in the scan
    // lane, silently wrong on a chart. A definition is SAVED and can be charted,
    // so that advice would be correct where the member tested it and wrong where
    // they look at it. This is the rail on that judgement, the same shape as the
    // one guarding the `time` ms-vs-seconds refusal.
    expect(msg).not.toMatch(/TO UNBLOCK/)
  })

  it('⛔ an intraday period is refused as FINER than the base, and offers nothing', () => {
    const msg = String(translateThinkScript(
      'plot p = close(period = AggregationPeriod.FOUR_HOURS);\n').refusal.message)
    expect(msg).toMatch(/FINER/)
    expect(msg).toMatch(/cannot be resampled down/i)
    expect(msg).not.toMatch(/what is missing is this translation/i)
    expect(msg).not.toMatch(/TO UNBLOCK/)
  })

  it('⭐ a COMPUTED period still says the fold is missing — the one case where it is TRUE', () => {
    const msg = String(translateThinkScript(
      'def a = if close > open then AggregationPeriod.WEEK else AggregationPeriod.MONTH;\n'
      + 'plot p = close(period = a);\n').refusal.message)
    expect(msg).toMatch(/missing is folding this argument/i)
  })

  it('⛔⛔ the three refusals are genuinely DIFFERENT SENTENCES', () => {
    // A split that produced one sentence three times passes every case above and
    // changes nothing (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    const m = (src) => String(translateThinkScript(src).refusal.message)
    const day = m('plot p = close(period = AggregationPeriod.DAY);\n')
    const intra = m('plot p = close(period = AggregationPeriod.FOUR_HOURS);\n')
    const computed = m('def a = if close > open then AggregationPeriod.WEEK else AggregationPeriod.MONTH;\n'
      + 'plot p = close(period = a);\n')
    expect(new Set([day, intra, computed]).size).toBe(3)
    expect(day).toContain('AggregationPeriod.DAY')
    expect(intra).toContain('AggregationPeriod.FOUR_HOURS')
  })

  it('⛔⛔ the REAL published script gets the specific sentence, not the generic one', () => {
    // ⚰️⚰️ THE HAND-WRITTEN CASES ABOVE CANNOT SEE THIS ONE. `aggregationNameOf`
    // follows a binding to an input default, and a mutation disabling that walk
    // left every snippet in this file GREEN — so I removed it as dead code.
    // `22-average-daily-range-zones.ts` fell straight through to the generic
    // sentence and the corpus rail named it.
    // ⛔ THE TWO SPELLINGS LOOK THE SAME AND ARE NOT: a snippet writing
    // `close(period = p)` resolves upstream, while 22 writes
    // `open(period = aggregationPeriod)` and shadows `open`/`high`/`low` with
    // `def`s of those names, so the argument arrives as a NAME. A probe that
    // cannot reach a branch is not evidence about that branch.
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(),
      '../tests/fixtures/thinkscript/22-average-daily-range-zones.ts'), 'utf8')
    expect(src).toMatch(/input\s+aggregationPeriod\s*=\s*AggregationPeriod\.DAY/)
    expect(src).toMatch(/period\s*=\s*aggregationPeriod/)
    const out = translateThinkScript(src)
    expect(out.refusal.guard).toBe('thinkscript:aggregation')
    expect(String(out.refusal.message)).toMatch(/ABSOLUTELY/)
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
