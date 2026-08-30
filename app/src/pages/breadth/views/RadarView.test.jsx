import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

/**
 * ⭐ THE DRAWING SPACE IS THE BOX, AND THAT IS WHAT KEEPS THE TYPE STILL.
 *
 * 🔴 On a fixed `700×350` viewBox every `<text>` in this view scaled with the
 * panel: measured in Chromium, one caption's box was 40.5px tall across a
 * full-width panel and 12.0px in a 710×245 compare pane — for the SAME
 * `fontSize` declaration. Large enough to out-shout the tab's own headline at
 * one size, too small to read at the other.
 *
 * ⛔ SO THE PROPERTY UNDER TEST IS THE VIEWBOX FOLLOWING THE MEASURED BOX, not
 * a font size — a `fontSize` assertion would pass unchanged on the broken
 * version, because the declaration was never what moved. jsdom has no layout
 * and no `ResizeObserver`, so the observer is stood up here and fed two
 * different boxes: if one user unit is one device pixel, `fontSize={11}` is
 * 11px at every panel size by construction, and if it is not, no amount of
 * declaring will make it so.
 */
describe('RadarView draws in pixels, not in viewBox units', () => {
  const original = globalThis.ResizeObserver
  afterEach(() => { globalThis.ResizeObserver = original })

  const atBox = (w, h) => {
    let fire = null
    globalThis.ResizeObserver = class {
      constructor(cb) { fire = (rect) => act(() => cb([{ contentRect: rect }])) }
      observe() {}
      disconnect() {}
    }
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={bigMetrics.slice(0, 6)} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{}} />)
    fire({ width: w, height: h })
    const svg = container.querySelector('svg')
    const [, , vbW, vbH] = svg.getAttribute('viewBox').split(/\s+/).map(Number)
    const declared = Number(container.querySelector('[data-radar-axis]').getAttribute('font-size'))
    // `xMidYMid meet` scales by the SMALLER of the two ratios, so this is what a
    // caption actually measures on screen.
    return { viewBox: `${vbW} ${vbH}`, declared, drawnPx: declared * Math.min(w / vbW, h / vbH) }
  }

  it('sizes its viewBox to the box it was measured at', () => {
    expect(atBox(1464, 645).viewBox).toBe('1464 645')
    expect(atBox(672, 189).viewBox).toBe('672 189')
  })

  /**
   * ⛔ THE ASSERTION IS THE PRODUCT, NOT EITHER HALF. A caption's screen size is
   * `font-size × viewBox scale`, and it was the SCALE that moved: the declared
   * `9` was constant the whole time the rendered caption ran from 5px to 17px.
   * Asserting the declaration would have passed on the defect; asserting the
   * product fails on it, and also fails on the other way to get this wrong —
   * "fixing" the scale by making the declaration a function of the box.
   */
  it('draws a caption the same size at a full panel and at a quarter pane', () => {
    const wide = atBox(1464, 645)
    const small = atBox(672, 189)
    expect(small.drawnPx).toBeCloseTo(wide.drawnPx, 6)
    expect(wide.drawnPx).toBeGreaterThan(9)   // …and legible at both, not merely equal
  })
})

/**
 * ⭐ AND THE SHAPE ANSWERS "WHICH WAY IS IT MOVING?" — the question Meters
 * already answers with its ghost marker off the same `prevRow`. A radar that
 * could not was the odd board out.
 *
 * ⛔ IT IS DRAWN ONLY WHEN IT SAYS SOMETHING: an identical outline under the
 * live polygon is two lines claiming to be one reading.
 */
describe('RadarView prior-session ghost', () => {
  const three = bigMetrics.slice(0, 5)
  const now = { date: '2026-06-01' }
  const before = { date: '2026-05-27' }

  it('draws the prior shape when it differs from today', () => {
    const { container } = render(
      <RadarView currentRow={now} prevRow={before} metrics={three}
                 normalize={(m, row) => (row === before ? 20 : 70)}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{}} />)
    expect(container.querySelector('[data-testid="radar-ghost"]')).toBeTruthy()
    expect(screen.getByTestId('radar-basis').textContent).toMatch(/three sessions back/)
  })

  it('draws nothing when the board has not moved', () => {
    const { container } = render(
      <RadarView currentRow={now} prevRow={before} metrics={three} normalize={() => 55}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{}} />)
    expect(container.querySelector('[data-testid="radar-ghost"]')).toBeNull()
    expect(screen.getByTestId('radar-basis').textContent).not.toMatch(/three sessions back/)
  })

  it('draws nothing when there is no prior session at all', () => {
    const { container } = render(
      <RadarView currentRow={now} metrics={three} normalize={() => 55}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{}} />)
    expect(container.querySelector('[data-testid="radar-ghost"]')).toBeNull()
  })
})
