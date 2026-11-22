// The trade on the chart (2026-11-08, found on the phone screens: text boxes drawn on the chart ran under the price
// scale, landed on each other and floated away from their bar on a trend): the levels stay dashed lines; the action
// items are the chart's own bar markers, at their bar, only once the replay has drawn it.
import { describe, expect, it } from 'vitest'
import { markerGapBars, tradeAnnotations, tradeLevelLines, tradeMarkers } from './tradeMarks'

const bars = Array.from({ length: 60 }, (_, i) => ({ t: `2024-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, o: 100 + i * 0.2, h: 101 + i * 0.2, l: 99 + i * 0.2, c: 100.5 + i * 0.2, v: 1000 }))
const n = 50
const plan = { kind: 'plan', long: true, entry: 110.5, stop: 108.5, t1: 114.5, t2: 116.5, t1At: 3, t2At: 3, stoppedSession: null }

describe('the trade on the chart', () => {
  it('draws the levels as dashed lines and nothing else: the entry, the stop, the trims at 3R and 5R', () => {
    const out = tradeAnnotations(plan, bars[n - 1], bars)
    expect(out.map((a) => [a.id, a.type])).toEqual([['hard-ENTRY', 'hray'], ['hard-STOP', 'hray'], ['hard-3R', 'hray'], ['hard-5R', 'hray']])
    expect(tradeAnnotations(null, bars[n - 1], bars)).toBe(null)
  })

  it('names the trims from the plan\'s own trim_r, and reads 3R and 5R when an older plan has none', () => {
    const own = { ...plan, trim_r: [2, 4] }
    expect(tradeAnnotations(own, bars[n - 1], bars).map((a) => a.id)).toEqual(['hard-ENTRY', 'hard-STOP', 'hard-2R', 'hard-4R'])
    expect(tradeMarkers(own, bars, n).map((m) => m.text)).toEqual(['BOUGHT', '2R', '4R'])
    expect(tradeMarkers({ ...plan, trim_r: [3.0, 5.0] }, bars, n).map((m) => m.text)).toEqual(['BOUGHT', '3R', '5R'])
    expect(tradeMarkers({ ...plan, trim_r: null }, bars, n).map((m) => m.text)).toEqual(['BOUGHT', '3R', '5R'])
  })

  it('marks each action at its own bar: bought under the signal, the trims over the bar they traded', () => {
    const out = tradeMarkers(plan, bars, n)
    expect(out.map((m) => [m.time, m.text, m.position])).toEqual([
      [bars[n - 1].t, 'BOUGHT', 'belowBar'], [bars[n + 2].t, '3R', 'aboveBar'], [bars[n + 2].t, '5R', 'aboveBar'],
    ])
  })

  it('marks only what the replay has drawn so far', () => {
    expect(tradeMarkers(plan, bars.slice(0, n), n).map((m) => m.text)).toEqual(['BOUGHT'])
    expect(tradeMarkers(plan, bars.slice(0, n + 3), n).map((m) => m.text)).toEqual(['BOUGHT', '3R', '5R'])
  })

  it('marks the stop, and mirrors a short', () => {
    const stopped = { ...plan, t1At: null, t2At: null, stoppedSession: 2 }
    expect(tradeMarkers(stopped, bars, n).map((m) => [m.text, m.position, m.shape])).toEqual([['BOUGHT', 'belowBar', 'arrowUp'], ['STOPPED', 'belowBar', 'square']])
    const short = { ...plan, long: false, t1At: 1, t2At: null }
    expect(tradeMarkers(short, bars, n).map((m) => [m.text, m.position])).toEqual([['SHORTED', 'aboveBar'], ['3R', 'belowBar']])
  })

  it('a signal-only trade marks where it broke its line; no trade marks nothing', () => {
    expect(tradeMarkers({ kind: 'signal', short: false, broke: 2 }, bars, n).map((m) => m.text)).toEqual(['CLOSED UNDER'])
    expect(tradeMarkers(null, bars, n)).toBe(null)
  })
})

// The Study screen check (2026-11-14, MU on a phone): stopped the day after the buy, the red STOPPED square printed on the
// BOUGHT text, both under neighbouring bars. A mark whose word would overlap an earlier one at the chart's scale moves to
// the other side of its bar; with no clear side it keeps its shape and drops its word.
describe('the trade marks keep their words apart', () => {
  const stoppedNextDay = { ...plan, t1At: null, t2At: null, stoppedSession: 1 }

  it('STOPPED a day after BOUGHT moves above its bar when the words would overlap', () => {
    const out = tradeMarkers(stoppedNextDay, bars, n, { near: 12 })
    expect(out.map((m) => [m.text, m.time, m.position])).toEqual([['BOUGHT', bars[n - 1].t, 'belowBar'], ['STOPPED', bars[n].t, 'aboveBar']])
  })

  it('leaves marks far enough apart where they are, and the old call (no gap) unchanged', () => {
    const later = { ...plan, t1At: null, t2At: null, stoppedSession: 9 }
    expect(tradeMarkers(later, bars, n, { near: 4 }).map((m) => m.position)).toEqual(['belowBar', 'belowBar'])
    expect(tradeMarkers(stoppedNextDay, bars, n).map((m) => m.position)).toEqual(['belowBar', 'belowBar'])
  })

  it('3R and 5R on one bar stack (the chart does it), and a mark with no clear side keeps its shape without a word', () => {
    expect(tradeMarkers(plan, bars, n, { near: 12 }).map((m) => [m.text, m.position])).toEqual([['BOUGHT', 'belowBar'], ['3R', 'aboveBar'], ['5R', 'aboveBar']])
    const crowded = { ...plan, t1At: 1, t2At: null, stoppedSession: 2 }
    const out = tradeMarkers(crowded, bars, n, { near: 12 })
    expect(out.map((m) => [m.text, m.shape])).toEqual([['BOUGHT', 'arrowUp'], ['3R', 'circle'], ['', 'square']])
  })

  it('the gap is about 56 px of word in the bars of the frame: a phone needs more bars than a desktop', () => {
    expect(markerGapBars(170, 258)).toBe(37)
    expect(markerGapBars(170, 640)).toBe(15)
    expect(markerGapBars(0, 640)).toBe(0)
  })
})

// The same check: the level lines were short unlabeled stubs and the entry and the stop merged into one band. The ray's
// own price chip sat at its start and was dropped whenever two levels were close; the levels now print on the price axis.
describe('the levels on the price axis', () => {
  it('one line-less axis tag per level, priced and coloured as the rays, named in the chart key\'s words', () => {
    const tags = tradeLevelLines(plan)
    const rays = tradeAnnotations(plan, bars[n - 1], bars)
    expect(tags.map((t) => [t.title, t.price])).toEqual([['ENTRY', 110.5], ['STOP', 108.5], ['3R', 114.5], ['5R', 116.5]])
    expect(tags.map((t) => t.color)).toEqual(rays.map((r) => r.color))
    expect(tags.every((t) => t.lineVisible === false && t.axisLabelVisible === true)).toBe(true)
    // a dark chip with the level's ink, never the solid fill of the chart's own last-price tag
    expect(tags.every((t) => /^#/.test(t.axisLabelColor) && t.axisLabelColor !== t.color && /^#/.test(t.axisLabelTextColor))).toBe(true)
    expect(tradeLevelLines(plan, { titles: false }).map((t) => t.title)).toEqual(['', '', '', ''])
    expect(tradeLevelLines({ ...plan, long: false }).map((t) => t.title)[0]).toBe('SHORT')
    expect(tradeLevelLines(null)).toBe(null)
  })

  it('a surface with the axis tags draws the rays without their own chip, and can stop them at a bar', () => {
    expect(tradeAnnotations(plan, bars[n - 1], bars).every((a) => a.showPriceLabel === true)).toBe(true)
    const bare = tradeAnnotations(plan, bars[n - 1], bars, { chips: false, endAt: bars[n + 5].t })
    expect(bare.every((a) => a.showPriceLabel === false && a.rightBoundTime === bars[n + 5].t)).toBe(true)
    expect(tradeAnnotations(plan, bars[n - 1], bars, { chips: false }).some((a) => 'rightBoundTime' in a)).toBe(false)
  })
})
