import { describe, it, expect } from 'vitest'
import { followAppTheme, followOpts, appLook } from './drillTheme'

const board = () => ({
  widgets: [
    { id: 'drill-list', opts: { source: 'breadthDrill' } },
    { id: 'drill-chart', opts: { settings: { background: '#000000', candles: { upColor: '#00ff00', downColor: '#ff0000' } } } },
  ],
})

describe('drill window follows the app theme', () => {
  it('skins the chart and the list with the app theme', () => {
    const b = followAppTheme(board(), 'uct:slate', {})
    const slate = appLook('uct:slate')
    const chart = b.widgets[1].opts
    const list = b.widgets[0].opts
    expect(chart.settings.candles.upColor).toBe(slate.up)
    expect(chart.settings.background).toBe(slate.bg)
    expect(list.settings.upColor).toBe(slate.up)
    expect(list.settings.downColor).toBe(slate.down)
    expect(list.source).toBe('breadthDrill')
    expect(chart.look.app).toBe('uct:slate')
  })

  it('returns the same board when already following', () => {
    const b = followAppTheme(board(), 'uct:slate', {})
    expect(followAppTheme(b, 'uct:slate', {})).toBe(b)
  })

  it('re-skins on an app theme switch', () => {
    const b = followAppTheme(followAppTheme(board(), 'uct:slate', {}), 'light', {})
    expect(b.widgets[1].opts.settings.candles.upColor).toBe(appLook('light').up)
  })

  it('editing indicators does not stop following', () => {
    const o = followOpts({}, false, 'uct:slate', { overlays: [] })
    const edited = { ...o, settings: { ...o.settings, overlays: [{ period: 10 }] } }
    const again = followOpts(edited, false, 'light', {})
    expect(again.lookManual).toBeUndefined()
    expect(again.settings.candles.upColor).toBe(appLook('light').up)
  })

  it('a member-picked look sticks across app theme switches', () => {
    const o = followOpts({}, false, 'uct:slate', {})
    const mine = { ...o, settings: { ...o.settings, candles: { ...o.settings.candles, upColor: '#123456' } } }
    const marked = followOpts(mine, false, 'uct:slate', {})
    expect(marked.lookManual).toBe(true)
    const later = followOpts(marked, false, 'light', {})
    expect(later).toBe(marked)
    expect(later.settings.candles.upColor).toBe('#123456')
  })
})
