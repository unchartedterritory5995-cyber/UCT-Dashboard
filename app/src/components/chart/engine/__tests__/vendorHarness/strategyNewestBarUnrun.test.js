// app/src/components/chart/engine/__tests__/vendorHarness/strategyNewestBarUnrun.test.js
//
// ⭐ THE BARS TRADINGVIEW'S STRATEGY RAN ON (`strategyHarness.barsTradingViewRan`). 2026-11-16: every strategy
// capture of the night held 667 bars and 666 value rows (the 11-16 bar, after the session, not yet run by
// TradingView's strategy), and the grade read our extra bar as "667 bars of ours against 666". The rule hands
// our run exactly the bars TradingView's ran, ONLY when its value rows are the capture's bars but the newest,
// time for time; every other difference stays the grade's to call.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { barsTradingViewRan, gradeStrategyCapture } from './strategyHarness'

const T0 = 1711027800
const DAY = 86400
const bar = (i) => [T0 + i * DAY, 10 + i, 11 + i, 9 + i, 10.5 + i, 1000 + i]
const capture = (nBars, rowTimes) => ({
  bars: { timeUnit: 'unix-s', fields: ['time', 'open', 'high', 'low', 'close', 'volume'], rows: Array.from({ length: nBars }, (_, i) => bar(i)) },
  plotValues: { fields: ['time', 'plot_0'], rows: rowTimes.map((t) => [t, 1]) },
})
const times = (n) => Array.from({ length: n }, (_, i) => T0 + i * DAY)

describe('barsTradingViewRan', () => {
  it('value rows = every bar but the newest: our run gets those bars, the newest is named unrun', () => {
    const r = barsTradingViewRan(capture(30, times(29)))
    expect(r.bars).toHaveLength(29)
    expect(r.bars[28].t).toBe(T0 + 28 * DAY)
    expect(r.unrun).toBe(T0 + 29 * DAY)
  })

  it('CONTROL: value rows on every bar leave the bars as they are', () => {
    const r = barsTradingViewRan(capture(30, times(30)))
    expect(r.bars).toHaveLength(30)
    expect(r.unrun).toBeNull()
  })

  it('⛔ a bar missing anywhere but the newest is NOT taken away (the grade calls it)', () => {
    const t = times(30)
    t.splice(12, 1)                       // 29 rows, the gap in the middle
    const r = barsTradingViewRan(capture(30, t))
    expect(r.bars).toHaveLength(30)
    expect(r.unrun).toBeNull()
  })

  it('⛔ two bars short is NOT taken away either (only the one bar a strategy has not run)', () => {
    const r = barsTradingViewRan(capture(30, times(28)))
    expect(r.bars).toHaveLength(30)
    expect(r.unrun).toBeNull()
  })

  it('⛔ a value row on a time the bars do not hold is NOT taken as the newest bar unrun', () => {
    const t = times(29)
    t[5] += 60
    expect(barsTradingViewRan(capture(30, t)).unrun).toBeNull()
  })
})

describe('the three captures held out of #1505 grade MATCH on the bars TradingView ran', () => {
  const DIR = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness')
  for (const id of ['w9-d11-late-first-use-rpt-rddt-1d-2026-11-16', 'w9-mk1-markers-rddt-1d-2026-11-16',
    'w9-mk1-markers-rpt-rddt-1d-2026-11-16']) {
    it(`${id}: MATCH, values graded, the 11-16 bar named unrun`, () => {
      const c = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'))
      expect(c.bars.rows).toHaveLength(667)
      expect(c.plotValues.rows).toHaveLength(666)
      const g = gradeStrategyCapture(c)
      expect(g.verdict, g.reason).toBe('MATCH')
      expect(g.graded.values).toBeGreaterThan(0)
      expect(g.newestBarNotRun).toBe(c.bars.rows[666][0])
    }, 120000)
  }
})
