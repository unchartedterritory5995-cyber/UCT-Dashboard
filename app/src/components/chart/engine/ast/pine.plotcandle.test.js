import { describe, it, expect } from 'vitest'

/**
 * `plotcandle` and `plotbar` are FOUR columns, and four is the answer.
 *
 * ⚰️ THEY SAT IN `CHART_ONLY_CALLS` UNTIL NOW, and the reason recorded there was
 * right about the problem and wrong about the answer: "offering one of them under
 * the script's title is a quarter of a candle. It waits for the multi-column
 * output shape." This is that shape. TradingView's own screener requirements name
 * `plotbar()` and `plotcandle()` beside `plot()` — the same sentence that got
 * `plotarrow` released from the set.
 *
 * ⭐⭐ THE FOUR ARE ONLY USEFUL TOGETHER, WHICH ARGUES FOR EMITTING THEM ALL. The
 * screen a member wants off a Heikin-Ashi script is "the candle turned green" —
 * `close > open` — and that needs both columns to exist. It is the one blocker
 * left on `08-smoothed-heiken-ashi-candles` now that its self-referencing
 * `haopen` folds into an accumulator.
 */
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

describe('a candle call yields one column per role', () => {
  const src = (body) => `//@version=5\nindicator("t")\n${body}\n`
  const rows = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    return out.outputs
  }
  const byTitle = (out) => Object.fromEntries(
    out.outputs.map((o) => [o.title, o.refusal ? `REFUSED:${o.refusal.guard}` : o.formula]))

  it('⭐⭐ four columns, each titled by its role', () => {
    const out = translatePine(src('plotcandle(open, high, low, close)'))
    expect(rows(out)).toHaveLength(4)
    expect(byTitle(out)).toEqual({
      open: 'open', high: 'high', low: 'low', close: 'close',
    })
  })

  it('⭐⭐ a NAMED call picks by name, not by position — the swap detector', () => {
    // ⛔⛔ THE ONE PLACE THIS CAN BE WRONG WITHOUT REFUSING. Read positionally, a
    // reordered named call yields a candle whose high and low are swapped: it
    // draws, it saves, and every screen off it is backwards. The arguments here
    // are deliberately in no sane order.
    const out = translatePine(src(
      'plotcandle(close = high, low = open, open = low, high = close)'))
    expect(rows(out)).toHaveLength(4)
    expect(byTitle(out)).toEqual({
      open: 'low', high: 'close', low: 'open', close: 'high',
    })
  })

  it('⭐ the script`s own title prefixes all four, so they are distinguishable', () => {
    const out = translatePine(src('plotcandle(open, high, low, close, title = "HA")'))
    expect(rows(out).map((o) => o.title)).toEqual(['HA open', 'HA high', 'HA low', 'HA close'])
  })

  it('⛔ the second positional is a PRICE here, never the title', () => {
    // `plot(series, "t")` titles from the second positional. For a candle the
    // second positional is the HIGH, and reading it as a title would name every
    // column after a price series.
    const out = translatePine(src('plotcandle(open, high, low, close)'))
    expect(rows(out).map((o) => o.title)).toEqual(['open', 'high', 'low', 'close'])
  })

  it('⛔ one bad arm costs ITS column and not the other three — and says which', () => {
    // The same behaviour a script with four separate `plot()` calls already has.
    const out = translatePine(src('plotcandle(open, high, low, cum(close))'))
    const got = byTitle(out)
    expect(got.open).toBe('open')
    expect(got.high).toBe('high')
    expect(got.low).toBe('low')
    // ⭐ AND THE REFUSED ROW KEEPS ITS ROLE — it is keyed under `close` here, which
    // is the assertion. Four columns share one line and one token, so a nameless
    // refusal among three translated siblings tells a member their candle failed
    // without saying which series to go and look at.
    expect(got.close).toBe('REFUSED:pine:function')
    expect(Object.keys(got).sort()).toEqual(['close', 'high', 'low', 'open'])
  })

  it('⭐ plotbar is the same shape', () => {
    const out = translatePine(src('plotbar(open, high, low, close)'))
    expect(rows(out)).toHaveLength(4)
    expect(byTitle(out).close).toBe('close')
  })

  it('⭐⭐ …and `08-smoothed-heiken-ashi-candles` translates because of it', () => {
    // ⛔ THE WHOLE POINT, ON A REAL PUBLISHED SCRIPT rather than a fixture I wrote.
    // It refused at `pine:no-output` — the plot was the only wall left once the
    // plain self-reference `haopen = na(haopen[1]) ? … : …` began folding.
    const file = path.resolve(process.cwd(),
      '../tests/fixtures/pine_community/08-smoothed-heiken-ashi-candles.pine')
    const out = translatePine(fs.readFileSync(file, 'utf8'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.outputs.filter((o) => o.refusal === null)).toHaveLength(4)
    const got = byTitle(out)
    // ⭐ AND THE STATE IS REALLY IN THERE — `haopen` is a recurrence, so a
    // translation that quietly dropped it would still produce four columns.
    expect(got['heikin smoothed open']).toContain('accum(')
    expect(got['heikin smoothed close']).not.toContain('accum(')
  })
})
