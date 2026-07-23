import { describe, it, expect } from 'vitest'
import { widgetOwnChrome, canvasEntry } from './widgetChrome'
import { addChartTab } from './chartTabs'

describe('widgetOwnChrome — per-widget chrome isolation', () => {
  it('returns null for a widget that has not diverged (uses type default)', () => {
    expect(widgetOwnChrome({ type: 'chart', opts: {} }, null)).toBeNull()
    expect(widgetOwnChrome({ type: 'watchlist', opts: {} }, null)).toBeNull()
    expect(widgetOwnChrome({ type: 'chart', opts: { tf: 'D' } }, null)).toBeNull()
  })

  it('derives a chart widget canvas from its own main-tab settings', () => {
    const w = { type: 'chart', opts: { settings: { background: '#123456', bgMode: 'solid' } } }
    const entry = widgetOwnChrome(w, null)
    expect(entry).toBeTruthy()
    expect(entry.canvas).toBe('#123456')
  })

  it('two chart widgets with different canvases produce different chrome (isolation)', () => {
    const a = widgetOwnChrome({ type: 'chart', opts: { settings: { background: '#000000', bgMode: 'solid' } } }, null)
    const b = widgetOwnChrome({ type: 'chart', opts: { settings: { background: '#ffffff', bgMode: 'solid' } } }, null)
    expect(a.canvas).toBe('#000000')
    expect(b.canvas).toBe('#ffffff')
    expect(a.canvas).not.toBe(b.canvas)
  })

  it('a chart widget follows its ACTIVE extra tab canvas', () => {
    let opts = { settings: { background: '#111111', bgMode: 'solid' } }
    opts = addChartTab(opts, { color: 'A', tf: '30' }) // active → the new tab
    opts.chartTabs[0].settings.background = '#abcdef'
    opts.chartTabs[0].settings.bgMode = 'solid'
    const entry = widgetOwnChrome({ type: 'chart', opts }, null)
    expect(entry.canvas).toBe('#abcdef') // the active tab's canvas, not main's
  })

  it('sunrise theme forces the light chart canvas regardless of stored bg', () => {
    const w = { type: 'chart', opts: { settings: { background: '#000000', bgMode: 'solid' } } }
    expect(widgetOwnChrome(w, 'sunrise').canvas).toBe('#eaf1fa')
  })

  it('derives a watchlist widget canvas + mirrors its gridline override', () => {
    const w = { type: 'watchlist', opts: { settings: { bg: '#0d1b2a', bgMode: 'solid', gridColor: '#ff0000' } } }
    const entry = widgetOwnChrome(w, null)
    expect(entry.canvas).toBe('#0d1b2a')
    expect(entry.divider).toBe('#ff0000')       // gridline override mirrored onto the chrome
    expect(entry.dividerStrong).toBe('#ff0000')
  })

  it('canvasEntry returns the derived chrome variable bundle', () => {
    const e = canvasEntry('#0e0f0d')
    expect(e.canvas).toBe('#0e0f0d')
    expect(e).toHaveProperty('divider')
    expect(e).toHaveProperty('chrome')
    expect(e).toHaveProperty('panel')
  })
})
