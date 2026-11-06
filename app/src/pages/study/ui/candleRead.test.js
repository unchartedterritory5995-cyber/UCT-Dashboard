import { describe, it, expect } from 'vitest'
import { readCandle, readText, readTone } from './candleRead'

const flat = (n, v = 1000) => Array.from({ length: n }, (_, i) => ({ t: 20250101 + i, o: 100, h: 101, l: 99, c: 100, v }))

describe('readCandle: the last candle measured against yesterday', () => {
  it('reads an oops-shaped candle: opened under the close, undercut the low, closed back over the close', () => {
    const bars = [...flat(30), { t: 20250301, o: 99.5, h: 101.2, l: 98.2, c: 100.6, v: 2500 }]
    const r = Object.fromEntries(readCandle(bars).map((x) => [x.id, x]))
    expect(readText(r.open)).toBe('−0.50%')
    expect(readText(r.low)).toBe('−0.81%')
    expect(readText(r.close)).toBe('+0.60%')
    expect(readText(r.high)).toBe('−0.40%')
    expect(r.high.label).toBe('Close vs high')
    expect(readText(r.range)).toBe('80% up')
    expect(readText(r.volume)).toBe('2.5x')
    expect(r.volume.note).toBe('vs its 30-day average')
    expect(readTone(r.open)).toBe('down')
    expect(readTone(r.close)).toBe('up')
    expect(readTone(r.volume)).toBe('heavy')
  })
  it('needs a prior bar, and leaves volume out without ten sessions to average', () => {
    expect(readCandle([])).toEqual([])
    expect(readCandle(flat(1))).toEqual([])
    expect(readCandle(flat(5)).map((x) => x.id)).not.toContain('volume')
  })
})
