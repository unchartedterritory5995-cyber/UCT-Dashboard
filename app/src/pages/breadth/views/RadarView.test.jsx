import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RadarView from './RadarView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getFmt: () => '75', drillKey: 'breadth_list' },
  { key: 'pct_above_50sma', label: '>50 SMA', getFmt: () => '58', drillKey: null },
  { key: 'vix', label: 'VIX', getFmt: () => '16', drillKey: null },
]
const row = { breadth_score: 75, pct_above_50sma: 58, vix: 16 }

describe('RadarView', () => {
  it('renders an axis label per metric', () => {
    render(<RadarView currentRow={row} metrics={metrics} normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('>50 SMA')).toBeInTheDocument()
    expect(screen.getByText('VIX')).toBeInTheDocument()
  })
  it('shows a fallback message with fewer than 3 metrics', () => {
    render(<RadarView currentRow={row} metrics={metrics.slice(0, 2)} normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText(/at least 3/i)).toBeInTheDocument()
  })
  it('clicking a drillable axis label calls onDrill', () => {
    const onDrill = vi.fn()
    render(<RadarView currentRow={row} metrics={metrics} normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByText('Health'))
    expect(onDrill).toHaveBeenCalledWith(metrics[0])
  })
  it('marks the signal axis with a ★', () => {
    render(<RadarView currentRow={row} metrics={metrics} normalize={() => 60} signalKey="breadth_score" onDrill={() => {}} />)
    expect(screen.getByText('★ Health')).toBeInTheDocument()
  })
})

// `getFmt` is part of the fixture because the view READS it now — every spoke
// prints its own reading under its name.
const mk = (key) => ({ key, label: key, drillKey: `${key}_list`, polarity: 'bull',
                       getFmt: () => key.toUpperCase() })
const bigMetrics = Array.from({ length: 16 }, (_, i) => mk(`m${i}`))
const currentRow = { date: '2026-06-01' }
const normalize = (m) => 50 + (Number(m.key.slice(1)) % 5) * 8  // deterministic spread

// ⛔ AXIS LABELS ARE COUNTED BY `data-radar-axis`, NOT BY `<text>`.
//
// A bare `querySelectorAll('text')` counted spokes only for as long as the axis
// captions were the ONLY text in the svg. They are not: the view draws numbered
// scale rings now (the whole point of the redesign — a shape with no scale is
// not a reading), so the tag counts spokes plus rings and would have gone red
// for a change that added exactly what it should have. The attribute names the
// thing being counted.
const axisLabels = (c) => [...c.querySelectorAll('[data-radar-axis]')]

describe('RadarView spoke cap', () => {
  it('renders at most maxSpokes axis labels', () => {
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={bigMetrics} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 8, spokeSelect: 'auto' }} />,
    )
    expect(axisLabels(container).length).toBe(8)
    // …and the rings the tag-based count used to swallow are genuinely there,
    // so this pair cannot both pass on an svg that draws no scale at all.
    expect(container.querySelectorAll('[data-radar-scale]').length).toBeGreaterThan(2)
  })

  it('as-listed pick keeps the first N metrics in order', () => {
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={bigMetrics} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 10, spokeSelect: 'listed' }} />,
    )
    // The caption's FIRST tspan is the name; the second is the reading.
    const labels = axisLabels(container)
      .map(t => t.querySelector('tspan').textContent.replace('★ ', ''))
    expect(labels).toEqual(['m0','m1','m2','m3','m4','m5','m6','m7','m8','m9'])
  })

  // 🔴 A SPIKE WITH NOTHING BESIDE IT READS AS BROKEN. Every spoke carries its
  // own reading now, so the shape names its numbers instead of sending the
  // reader to another view for them.
  it('prints the reading beside every spoke it draws', () => {
    const withValues = bigMetrics.slice(0, 4).map(m => ({ ...m, getFmt: () => `v-${m.key}` }))
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={withValues} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 14 }} />,
    )
    const readings = axisLabels(container)
      .map(t => [...t.querySelectorAll('tspan')].at(-1).textContent)
    expect(readings).toEqual(['v-m0', 'v-m1', 'v-m2', 'v-m3'])
  })
})
