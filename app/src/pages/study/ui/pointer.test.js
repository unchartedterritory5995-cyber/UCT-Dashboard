import { describe, expect, it } from 'vitest'
import { callout, calloutSide } from './pointer'

// 90 daily bars: a quiet base around 100, then a candle to point at
function bars(n = 90, last = { o: 100, h: 101.2, l: 99.3, c: 100.8 }) {   // a mid-window candle: the base swings 98-102
  const out = []
  for (let i = 0; i < n - 1; i++) {
    const base = 100 + Math.sin(i / 9) * 2
    out.push({ t: 1700000000 + i * 86400, o: base, h: base + 1.2, l: base - 1.1, c: base + 0.4 })
  }
  out.push({ t: 1700000000 + (n - 1) * 86400, ...last })
  return out
}

describe('callout: the pointer lives in the clear', () => {
  it('drops onto the candle from above: a vertical arrow whose head sits just over the high, a chip above every bar it spans', () => {
    const b = bars()
    const i = b.length - 1
    const d = callout(b, i, { label: 'this candle', view: 90, barPx: 6.6 })
    const arrow = d.find((x) => x.type === 'arrow'), chip = d.find((x) => x.type === 'text')
    expect(arrow.points[0].time).toBe(b[i].t)
    expect(arrow.points[1].time).toBe(b[i].t)                                  // vertical: both ends on the candle's own time
    expect(arrow.points[1].price).toBeGreaterThan(b[i].h)                      // the head never touches the candle
    expect(arrow.points[0].price).toBeGreaterThan(arrow.points[1].price)       // the tail is higher: it points DOWN
    const start = b.findIndex((x) => x.t === chip.points[0].time)
    const highest = Math.max(...b.slice(start, i + 1).map((x) => x.h))
    expect(chip.points[0].price).toBeGreaterThan(highest)                      // the chip clears every candle under it
    expect(chip.text).toBe(' THIS CANDLE ')
    expect(calloutSide(d, b, i)).toBe('above')
  })
  it('rises from below when the candle is the top of its window, and the chip clears every low it spans', () => {
    const b = bars(90, { o: 104, h: 109, l: 103.5, c: 108.4 })
    const i = b.length - 1
    const d = callout(b, i, { label: 'the answer', view: 90, barPx: 6.6 })
    const arrow = d.find((x) => x.type === 'arrow'), chip = d.find((x) => x.type === 'text')
    expect(arrow.points[1].price).toBeLessThan(b[i].l)
    expect(arrow.points[0].price).toBeLessThan(arrow.points[1].price)          // the tail is lower: it points UP
    const start = b.findIndex((x) => x.t === chip.points[0].time)
    const lowest = Math.min(...b.slice(start, i + 1).map((x) => x.l))
    expect(chip.points[0].price).toBeLessThan(lowest)
    expect(calloutSide(d, b, i)).toBe('below')
  })
  it('a phone packs bars tighter, so the chip spans more of them and starts further left', () => {
    const b = bars()
    const i = b.length - 1
    const desk = callout(b, i, { barPx: 6.6 }).find((x) => x.type === 'text')
    const phone = callout(b, i, { barPx: 3.8 }).find((x) => x.type === 'text')
    expect(phone.points[0].time).toBeLessThan(desk.points[0].time)
  })
  it('stays inside the pane: the chip never rises past the window top by more than the pane margin', () => {
    const b = bars()
    const i = b.length - 1
    const shown = b.slice(b.length - 90)
    const top = Math.max(...shown.map((x) => x.h)), bot = Math.min(...shown.map((x) => x.l))
    const chip = callout(b, i, { view: 90 }).find((x) => x.type === 'text')
    expect(chip.points[0].price).toBeLessThan(top + (top - bot) * 0.15)
  })
  it('is empty for a missing bar and locked for an editable chart', () => {
    expect(callout(null, 0)).toEqual([])
    expect(callout(bars(), 500)).toEqual([])
    expect(callout(bars(), 10).every((x) => x.locked)).toBe(true)
  })
})
