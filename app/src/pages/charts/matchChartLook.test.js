import { describe, it, expect } from 'vitest'
import {
  matchChartOn, leadChartWidget, chartLookTheme, leadChartLook, editsOwnLook,
  applyLookToWidgets, globalPrefWrites, followingTypes,
} from './matchChartLook'
import { paintedSurface } from './uctSurface'

const gradChart = (id, x, y, top = '#0c3a30', bottom = '#0a1838') => ({
  id, type: 'chart', x, y,
  opts: { settings: { bgMode: 'gradient', background: bottom, bgGradient: { top, bottom }, candles: { upColor: '#26a69a', downColor: '#ef5350' } } },
})

describe('matchChartLook', () => {
  it('is ON by default; only a recorded off turns it off', () => {
    expect(matchChartOn({})).toBe(true)
    expect(matchChartOn({ widgets: [] })).toBe(true)
    expect(matchChartOn({ matchChart: { on: true } })).toBe(true)
    expect(matchChartOn({ matchChart: { on: false } })).toBe(false)
    expect(matchChartOn(null)).toBe(false)
  })

  it('follows the named chart, else the top-left one', () => {
    const a = gradChart('a', 6, 0), b = gradChart('b', 0, 0), c = gradChart('c', 0, 8)
    expect(leadChartWidget([a, b, c], 'c').id).toBe('c')
    expect(leadChartWidget([a, b, c], 'gone').id).toBe('b')
    expect(leadChartWidget([{ id: 'w', type: 'watchlist' }], null)).toBe(null)
  })

  it('reads a gradient chart as a gradient look with its up/down colours', () => {
    const t = chartLookTheme(gradChart('a', 0, 0).opts.settings)
    expect(t.bgGradient).toEqual({ top: '#0c3a30', bottom: '#0a1838' })
    expect(t.up).toBeTruthy()
    expect(t.down).toBeTruthy()
  })

  it('paints following widgets and leaves own-look widgets and charts alone', () => {
    const layout = {
      matchChart: { on: true, chartId: 'a' },
      widgets: [
        gradChart('a', 0, 0),
        { id: 'w', type: 'watchlist', opts: {} },
        { id: 'n', type: 'news', opts: { ownLook: true, settings: { bg: '#123456' } } },
        { id: 's', type: 'watchlist', opts: {}, wtabs: [{ id: 't1', type: 'calendar', opts: {} }] },
      ],
    }
    const theme = leadChartLook(layout, {})
    const out = applyLookToWidgets(layout.widgets, theme)
    expect(out[0]).toBe(layout.widgets[0])
    expect(out[1].opts.settings.bgMode).toBe('gradient')
    expect(out[1].opts.settings.bgGradient.top).toBe('#0c3a30')
    expect(out[2]).toBe(layout.widgets[2])
    expect(out[3].wtabs[0].opts.settings.bgGradient.top).toBe('#0c3a30')
    // idempotent: a second pass changes nothing (so the sync can't loop on its own save)
    expect(applyLookToWidgets(out, theme)).toBe(out)
  })

  it('writes the global-pref widgets only when their look (or app-theme stamp) differs', () => {
    const widgets = [gradChart('a', 0, 0), { id: 't', type: 'themes', opts: {} }, { id: 'f', type: 'fundamentals', opts: { ownLook: true } }]
    const theme = chartLookTheme(widgets[0].opts.settings)
    const first = globalPrefWrites(widgets, theme, () => null, 'graphite')
    expect(Object.keys(first)).toEqual(['theme_tracker_settings'])
    expect(first.theme_tracker_settings.bgGradient.top).toBe('#0c3a30')
    expect(first.theme_tracker_settings._appTheme).toBe('graphite')
    const again = globalPrefWrites(widgets, theme, () => first.theme_tracker_settings, 'graphite')
    expect(again).toEqual({})
    expect(Object.keys(globalPrefWrites(widgets, theme, () => first.theme_tracker_settings, 'light'))).toEqual(['theme_tracker_settings'])
    expect([...followingTypes(widgets)]).toEqual(['themes'])
  })

  it('counts only colour edits as a widget taking its own look', () => {
    expect(editsOwnLook({ bg: '#000' }, { bg: '#111' })).toBe(true)
    expect(editsOwnLook({ bg: '#000', fontSize: 12 }, { bg: '#000', fontSize: 14 })).toBe(false)
  })
})

describe('paintedSurface (UCT header colour)', () => {
  it('reads a gradient canvas by its top stop instead of a hidden toast below it', () => {
    const body = document.createElement('div')
    const page = document.createElement('div')
    page.style.backgroundImage = 'linear-gradient(rgb(12, 58, 48) 0%, rgb(10, 24, 56) 100%)'
    const toast = document.createElement('div')
    toast.style.backgroundColor = 'rgba(12, 12, 12, 0.92)'
    page.appendChild(toast)
    body.appendChild(page)
    document.body.appendChild(body)
    expect(paintedSurface(body)).toBe('rgb(12, 58, 48)')
    body.remove()
  })

  it('still reads a solid canvas', () => {
    const body = document.createElement('div')
    const page = document.createElement('div')
    page.style.backgroundColor = 'rgb(23, 24, 27)'
    body.appendChild(page)
    document.body.appendChild(body)
    expect(paintedSurface(body)).toBe('rgb(23, 24, 27)')
    body.remove()
  })
})
