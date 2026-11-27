// The paint log (2026-11-19): a bounded ring of updateChart passes for live measurement.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { recordPaint, onChartPaint } from './paintLog'

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


// (2026-11-23) the same record is handed to ONE listener, for a chart that paints under an identity
// (PaintMemberContext): the switch-speed instrument (lib/switchSpeed.js).
describe("recordPaint hands a member chart's pass to the listener", () => {
  beforeEach(() => { delete window.__uctPaints })
  afterEach(() => { onChartPaint(null) })

  it('a pass with an identity reaches the listener with that identity; one without never does', () => {
    const seen = []
    onChartPaint((member, sym, bars, mode) => { seen.push([member, sym, bars, mode]) })
    const me = {}
    recordPaint('AAA', '60', 100, 'full')
    recordPaint('AAA', '60', 100, 'full', null)
    expect(seen).toEqual([])
    recordPaint('BBB', '60', 240, 'full', me)
    recordPaint('BBB', '60', 240, 'noop', me)
    expect(seen).toEqual([[me, 'BBB', 240, 'full'], [me, 'BBB', 240, 'noop']])
    expect(seen[0][0]).toBe(me)
    expect(window.__uctPaints).toHaveLength(4)          // the log itself is what it was: every pass, no identity in it
    expect(Object.keys(window.__uctPaints[2]).sort()).toEqual(['at', 'bars', 'mode', 'sym', 'tf'])
  })

  it('a listener that throws never costs the pass, and no listener is no call', () => {
    onChartPaint(() => { throw new Error('measurement') })
    expect(() => recordPaint('AAA', '60', 100, 'full', {})).not.toThrow()
    expect(window.__uctPaints).toHaveLength(1)
    onChartPaint(null)
    expect(() => recordPaint('AAA', '60', 100, 'full', {})).not.toThrow()
  })
})
