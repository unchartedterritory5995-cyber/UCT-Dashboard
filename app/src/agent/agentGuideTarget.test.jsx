// UCT Agent Phase 2 — LIVE ACCEPTANCE, 2026-10-29, D3: "Show me how to change the timeframe" highlighted the WHOLE chart
// toolbar row (date, market cap, earnings, ratings, settings…). Root cause: the guide's `chart.timeframe` target sat on
// ChartTfBar's root, and ChartPane renders the row's other controls as that root's children. The target is now a group
// of the timeframe buttons and the ⌄ arrow only; the highlight is clipped to what the row shows.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import ChartTfBar from '../components/chart/pane/ChartTfBar'
import styles from '../pages/charts/ChartsWorkspace.module.css'
import { findTarget, rectOf } from './guide/targets'

afterEach(() => cleanup())

const TFS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M']]
// the row as ChartPane builds it: the timeframes, then its own controls as children
const row = () => (
  <ChartTfBar tf="D" visibleTfs={TFS} onTf={() => {}} styles={styles}>
    <button type="button">Oct 29, 2026</button>
    <span>Mkt Cap 4.1T</span>
    <span>Earnings Nov 19</span>
    <span>Ratings</span>
    <button type="button" data-guide="chart.settings" aria-label="Chart settings">⚙</button>
  </ChartTfBar>
)
// a laid-out box for jsdom (no layout engine): getBoundingClientRect / getClientRects of one element
const box = (el, { left, top = 100, width, height = 24 }) => {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
  el.getClientRects = () => [el.getBoundingClientRect()]
}

describe('D3 · the timeframe target is the timeframe controls only', () => {
  it('holds every timeframe button and the ⌄ arrow — and none of the row\'s other controls', () => {
    const { container } = render(row())
    const t = container.querySelector('[data-guide="chart.timeframe"]')
    expect(t).toBeTruthy()
    expect([...t.querySelectorAll('button')].map(b => b.textContent || b.getAttribute('aria-label'))).toEqual(['1m', '5m', '15m', '30m', '1h', '1D', '1W', '1M', 'More timeframes'])
    expect(t.querySelector('[data-guide="chart.timeframeMore"]')).toBeTruthy()
    for (const other of ['Oct 29, 2026', 'Mkt Cap 4.1T', 'Earnings Nov 19', 'Ratings']) expect(t.textContent).not.toContain(other)
    expect(t.querySelector('[data-guide="chart.settings"]')).toBeNull()
    // the row itself is no longer a target (it is the whole toolbar line)
    expect(container.querySelectorAll('[data-guide="chart.timeframe"]')).toHaveLength(1)
    expect(t.parentElement.className).toBe(styles.tfBar)
  })

  it('the bar still overflows as before (the group never shrinks), so a narrow chart still sheds buttons into ⌄', () => {
    const { container } = render(row())
    const t = container.querySelector('[data-guide="chart.timeframe"]')
    expect(t.style.flex).toMatch(/^0 0 auto/)
    expect(t.style.display).toBe('flex')
  })

  it('on a board of several charts the step points at the chart being talked about', () => {
    const { container } = render(
      <div>
        <div data-widget-id="c1">{row()}</div>
        <div data-widget-id="c2">{row()}</div>
      </div>,
    )
    const [a, b] = container.querySelectorAll('[data-guide="chart.timeframe"]')
    box(a, { left: 10, width: 300 }); box(b, { left: 650, width: 300 })
    expect(findTarget('chart.timeframe', { chartRef: 'c2' })).toBe(b)
    expect(findTarget('chart.timeframe', { chartRef: 'c1~tab2' })).toBe(a)
  })

  it('the highlight is the group\'s own box, clipped to the row when a narrow chart clips it (no fixed offsets)', () => {
    const { container } = render(row())
    const t = container.querySelector('[data-guide="chart.timeframe"]')
    const bar = t.parentElement
    bar.style.overflow = 'hidden'
    box(bar, { left: 0, width: 900 })
    box(t, { left: 6, width: 420 })
    expect(rectOf(t)).toEqual({ top: 96, left: 2, width: 428, height: 32 })          // the group, 4px of room around it
    box(bar, { left: 0, width: 250 })                                                // a narrow chart: the row clips at 250
    expect(rectOf(t)).toEqual({ top: 96, left: 2, width: 252, height: 32 })
    bar.style.overflow = 'visible'
    expect(rectOf(t).width).toBe(428)                                                // nothing clips it: its own box
  })
})
