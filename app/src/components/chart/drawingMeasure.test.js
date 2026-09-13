/* The measurement language, executed.
 *
 * ⛔ THE ONE THING THIS FILE EXISTS TO PREVENT is two measurement tools printing
 * different numbers for the same two anchors. Before Phase 5 the percentage was
 * computed inline in `renderMeasure`, the run percentage in `computeAdvancePct`,
 * and elapsed time nowhere — three places, no shared test, and no way for a
 * disagreement to fail rather than merely look wrong on somebody's chart. Every
 * assertion here is about the SHARED answer, and the agreement between tools is
 * asserted directly at the bottom.
 */
import { describe, it, expect } from 'vitest'
import {
  LEGACY_FIELDS, LABEL_POSITIONS, DEFAULT_LABEL_POS,
  advanceLines, anchorSeconds, barSpan, barSecondsFor, elapsedBetween, fieldOn,
  fieldsFor, formatDuration, inferBarSeconds, labelPosOf, measureLines,
  measurementFor, priceMove, resolveLabelY, toSeconds,
} from './drawingMeasure'
import { computeAdvanceMove, computeAdvancePct } from './drawingGeometry'

const DAY = 86400
const day = (n) => Date.UTC(2026, 0, n) / 1000

// ═══════════════════════════════════════════════════════════════════════════
describe('bar span — the convention both tools obey', () => {
  it('⛔ DISTANCE, NOT INCLUSIVE COUNT: bars 100 and 125 are 25 bars', () => {
    // This is the arithmetic the shipped Measure stored at creation, so it is
    // the number every existing Measure drawing is showing. Changing it would
    // silently restate all of them.
    expect(barSpan(100, 125)).toBe(25)
    expect(barSpan(125, 100)).toBe(25)      // order-free
    expect(barSpan(100, 100)).toBe(0)       // a move that goes nowhere spans nothing
    expect(barSpan(100, 101)).toBe(1)
  })

  it('has no answer when an anchor has no index', () => {
    expect(barSpan(null, 5)).toBeNull()
    expect(barSpan(5, undefined)).toBeNull()
    expect(barSpan(NaN, 5)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('elapsed time — calendar, never bars × timeframe', () => {
  const bars = [{ t: day(1) }, { t: day(2) }, { t: day(5) }, { t: day(6) }]

  it('⭐ TEN DAILY BARS CAN SPAN FOURTEEN DAYS, and that is the point', () => {
    // Mon→Mon across a weekend: 5 bars of distance, 7 calendar days. A tool that
    // multiplied bars by the timeframe would report 5 days and be wrong every
    // single week.
    const a = { time: day(5) }, b = { time: day(12) }
    expect(elapsedBetween(a, b, { bars }).seconds).toBe(7 * DAY)
    expect(formatDuration(elapsedBetween(a, b, { bars }).seconds)).toBe('7d')
  })

  it('is order-free and zero for the same instant', () => {
    const a = { time: day(1) }, b = { time: day(9) }
    expect(elapsedBetween(a, b, { bars }).seconds).toBe(elapsedBetween(b, a, { bars }).seconds)
    expect(elapsedBetween(a, a, { bars }).seconds).toBe(0)
  })

  it('reads both bar-time shapes the chart carries', () => {
    expect(toSeconds(1767225600)).toBe(1767225600)          // numeric epoch
    expect(toSeconds('2026-01-01')).toBe(Date.UTC(2026, 0, 1) / 1000)
    expect(toSeconds('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1) / 1000)
    expect(toSeconds(null)).toBeNull()
    expect(toSeconds('nonsense')).toBeNull()
  })

  it('has no answer when either anchor has no time', () => {
    expect(elapsedBetween({ time: day(1) }, {}, { bars }).seconds).toBeNull()
    expect(elapsedBetween(null, { time: day(1) }, { bars }).seconds).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('future bars — measuring into space where there is no bar', () => {
  const bars = [{ t: day(1) }, { t: day(2) }, { t: day(3) }]

  it('⭐ EXTRAPOLATES FROM THE LAST REAL BAR, and says that it did', () => {
    const r = anchorSeconds({ futureBars: 4 }, { bars, barSeconds: DAY })
    expect(r.seconds).toBe(day(3) + 4 * DAY)
    expect(r.extrapolated).toBe(true)
  })

  it('a real anchor is never flagged', () => {
    expect(anchorSeconds({ time: day(2) }, { bars })).toEqual({ seconds: day(2), extrapolated: false })
    expect(anchorSeconds({ time: day(2), futureBars: 0 }, { bars }).extrapolated).toBe(false)
  })

  it('a span with one foot in the future is flagged, and still measures', () => {
    const r = elapsedBetween({ time: day(1) }, { futureBars: 2 }, { bars, barSeconds: DAY })
    expect(r.seconds).toBe(day(3) + 2 * DAY - day(1))
    expect(r.extrapolated).toBe(true)
  })

  it('infers the step from the bars when the caller does not know it', () => {
    expect(anchorSeconds({ futureBars: 1 }, { bars }).seconds).toBe(day(3) + DAY)
  })

  it('⛔ BOTH FEET IN THE FUTURE IS A REAL DISTANCE, not zero', () => {
    // Both anchors store the LAST bar's time plus a count. Reading `time` alone
    // would make them identical and report a span of nothing.
    const r = elapsedBetween({ futureBars: 2 }, { futureBars: 7 }, { bars, barSeconds: DAY })
    expect(r.seconds).toBe(5 * DAY)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('inferBarSeconds — the spacing, read off the data', () => {
  it('⛔ MEDIAN, so weekends and holidays cannot move it', () => {
    // Mon-Fri then a weekend gap, repeatedly: two thirds of the gaps are 1 day
    // and the rest 3. The mean is 1.6 days; the median is exactly 1.
    const bars = []
    let t = day(5)
    for (let w = 0; w < 6; w++) {
      for (let i = 0; i < 5; i++) { bars.push({ t }); t += DAY }
      t += 2 * DAY
    }
    expect(inferBarSeconds(bars)).toBe(DAY)
  })

  it('reads an intraday chart as intraday', () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({ t: 1767225600 + i * 300 }))
    expect(inferBarSeconds(bars)).toBe(300)
  })

  it('falls back to a day when there is nothing to read', () => {
    expect(inferBarSeconds([])).toBe(DAY)
    expect(inferBarSeconds([{ t: day(1) }])).toBe(DAY)
    expect(inferBarSeconds(null)).toBe(DAY)
    expect(inferBarSeconds([{ t: 'x' }, { t: 'y' }])).toBe(DAY)
  })

  it('the named-timeframe helper still answers for callers that have one', () => {
    expect(barSecondsFor('5')).toBe(300)
    expect(barSecondsFor('D')).toBe(DAY)
    expect(barSecondsFor('W')).toBe(604800)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('formatDuration — chart chrome, not a calendar app', () => {
  const cases = [
    [0, '<1m'], [59, '<1m'],
    [60, '1m'], [45 * 60, '45m'], [3599, '59m'],
    [3600, '1h'], [6.5 * 3600, '6h 30m'], [23 * 3600, '23h'],
    [DAY, '1d'], [9 * DAY, '9d'], [13 * DAY, '13d'],
    [14 * DAY, '2w'], [44 * DAY, '6w 2d'], [69 * DAY, '9w 6d'],
    [70 * DAY, '2mo'], [244 * DAY, '8mo'],
    [365.25 * DAY * 2 + 30.44 * DAY * 3, '2y 3mo'],
  ]
  for (const [s, want] of cases) {
    it(`${s}s → ${want}`, () => expect(formatDuration(s)).toBe(want))
  }

  it('⛔ NEVER A ZERO SUBORDINATE UNIT — "6w", never "6w 0d"', () => {
    expect(formatDuration(42 * DAY)).toBe('6w')
    expect(formatDuration(2 * 3600)).toBe('2h')
    expect(formatDuration(365.25 * DAY * 2)).toBe('2y')
  })

  it('is deterministic and carries no decimals', () => {
    for (const s of [1, 100, 10000, 1e6, 1e8]) {
      expect(formatDuration(s)).toBe(formatDuration(s))
      expect(formatDuration(s)).not.toMatch(/\./)
    }
  })

  it('says nothing rather than something wrong', () => {
    for (const bad of [null, undefined, NaN, -5, 'x']) expect(formatDuration(bad)).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('priceMove — anchor order, never normalised bounds', () => {
  it('⛔ A MOVE DRAWN DOWNWARD READS AS A FALL', () => {
    expect(priceMove(100, 118.9)).toEqual({ delta: expect.closeTo(18.9, 6), pct: expect.closeTo(18.9, 6) })
    const down = priceMove(118.9, 100)
    expect(down.delta).toBeCloseTo(-18.9, 6)
    expect(down.pct).toBeCloseTo(-15.9, 2)
  })

  it('is not symmetric, because a move is not', () => {
    expect(priceMove(100, 118.9).pct).not.toBeCloseTo(-priceMove(118.9, 100).pct, 3)
  })

  it('refuses a zero or missing start rather than dividing by it', () => {
    expect(priceMove(0, 10).pct).toBeNull()
    expect(priceMove(null, 10)).toBeNull()
    expect(priceMove(10, undefined)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ LEGACY FIELDS — what a drawing that says nothing shows', () => {
  it('reproduces each type’s shipped appearance', () => {
    // Transcribed from the pre-Phase-5 renderers: `renderMeasure` printed price
    // AND bars for `measure`, price alone for `priceRange`, bars alone for
    // `dateRange`; `renderAdvance` printed a percentage and nothing else.
    expect(fieldsFor({ type: 'measure' })).toEqual({ dollar: true, percent: true, bars: true, time: false })
    expect(fieldsFor({ type: 'priceRange' })).toEqual({ dollar: true, percent: true, bars: false, time: false })
    expect(fieldsFor({ type: 'dateRange' })).toEqual({ dollar: false, percent: false, bars: true, time: false })
    expect(fieldsFor({ type: 'advance' })).toEqual({ dollar: false, percent: true, bars: false, time: false })
  })

  it('⛔ WHICH IS WHY IT CANNOT BE A FLAT DEFAULT', () => {
    // Four types, four different right answers for the same property name. One
    // `showDollar: false` in DRAWING_DEFAULTS would have blanked the dollar
    // figure off every Measure ever drawn.
    const dollarByType = Object.keys(LEGACY_FIELDS).map((t) => fieldsFor({ type: t }).dollar)
    expect(new Set(dollarByType).size).toBe(2)
  })

  it('an explicit answer always wins, including "off"', () => {
    expect(fieldsFor({ type: 'measure', showBars: false }).bars).toBe(false)
    expect(fieldsFor({ type: 'advance', showDollar: true }).dollar).toBe(true)
    expect(fieldsFor({ type: 'dateRange', showTime: true }).time).toBe(true)
  })

  it('null reads as "not answered", so a cleared property falls back', () => {
    expect(fieldsFor({ type: 'measure', showBars: null }).bars).toBe(true)
  })

  it('an unknown type shows nothing rather than guessing', () => {
    expect(fieldsFor({ type: 'from-the-future' })).toEqual({ dollar: false, percent: false, bars: false, time: false })
    expect(fieldsFor(null).percent).toBe(false)
  })

  it('fieldOn answers the menu in the same voice', () => {
    expect(fieldOn({ type: 'measure' }, 'showDollar')).toBe(true)
    expect(fieldOn({ type: 'advance' }, 'showDollar')).toBe(false)
    expect(fieldOn({ type: 'measure' }, 'nonsense')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('label position — flip, don’t clip', () => {
  const band = { y0: 100, y1: 300 }
  const H = 20

  it('places top, centre and bottom where they say', () => {
    expect(resolveLabelY('top', band, H, null)).toBe(104)
    expect(resolveLabelY('center', band, H, null)).toBe(190)
    expect(resolveLabelY('bottom', band, H, null)).toBe(276)
  })

  it('⛔ TOP THAT WOULD LEAVE THE PANE BECOMES BOTTOM', () => {
    const bounds = { x0: 0, y0: 110, x1: 800, y1: 400 }
    expect(resolveLabelY('top', band, H, bounds)).toBe(276)
  })

  it('…and bottom that would leave it becomes top', () => {
    const bounds = { x0: 0, y0: 0, x1: 800, y1: 290 }
    expect(resolveLabelY('bottom', band, H, bounds)).toBe(104)
  })

  it('centre is the answer when neither end fits', () => {
    const bounds = { x0: 0, y0: 150, x1: 800, y1: 240 }
    // Neither 104 nor 276 is inside; centre (190..210) is.
    expect(resolveLabelY('top', band, H, bounds)).toBe(190)
  })

  it('⛔ AND NOTHING IS EVER SUPPRESSED — a pane too small still gets a number', () => {
    const bounds = { x0: 0, y0: 195, x1: 800, y1: 200 }
    const y = resolveLabelY('top', band, H, bounds)
    expect(Number.isFinite(y)).toBe(true)
  })

  it('reads a drawing’s stored position, and defaults to centre', () => {
    expect(labelPosOf({ labelPos: 'top' })).toBe('top')
    expect(labelPosOf({})).toBe(DEFAULT_LABEL_POS)
    expect(labelPosOf({ labelPos: 'sideways' })).toBe(DEFAULT_LABEL_POS)
    expect(LABEL_POSITIONS).toEqual(['top', 'center', 'bottom'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('measureLines — price above, span below', () => {
  const V = { delta: 50.68, pct: 18.9, bars: 25, duration: '6w 2d' }

  it('⭐ TWO ROWS, SPLIT BY QUESTION', () => {
    expect(measureLines({ type: 'measure', showTime: true }, V))
      .toEqual(['+50.68 (+18.90%)', '25 bars · 6w 2d'])
  })

  it('a lone percentage is a statement, not an aside', () => {
    expect(measureLines({ type: 'measure', showDollar: false, showBars: false }, V))
      .toEqual(['+18.90%'])
  })

  it('collapses to one row when only one row has anything in it', () => {
    expect(measureLines({ type: 'dateRange', showTime: true }, V)).toEqual(['25 bars · 6w 2d'])
    expect(measureLines({ type: 'priceRange' }, V)).toEqual(['+50.68 (+18.90%)'])
  })

  it('⛔ SAYS NOTHING RATHER THAN DRAWING AN EMPTY CHIP', () => {
    const off = { type: 'measure', showDollar: false, showPercent: false, showBars: false, showTime: false }
    expect(measureLines(off, V)).toEqual([])
  })

  it('every one of the sixteen combinations is reachable', () => {
    const seen = new Set()
    for (let m = 0; m < 16; m++) {
      const d = {
        type: 'measure',
        showDollar: !!(m & 1), showPercent: !!(m & 2), showBars: !!(m & 4), showTime: !!(m & 8),
      }
      seen.add(JSON.stringify(measureLines(d, V)))
    }
    expect(seen.size).toBe(16)
  })

  it('one bar is a bar', () => {
    expect(measureLines({ type: 'dateRange' }, { ...V, bars: 1 })).toEqual(['1 bar'])
    expect(measureLines({ type: 'dateRange' }, { ...V, bars: 0 })).toEqual(['0 bars'])
  })

  it('takes the caller’s price formatter, so it matches the axis', () => {
    expect(measureLines({ type: 'priceRange' }, V, (v) => v.toFixed(4)))
      .toEqual(['+50.6800 (+18.90%)'])
  })

  it('drops a field it has no value for, whatever the toggle says', () => {
    expect(measureLines({ type: 'measure', showTime: true }, { ...V, duration: '', bars: null }))
      .toEqual(['+50.68 (+18.90%)'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('advanceLines — the run, in one statement', () => {
  it('shows both figures, the dollar first', () => {
    expect(advanceLines({ type: 'advance', showDollar: true, advPct: 18.9, advDelta: 50.68 }))
      .toEqual(['+50.68 (+19%)'])
  })

  it('⛔ KEEPS THE ROUNDED PERCENT AND ITS SEPARATOR', () => {
    // `+1,156%` is what this tool has always printed. Two decimals here would
    // restate every Price Move label already on a chart.
    expect(advanceLines({ type: 'advance', advPct: 1156.4 })).toEqual(['+1,156%'])
    expect(advanceLines({ type: 'advance', advPct: -24.6 })).toEqual(['-25%'])
  })

  it('⛔ A LEGACY DRAWING IS PERCENT-ONLY, because that is what it showed', () => {
    // It carries a dollar figure (the renderer derives one every frame) and
    // still does not print it: an unstamped 'advance' means percent alone.
    expect(advanceLines({ type: 'advance', advPct: 18.9, advDelta: 50.68 })).toEqual(['+19%'])
  })

  it('drops the dollar when there is no dollar to show', () => {
    expect(advanceLines({ type: 'advance', showDollar: true, advPct: 18.9 })).toEqual(['+19%'])
  })

  it('says nothing when it has nothing', () => {
    expect(advanceLines({ type: 'advance', showPercent: false })).toEqual([])
    expect(advanceLines(null)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('computeAdvanceMove — dollar and percent describe the SAME move', () => {
  const A = { h: 105, l: 100 }, B = { h: 130, l: 120 }

  it('an advance is measured low → high', () => {
    const m = computeAdvanceMove(A, B)
    expect(m.from).toBe(100)
    expect(m.to).toBe(130)
    expect(m.delta).toBe(30)
    expect(m.pct).toBeCloseTo(30, 6)
  })

  it('a decline is measured high → low', () => {
    const m = computeAdvanceMove(B, A)
    expect(m.from).toBe(130)
    expect(m.to).toBe(100)
    expect(m.delta).toBe(-30)
    expect(m.isDecline).toBe(true)
  })

  it('⛔ THE PERCENTAGE IS BYTE-FOR-BYTE THE ONE THAT SHIPPED', () => {
    // `computeAdvancePct` now delegates here, so every existing label is
    // unchanged. If the two ever diverged, this is where it would show.
    for (const [x, y] of [[A, B], [B, A], [{ h: 5, l: 1 }, { h: 9, l: 8 }]]) {
      expect(computeAdvancePct(x, y)).toBe(computeAdvanceMove(x, y).pct)
    }
  })

  it('⭐ AND THE DOLLAR IS DERIVED FROM THE SAME ENDPOINTS', () => {
    // The alternative — reading the two anchors' own prices — would print an
    // amount and a percentage that describe different moves.
    const m = computeAdvanceMove(A, B)
    expect(m.delta / m.from * 100).toBeCloseTo(m.pct, 9)
  })

  it('refuses a missing or zero base', () => {
    expect(computeAdvanceMove(null, B)).toBeNull()
    expect(computeAdvanceMove({ h: 1 }, B)).toBeNull()
    expect(computeAdvanceMove({ h: 0, l: 0 }, B)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ measurementFor — and the agreement it guarantees', () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: day(1) + i * DAY }))
  const indexOf = (t) => {
    const i = bars.findIndex((b) => b.t === t)
    return i < 0 ? null : i
  }
  const points = [{ time: bars[10].t, price: 100 }, { time: bars[35].t, price: 118.9 }]
  const pixels = [{ rawPrice: 100 }, { rawPrice: 118.9 }]
  const ctx = { bars, indexOf, barSeconds: DAY }

  it('answers all four questions from one pair of anchors', () => {
    const m = measurementFor(points, pixels, ctx)
    expect(m.bars).toBe(25)
    expect(m.seconds).toBe(25 * DAY)
    expect(m.duration).toBe('3w 4d')
    expect(m.delta).toBeCloseTo(18.9, 6)
    expect(m.pct).toBeCloseTo(18.9, 6)
  })

  it('⛔ MEASURE AND BARS & TIME CANNOT DISAGREE ON THE SAME TWO POINTS', () => {
    // The whole reason this module exists. Both tools read this return value.
    const m = measurementFor(points, pixels, ctx)
    const asMeasure = measureLines({ type: 'measure', showTime: true }, m)
    const asRuler = measureLines({ type: 'dateRange', showTime: true }, m)
    expect(asMeasure[1]).toBe(asRuler[0])
  })

  it('⚰️ IT IS DERIVED, so resizing changes the answer', () => {
    // The shipped Measure stored `barCount` at creation and printed it forever.
    const wider = [points[0], { ...points[1], time: bars[50].t }]
    expect(measurementFor(wider, pixels, ctx).bars).toBe(40)
    // …and a stale stored value is nowhere in the answer.
    expect(measurementFor(points, pixels, ctx).bars).toBe(25)
  })

  it('counts through empty future space rather than saturating at the last bar', () => {
    const last = bars[bars.length - 1]
    const future = [{ time: last.t }, { time: last.t, futureBars: 8 }]
    const m = measurementFor(future, pixels, ctx)
    expect(m.bars).toBe(8)
    expect(m.seconds).toBe(8 * DAY)
    expect(m.extrapolated).toBe(true)
  })

  it('survives anchors it cannot resolve', () => {
    const m = measurementFor([{ time: 'nope' }, { time: 'also nope' }], [{}, {}], ctx)
    expect(m.bars).toBeNull()
    expect(m.duration).toBe('')
    expect(m.delta).toBeNull()
    expect(() => measurementFor(null, null, ctx)).not.toThrow()
  })
})
