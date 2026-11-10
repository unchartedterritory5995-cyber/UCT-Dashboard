// The trade on the chart (2026-11-08, found on the phone screens: text boxes drawn on the chart ran under the price
// scale, landed on each other and floated away from their bar on a trend): the levels stay dashed lines; the action
// items are the chart's own bar markers, at their bar, only once the replay has drawn it.
import { describe, expect, it } from 'vitest'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'

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
