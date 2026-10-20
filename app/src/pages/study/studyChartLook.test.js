/**
 * studyChartLook rails — a Study chart is the HOUSE picture (owner 2026-10-20:
 * "this is not what our charts look like"), with the drill gates on top.
 */
import { describe, it, expect } from 'vitest'
import { studySettingsOverride } from './studyChartLook'
import { RENDER_VOL_PANE_PCT } from '../../components/chart/houseLook'
import { CHART_DEFAULTS } from '../../components/chart/chartDefaults'

const OWNER = {
  chartType: 'candles',
  background: '#0f0f0f',
  candles: { upColor: '#1ae51a', downColor: '#c41f2d' },
  volume: { visible: true, upColor: '#ffffff', downColor: '#ffffff', paneHeightPct: 22 },
  overlays: [
    { enabled: true, type: 'EMA', period: 9, color: '#4ade80' },
    { enabled: true, type: 'EMA', period: 20, color: '#f472b6' },
  ],
}

describe('studySettingsOverride', () => {
  it('draws the house look over the owner blob: hollow candles, slim volume pane, volume in the candle colours', () => {
    const cs = studySettingsOverride(null, OWNER)
    expect(cs.chartType).toBe('hollow')
    expect(cs.background).toBe('#0f0f0f')
    expect(cs.candles.upColor).toBe('#1ae51a')
    expect(cs.volume.visible).toBe(true)
    expect(cs.volume.paneHeightPct).toBe(RENDER_VOL_PANE_PCT)
    expect(cs.volume.upColor).toBe('#1ae51a')
    expect(cs.volume.downColor).toBe('#c41f2d')
  })

  it('keeps the owner averages and switches every feed off', () => {
    const cs = studySettingsOverride({ window_bars: 120, tf: 'D' }, OWNER)
    expect(cs.overlays.map((o) => o.period)).toEqual([9, 20])
    expect(cs.markers.news).toBe(false)
    expect(cs.markers.earnings).toBe(false)
    expect(cs.markers.desk).toBe(false)
    expect(cs.showPatterns).toBe(false)
    expect(cs.signature).toEqual({ darkPoolLevels: false, gexWalls: false, flowSignals: false })
    expect(cs.comparisonSymbols).toEqual([])
    expect(cs.prevDayLevels.high.enabled).toBe(false)
  })

  it('still applies the look with no owner blob (never waits on the lookup)', () => {
    const cs = studySettingsOverride(null, null)
    expect(cs.chartType).toBe('hollow')
    expect(cs.volume.paneHeightPct).toBe(RENDER_VOL_PANE_PCT)
    expect(cs.volume.upColor).toBe('#2faf68')
    expect(cs.overlays).toBeUndefined()      // the merge in StockChart supplies the defaults
  })

  it('an item can opt out of volume, switch the averages off, or name its own', () => {
    expect(studySettingsOverride({ volume: false }, OWNER).volume.visible).toBe(false)
    const off = studySettingsOverride({ overlays: false }, OWNER)
    expect(off.overlays.every((o) => o.enabled === false)).toBe(true)
    expect(off.overlays).toHaveLength(2)
    const none = studySettingsOverride({ overlays: false }, null)
    expect(none.overlays).toHaveLength(CHART_DEFAULTS.overlays.length)
    expect(none.overlays.every((o) => o.enabled === false)).toBe(true)
    const own = studySettingsOverride({ overlays: [{ enabled: true, type: 'SMA', period: 10 }] }, OWNER)
    expect(own.overlays).toEqual([{ enabled: true, type: 'SMA', period: 10 }])
  })

  it('is a pure function of its inputs (memo-safe)', () => {
    expect(studySettingsOverride({ volume: false }, OWNER)).toEqual(studySettingsOverride({ volume: false }, OWNER))
    expect(OWNER.volume.paneHeightPct).toBe(22)       // the owner blob is never mutated
    expect(OWNER.chartType).toBe('candles')
  })
})
