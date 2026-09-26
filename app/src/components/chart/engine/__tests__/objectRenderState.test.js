// app/src/components/chart/engine/__tests__/objectRenderState.test.js
//
// ─── C3B — THE GENERIC RENDER STATE ────────────────────────────────────────
//
// ⛔ THE COORDINATE CONVERSION IS WHERE A DRAWING GOES QUIETLY WRONG. Pine
// addresses bars by INDEX; a chart addresses them by TIME; and the commonest
// object idiom in the corpus — `line.new(bar_index, y, bar_index + 20, y)` —
// projects PAST the last bar, where no index exists. Every case below exists
// because the plausible shortcut (clamp to the last bar, or drop it) produces a
// chart that looks fine and is a different drawing.
import { describe, it, expect } from 'vitest'
import { toRenderState, makeBarClock, OBJECT_DEFAULTS } from '../objectRenderState'

const BARS = Array.from({ length: 10 }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 1, h: 2, l: 0.5, c: 1.5, v: 100,
}))

const live = (over) => ({ family: 'line', id: 1, site: 's1', createdBar: 0, props: {}, ...over })

describe('C3B — the bar clock', () => {
  it('⭐ a bar index inside the series is that bar’s own time', () => {
    const clock = makeBarClock(BARS)
    expect(clock.timeAt(0)).toBe(BARS[0].t)
    expect(clock.timeAt(9)).toBe(BARS[9].t)
  })

  it('⭐⭐ a bar index PAST THE LAST BAR extrapolates — it does not clamp', () => {
    const clock = makeBarClock(BARS)
    // ⛔ CLAMPING WOULD DRAG EVERY PROJECTION BACK ONTO THE LAST BAR, which is
    // what a level "extended 20 bars right" would silently become.
    expect(clock.timeAt(10)).toBe(BARS[9].t + 86400)
    expect(clock.timeAt(29)).toBe(BARS[9].t + 20 * 86400)
    expect(clock.timeAt(10)).not.toBe(BARS[9].t)
  })

  it('⭐ the step is MEASURED from the series, not assumed', () => {
    // an hourly series must not be extrapolated in days
    const hourly = Array.from({ length: 6 }, (_, i) => ({ t: 1_700_000_000 + i * 3600 }))
    expect(makeBarClock(hourly).step).toBe(3600)
    // and a gap (a weekend) must not become the step
    const withGap = [...BARS]
    withGap[5] = { ...withGap[5], t: withGap[4].t + 3 * 86400 }
    expect(makeBarClock(withGap).step).toBe(86400)
  })

  // ─── RC-C — THE FUTURE IS SESSIONS, NOT CALENDAR DAYS ────────────────────
  //
  // ⚰️⚰️ `bar_index + N` MEANS N FUTURE BARS, and a chart's future bars are
  // TRADING SESSIONS. Extending by a constant step — even a measured one — walks
  // straight onto Saturday, because the median gap of a weekday series is one
  // calendar day and four gaps in five really are one day.
  //
  // Measured against TradingView on 2026-09-23: Fair Value Gaps put two box
  // right edges on a weekend, and Inside Bar Range stopped two sessions short of
  // the vendor's. Both are this one arithmetic.
  //
  // ⛔ THE CADENCE IS DERIVED FROM THE SERIES, NEVER ASSUMED. Hard-coding
  // "skip Saturday and Sunday" would be another resemblance: it is wrong for a
  // 24/7 market and wrong for a weekly series. What the bars actually tell us is
  // WHICH WEEKDAYS CARRY SESSIONS, and that one fact answers all three cases.

  /** A daily series of ISO date strings on weekdays only — the product's real
   *  daily shape (`"2026-09-04"`), not unix seconds. */
  const weekdaySeries = (startISO, count) => {
    const out = []
    const d = new Date(`${startISO}T00:00:00Z`)
    while (out.length < count) {
      const wd = d.getUTCDay()
      if (wd !== 0 && wd !== 6) out.push({ t: d.toISOString().slice(0, 10) })
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
  }

  it('⛔⛔ a DAILY series extrapolates in SESSIONS — the forward edge skips the weekend', () => {
    // 9 weekday bars, 2026-09-01 (Tue) .. 2026-09-11 (Fri) — the same series end
    // date as the Fair Value Gaps vendor capture.
    const bars = weekdaySeries('2026-09-01', 9)
    expect(bars[8].t, 'the fixture does not end on the Friday it claims').toBe('2026-09-11')
    const clock = makeBarClock(bars)

    // ⛔ the next BAR after Friday is Monday, not Saturday
    expect(clock.timeAt(9)).toBe('2026-09-14')
    expect(clock.timeAt(10)).toBe('2026-09-15')
    expect(clock.timeAt(11)).toBe('2026-09-16')
    // …and `bar_index + 3` from the last bar clears the whole weekend
    expect(clock.timeAt(8 + 3)).toBe('2026-09-16')
  })

  it('⛔ and BACKWARD too — a bar before the first is the PREVIOUS session', () => {
    // ⭐ The same arithmetic runs in both directions, so a rail on one is half a
    // rail. `line.new(bar_index - 300, …)` on a short series lands here.
    const bars = weekdaySeries('2026-09-07', 5) // Mon 09-07 .. Fri 09-11
    expect(bars[0].t).toBe('2026-09-07')
    const clock = makeBarClock(bars)
    expect(clock.timeAt(-1)).toBe('2026-09-04') // the Friday before, not Sunday
    expect(clock.timeAt(-3)).toBe('2026-09-02')
  })

  it('⭐ a WEEKLY series still steps a whole week — one rule, not a special case', () => {
    // ⛔ CONTROL. A weekly series carries exactly one session weekday, so
    // "advance to the next session weekday" IS "+7 days" with nothing added for
    // it. If this needed its own branch, the rule would be wrong.
    const weekly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date('2026-08-07T00:00:00Z') // a Friday
      d.setUTCDate(d.getUTCDate() + i * 7)
      return { t: d.toISOString().slice(0, 10) }
    })
    expect(weekly[5].t).toBe('2026-09-11')
    const clock = makeBarClock(weekly)
    expect(clock.timeAt(6)).toBe('2026-09-18')
    expect(clock.timeAt(7)).toBe('2026-09-25')
  })

  it('⛔⛔ a 24/7 series is NOT session-adjusted — it has no non-session day to skip', () => {
    // ⭐ THE CONTROL THAT STOPS THIS BECOMING A HARD-CODED WEEKEND RULE. Crypto
    // trades every day, so every weekday carries a session and the clock must
    // fall back to its measured step. `BARS` above is exactly this shape, which
    // is why the two cases at the top of this block still read the same.
    const allWeek = Array.from({ length: 14 }, (_, i) => {
      const d = new Date('2026-09-01T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + i)
      return { t: d.toISOString().slice(0, 10) }
    })
    const clock = makeBarClock(allWeek)
    expect(clock.timeAt(14)).toBe('2026-09-15') // the next calendar day, weekend or not
    expect(clock.timeAt(18)).toBe('2026-09-19')
  })

  it('⛔ an INTRADAY series is untouched — its sessions are not whole days', () => {
    // ⭐ CONTROL. Session-skipping is whole-day arithmetic; an hourly series
    // must keep stepping in hours or every projection lands a day out.
    const hourly = Array.from({ length: 8 }, (_, i) => ({ t: 1_700_000_000 + i * 3600 }))
    const clock = makeBarClock(hourly)
    expect(clock.timeAt(8)).toBe(1_700_000_000 + 8 * 3600)
  })
})

describe('C3B — render state', () => {
  it('⭐ a line becomes two time/price points, with Pine’s own defaults filled in', () => {
    const rs = toRenderState([live({ props: { x1: 2, y1: 10, x2: 5, y2: 20 } })], { bars: BARS })
    expect(rs.lines).toHaveLength(1)
    expect(rs.lines[0]).toMatchObject({
      x1: BARS[2].t, y1: 10, x2: BARS[5].t, y2: 20,
      color: OBJECT_DEFAULTS.line.color, width: 1, style: 'solid', extend: 'none',
    })
  })

  it('⭐ `xloc.bar_time` means the coordinate ALREADY IS a time', () => {
    const t = BARS[3].t
    const rs = toRenderState([live({ props: { x1: t, y1: 1, x2: t, y2: 2, xloc: 'bar_time' } })],
      { bars: BARS })
    expect(rs.lines[0].x1).toBe(t)
  })

  it('⛔⛔ AN OBJECT WITH A NON-FINITE COORDINATE IS DROPPED AND COUNTED, never drawn at zero', () => {
    const rs = toRenderState([
      live({ id: 1, props: { x1: 1, y1: NaN, x2: 2, y2: 3 } }),
      live({ id: 2, props: { x1: 1, y1: 5, x2: 2, y2: 6 } }),
    ], { bars: BARS })
    expect(rs.lines).toHaveLength(1)
    expect(rs.lines[0].id).toBe(2)
    expect(rs.dropped.line).toBe(1)
  })

  it('⭐ a box normalises top/bottom, whichever way the author passed them', () => {
    const a = toRenderState([live({ family: 'box', props: { left: 1, top: 5, right: 4, bottom: 9 } })],
      { bars: BARS }).boxes[0]
    const b = toRenderState([live({ family: 'box', props: { left: 1, top: 9, right: 4, bottom: 5 } })],
      { bars: BARS }).boxes[0]
    expect(a.top).toBe(9)
    expect(a.bottom).toBe(5)
    expect(a).toEqual(b)
  })

  it('⭐ a label anchored to the BAR carries no price, and says so', () => {
    const rs = toRenderState([
      live({ family: 'label', props: { x: 1, y: 50, yloc: 'abovebar', text: 'hi' } }),
      live({ family: 'label', id: 2, props: { x: 1, y: 50, text: 'at price' } }),
    ], { bars: BARS })
    expect(rs.labels[0]).toMatchObject({ yloc: 'abovebar', y: null, text: 'hi' })
    expect(rs.labels[1]).toMatchObject({ yloc: 'price', y: 50 })
  })

  it('⭐ a table keeps its cells in row-major order, whatever order they were written', () => {
    const rs = toRenderState([{
      family: 'table',
      id: 1,
      site: 's1',
      createdBar: 0,
      props: { position: 'bottom_left' },
      cells: [
        { col: 1, row: 1, props: { text: 'd' } },
        { col: 0, row: 0, props: { text: 'a' } },
        { col: 1, row: 0, props: { text: 'b' } },
      ],
    }], { bars: BARS })
    expect(rs.tables[0].position).toBe('bottom_left')
    expect(rs.tables[0].cells.map((c) => c.text)).toEqual(['a', 'b', 'd'])
  })

  it('⛔⛔ A FILL WITHOUT BOTH ITS LINES IS DROPPED — a one-edged band is not a band', () => {
    const rs = toRenderState([
      live({ id: 1, props: { x1: 1, y1: 1, x2: 2, y2: 2 } }),
      { family: 'linefill', id: 3, site: 's3', createdBar: 0, props: { line1: { __ref: 1 }, line2: { __ref: 99 } } },
    ], { bars: BARS })
    expect(rs.fills).toHaveLength(0)
    expect(rs.dropped.linefill).toBe(1)
  })

  it('⭐ …and a fill WITH both of them names them by id', () => {
    const rs = toRenderState([
      live({ id: 1, props: { x1: 1, y1: 1, x2: 2, y2: 2 } }),
      live({ id: 2, props: { x1: 1, y1: 3, x2: 2, y2: 4 } }),
      { family: 'linefill', id: 3, site: 's3', createdBar: 0, props: { line1: { __ref: 1 }, line2: { __ref: 2 }, color: '#123456' } },
    ], { bars: BARS })
    expect(rs.fills).toEqual([{ id: 3, a: 1, b: 2, color: '#123456' }])
  })
})
