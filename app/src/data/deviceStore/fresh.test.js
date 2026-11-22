// @vitest-environment node
// A device copy the handoff commits on must be one the CHART then paints. For a daily chart during the session the
// chart has its own age rule for a today-dated bar (utils/marketSession.isDailyTodayBarStaleForPaint, read by
// components/chart/useBarSnapshotBars with the copy's saved time = its `through`). The device rule allowed
// DEVICE_FRESH_MS (120 s) where the chart allows 90: a daily copy 90-120 s old committed and was then refused, a
// blank chart for the new symbol (review of #2407). The rail asks the chart's own function, never a number.
import { describe, it, expect } from 'vitest'
import { deviceCopyFresh, DEVICE_FRESH_MS } from './fresh'
import { isDailyTodayBarStaleForPaint } from '../../utils/marketSession'

const NOW = Date.UTC(2026, 10, 18, 16, 31)               // Wed 2026-11-18 11:31 ET: the session is open
const SEC = Math.floor(NOW / 1000)
const TODAY = '2026-11-18'

describe('a daily device copy is fresh only while the chart would paint it', () => {
  it('mid-session, at every age: fresh by the device rule implies paintable by the chart\'s daily gate', () => {
    let fresh = 0, refused = 0
    for (let age = 0; age <= 180; age += 5) {
      const through = SEC - age
      const chartRefuses = isDailyTodayBarStaleForPaint(TODAY, through * 1000, NOW)
      for (const tf of ['D', 'W', 'M']) {
        if (deviceCopyFresh(through, tf, NOW)) { fresh++; expect(chartRefuses, `${tf} copy ${age} s old`).toBe(false) }
      }
      if (chartRefuses) refused++
    }
    expect(fresh).toBeGreaterThan(0)                      // not vacuous: young copies are fresh...
    expect(refused).toBeGreaterThan(0)                    // ...and the sweep reaches ages the chart refuses
  })

  it('a copy the chart still paints is not refused by the device rule (the bound is the chart\'s, not a tighter one)', () => {
    for (let age = 0; age <= 180; age += 5) {
      const through = SEC - age
      if (!isDailyTodayBarStaleForPaint(TODAY, through * 1000, NOW) && age * 1000 <= DEVICE_FRESH_MS) {
        expect(deviceCopyFresh(through, 'D', NOW), `D copy ${age} s old`).toBe(true)
      }
    }
  })

  it('intraday copies keep DEVICE_FRESH_MS (the chart has no such gate for them)', () => {
    expect(deviceCopyFresh(SEC - (DEVICE_FRESH_MS / 1000 - 5), '5', NOW)).toBe(true)
    expect(deviceCopyFresh(SEC - (DEVICE_FRESH_MS / 1000 + 5), '5', NOW)).toBe(false)
  })
})
