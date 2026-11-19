// The paint log (2026-11-19): a bounded ring of updateChart passes for live measurement.
import { describe, it, expect, beforeEach } from 'vitest'
import { recordPaint } from './paintLog'

describe('recordPaint', () => {
  beforeEach(() => { delete window.__uctPaints })

  it('records each pass with its plan', () => {
    recordPaint('AAA', '60', 100, 'full')
    recordPaint('AAA', '60', 100, 'incr')
    expect(window.__uctPaints.map((p) => p.mode)).toEqual(['full', 'incr'])
    expect(window.__uctPaints[0]).toMatchObject({ sym: 'AAA', tf: '60', bars: 100 })
  })

  it('keeps only the newest 120', () => {
    for (let i = 0; i < 300; i++) recordPaint('AAA', '60', i, 'noop')
    expect(window.__uctPaints.length).toBe(120)
    expect(window.__uctPaints[119].bars).toBe(299)
  })
})
