// Chart header built-in colours (owner 11-16): with nothing saved the ticker title is WHITE (not gold) and the day
// change takes the chart's candle up / down colours; a saved colour always wins. Synthetic settings only.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { headerColors, HEADER_TITLE_WHITE } from './headerDefaultColors'
import { CHART_DEFAULTS, mergeChartSettings } from '../chartDefaults'
import ChartIdentityRow from './ChartIdentityRow'

const styles = new Proxy({}, { get: (_, k) => String(k) })

describe('headerColors — defaults', () => {
  it('nothing saved → white title, the chart candle up / down colours for the day change', () => {
    const cs = { candles: { upColor: '#112233', downColor: '#445566' }, header: {} }
    expect(headerColors(cs)).toEqual({ title: HEADER_TITLE_WHITE, dayChangeUp: '#112233', dayChangeDown: '#445566' })
    expect(HEADER_TITLE_WHITE).toBe('#ededed')
  })
  it('the merged UCT default chart → its default candle colours, never the old #1ae51a / #ff3b47 or gold', () => {
    const c = headerColors(mergeChartSettings({}))
    expect(c.dayChangeUp).toBe(CHART_DEFAULTS.candles.upColor)
    expect(c.dayChangeDown).toBe(CHART_DEFAULTS.candles.downColor)
    expect(c.title).not.toBe('#c9a84c')
    expect([c.dayChangeUp, c.dayChangeDown]).not.toContain('#1ae51a')
    expect([c.dayChangeUp, c.dayChangeDown]).not.toContain('#ff3b47')
  })
  it('no settings at all → still white + the default candle colours', () => {
    expect(headerColors(undefined)).toEqual({
      title: HEADER_TITLE_WHITE, dayChangeUp: CHART_DEFAULTS.candles.upColor, dayChangeDown: CHART_DEFAULTS.candles.downColor,
    })
  })
  it('Sunrise keeps its dark inks for the bright header', () => {
    const c = headerColors({ candles: { upColor: '#112233', downColor: '#445566' } }, 'sunrise')
    expect(c.dayChangeUp).toBe('#0a5c22')
    expect(c.dayChangeDown).toBe('#7d1620')
    expect(c.title).not.toBe(HEADER_TITLE_WHITE)
  })
})

describe('headerColors — a saved colour wins', () => {
  it('saved title / up / down beat every default, on every theme', () => {
    const cs = { candles: { upColor: '#112233', downColor: '#445566' }, header: { colors: { title: '#abcdef', dayChangeUp: '#00ff00', dayChangeDown: '#ff0000' } } }
    for (const theme of [undefined, 'default', 'sunrise']) {
      expect(headerColors(cs, theme)).toEqual({ title: '#abcdef', dayChangeUp: '#00ff00', dayChangeDown: '#ff0000' })
    }
  })
})

describe('the identity row paints the default title without marking it custom', () => {
  it('static label: default ink when nothing saved; the saved colour when set', () => {
    const { rerender } = render(<ChartIdentityRow sym="AAA" displayLabel="AAA" styles={styles} defaultLabelColor="#ededed" />)
    expect(screen.getByTestId('sym-label').style.color).toBe('rgb(237, 237, 237)')
    rerender(<ChartIdentityRow sym="AAA" displayLabel="AAA" styles={styles} labelColor="#abcdef" defaultLabelColor="#ededed" />)
    expect(screen.getByTestId('sym-label').style.color).toBe('rgb(171, 205, 239)')
  })
})

describe('wiring: ChartPane and the Chart Settings swatches read the one authority', () => {
  const read = (rel) => fs.readFileSync(path.resolve(globalThis.process.cwd(), rel), 'utf8')
  it('ChartPane hands headerColors to the identity row (no hard-coded #1ae51a / #ff3b47 fallbacks)', () => {
    const src = read('src/components/chart/pane/ChartPane.jsx')
    expect(src).toMatch(/headerColors\(chartCs, resolvedTheme\)/)
    expect(src).toMatch(/defaultLabelColor=\{_hdrInk\.title\}/)
    expect(src).toMatch(/up: _hdrInk\.dayChangeUp/)
    expect(src).toMatch(/down: _hdrInk\.dayChangeDown/)
    expect(src).not.toMatch(/'#1ae51a'\),\s*\r?\n\s*down: hdrColors\.dayChangeDown/)
  })
  it('the Header & legend swatches show the same defaults', () => {
    const src = read('src/components/chart/ChartSettingsModal.jsx')
    expect(src).toMatch(/case 'hdrTitle': return headerColors\(settings\)\.title/)
    expect(src).toMatch(/case 'hdrDayUp': return headerColors\(settings\)\.dayChangeUp/)
    expect(src).toMatch(/case 'hdrDayDown': return headerColors\(settings\)\.dayChangeDown/)
  })
})
