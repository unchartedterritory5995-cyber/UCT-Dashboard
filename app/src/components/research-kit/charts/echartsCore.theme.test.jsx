// The kit's ECharts host follows the member's theme: a CHART_INK dark literal or
// a `var(--token)` string in an option resolves to the LIVE token at render, and
// SeriesChart keeps every series colour readable on the live chart surface.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { contrastRatio } from '../../../lib/theme/resolveThemeColor'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return null },
}))

const { default: EChart, CHART_INK, themeOptionInks } = await import('./echartsCore')
const { default: SeriesChart } = await import('./SeriesChart')

const root = () => document.documentElement
const LIGHT = {
  '--text': '#1f2328', '--text-muted': '#57606a', '--text-bright': '#0b0e11',
  '--ut-gold': '#7a5c16', '--gain': '#1c7a45', '--bg-surface': '#f4f5f6', '--bg-elevated': '#ffffff',
}
function setLight() {
  root().setAttribute('data-theme', 'light')
  for (const [k, v] of Object.entries(LIGHT)) root().style.setProperty(k, v)
}
afterEach(() => { root().removeAttribute('data-theme'); root().removeAttribute('style'); captured = null })

describe('themeOptionInks', () => {
  it('is the identity when no token is set (jsdom, dark fallbacks)', () => {
    const opt = { xAxis: { axisLabel: { color: CHART_INK.muted } }, series: [{ lineStyle: { color: 'var(--ut-gold, #c9a84c)' } }] }
    const out = themeOptionInks(opt)
    expect(out.xAxis.axisLabel.color).toBe(CHART_INK.muted)
    expect(out.series[0].lineStyle.color).toBe('#c9a84c')
  })

  it('swaps dark literals and var() strings for the live light tokens', () => {
    setLight()
    const fmt = () => 'x'
    const out = themeOptionInks({
      xAxis: { axisLabel: { color: CHART_INK.muted, formatter: fmt } },
      series: [{ lineStyle: { color: 'var(--ut-gold, #c9a84c)' }, data: [1, 'Q1'] }],
      tooltip: { backgroundColor: CHART_INK.tooltipBg, textStyle: { color: CHART_INK.bright } },
    })
    expect(out.xAxis.axisLabel.color).toBe('#57606a')
    expect(out.xAxis.axisLabel.formatter).toBe(fmt)
    expect(out.series[0].lineStyle.color).toBe('#7a5c16')
    expect(out.series[0].data).toEqual([1, 'Q1'])
    expect(out.tooltip.backgroundColor).toBe('rgba(255, 255, 255, 0.97)')
    expect(out.tooltip.textStyle.color).toBe('#0b0e11')
  })
})

describe('EChart host re-renders on a theme change', () => {
  it('hands ECharts the new inks after data-theme + inline tokens change', async () => {
    const option = { xAxis: { axisLabel: { color: CHART_INK.muted } } }
    render(<EChart option={option} ariaLabel="x" />)
    expect(captured.option.xAxis.axisLabel.color).toBe(CHART_INK.muted)
    await act(async () => { setLight() })
    await act(async () => { await Promise.resolve() })
    expect(captured.option.xAxis.axisLabel.color).toBe('#57606a')
  })
})

describe('SeriesChart keeps series readable on the live surface', () => {
  it('darkens a pale palette entry on a light surface and resolves var() series', () => {
    setLight()
    render(<SeriesChart periods={['Q1', 'Q2', 'Q3']} mode="line" ariaLabel="x" series={[
      { name: 'Revenue', color: '#7ed957', values: [1, 2, 3] },
      { name: 'Consensus', color: 'var(--ut-gold, #c9a84c)', values: [1, 2, 3] },
    ]} />)
    const [rev, cons] = captured.option.series
    expect(contrastRatio(rev.lineStyle.color, LIGHT['--bg-surface'])).toBeGreaterThanOrEqual(3)
    expect(rev.lineStyle.color).not.toBe('#7ed957')
    expect(cons.lineStyle.color).toBe('#7a5c16')
  })

  it('leaves a palette that already reads on the dark ground unchanged', () => {
    render(<SeriesChart periods={['Q1', 'Q2', 'Q3']} mode="line" ariaLabel="x" series={[
      { name: 'Revenue', color: '#5aa9e6', values: [1, 2, 3] },
    ]} />)
    expect(captured.option.series[0].lineStyle.color).toBe('#5aa9e6')
  })
})
