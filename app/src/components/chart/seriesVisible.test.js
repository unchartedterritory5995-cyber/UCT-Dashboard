// ⭐⭐ (switch smoothness, 2026-11-20) `setSeriesVisible`: a series already showing the value asked for is left alone
// (no `applyOptions`, which recomputes the whole chart); every other series is set exactly as before.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { setSeriesVisible } from './seriesVisible'

/** A series double that keeps its options as lightweight-charts does (`options()` reads them back). */
function seriesWith(options) {
  const calls = []
  const opts = { ...options }
  return {
    calls,
    options: () => ({ ...opts }),
    applyOptions: (o) => { calls.push(o); Object.assign(opts, o) },
  }
}

describe('setSeriesVisible', () => {
  it('already showing the value asked for: nothing is applied', () => {
    for (const v of [true, false]) {
      const s = seriesWith({ visible: v, color: '#fff' })
      setSeriesVisible(s, v)
      expect(s.calls).toEqual([])
    }
  })
  it('showing the other value: exactly `{visible}` is applied, and it then shows it', () => {
    for (const v of [true, false]) {
      const s = seriesWith({ visible: !v })
      setSeriesVisible(s, v)
      expect(s.calls).toEqual([{ visible: v }])
      expect(s.options().visible).toBe(v)
    }
  })
  it('a series that cannot say what it shows is set, as before; none, or a disposed one, is a no-op that never throws', () => {
    const calls = []
    setSeriesVisible({ applyOptions: (o) => calls.push(o) }, true)
    expect(calls).toEqual([{ visible: true }])
    const blank = seriesWith({})
    setSeriesVisible(blank, true)
    expect(blank.calls, 'an option it does not report is not assumed').toEqual([{ visible: true }])
    expect(() => setSeriesVisible(null, true)).not.toThrow()
    expect(() => setSeriesVisible({ options: () => { throw new Error('disposed') }, applyOptions: () => {} }, true)).not.toThrow()
  })
  it('the chart\'s "Group only" effect sets visibility through it, for every series it reaches', () => {
    const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'StockChart.jsx'), 'utf8')
    const at = src.indexOf('const vis = !hideBase')
    expect(at).toBeGreaterThan(0)
    const effect = src.slice(at, src.indexOf('}, [hideBase, chartReady', at)).replace(/^\s*\/\/.*$/gm, '')
    expect(effect).toMatch(/const setVis = \(s\) => setSeriesVisible\(s, vis\)/)
    expect(effect.includes('applyOptions'), 'a second path that applies options directly').toBe(false)
  })
})
