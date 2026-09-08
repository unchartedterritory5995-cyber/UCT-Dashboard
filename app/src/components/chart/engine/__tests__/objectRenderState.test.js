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
