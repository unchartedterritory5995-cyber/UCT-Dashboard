import { describe, it, expect } from 'vitest'
import { readCandle, readText, readTone } from './candleRead'

const flat = (n, v = 1000, c = 100) => Array.from({ length: n }, (_, i) => ({ t: 20250101 + i, o: c, h: c + 1, l: c - 1, c, v }))

describe('readCandle: the last candle measured against yesterday, the high and the averages', () => {
  it('reads an oops-shaped candle: opened under the close, undercut the low, closed back over the close', () => {
    const bars = [...flat(30), { t: 20250301, o: 99.5, h: 101.2, l: 98.2, c: 100.6, v: 2500 }]
    const r = Object.fromEntries(readCandle(bars).map((x) => [x.id, x]))
    expect(readText(r.open)).toBe('−0.50%')
    expect(readText(r.low)).toBe('−0.81%')
    expect(readText(r.close)).toBe('+0.60%')
    expect(readText(r.range)).toBe('80% up')
    expect(readText(r.volume)).toBe('2.5x')
    expect(r.volume.note).toBe('vs its 30-day average')
    expect(readTone(r.open)).toBe('down')
    expect(readTone(r.close)).toBe('up')
    expect(readTone(r.volume)).toBe('heavy')
    // the chart's high is 101.2 (this bar); the close sits 0.59% under it, and the distance is never coloured
    expect(readText(r.offHigh)).toBe('−0.59%')
    expect(readTone(r.offHigh)).toBe('')
    expect(readText(r.vs20)).toBe('+0.54%')         // the 20-day EMA takes in today's close too: 100.057, as the chart's legend reads it
    expect(r.vs50).toBeUndefined()                  // 31 bars: no 50-day average yet
  })
  it('reads the 50-day once there are fifty closes', () => {
    const r = Object.fromEntries(readCandle([...flat(60), { t: 20250401, o: 100, h: 111, l: 99, c: 110, v: 1000 }]).map((x) => [x.id, x]))
    expect(readText(r.vs50)).toBe('+9.78%')         // the last 50 closes: 49 at 100 and this 110, an average of 100.2
  })
  it('needs a prior bar, and leaves volume out without ten sessions to average', () => {
    expect(readCandle([])).toEqual([])
    expect(readCandle(flat(1))).toEqual([])
    expect(readCandle(flat(5)).map((x) => x.id)).not.toContain('volume')
  })
})
