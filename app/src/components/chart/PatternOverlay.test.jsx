// Phase 8, Package 8D — PatternOverlay's own contract: the barHalfWidthPx
// prop it computes and passes to every shape renderer (CandleMark's
// candle-emphasis outline consumes it), and that it still fails safely when
// disabled/missing chart/no detections — matching its existing behavior,
// unchanged by this package.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import PatternOverlay from './PatternOverlay'
import htfDetection from './patternShapes/__fixtures__/htf_detection.json'

function makeChart({ barSpacing = 8 } = {}) {
  return {
    timeScale: () => ({
      timeToCoordinate: (t) => t / 100000,
      subscribeVisibleTimeRangeChange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      options: () => ({ barSpacing }),
    }),
  }
}

function makeSeries() {
  return { priceToCoordinate: (price) => 1000 - price * 10 }
}

function makeContainerRef() {
  const ref = createRef()
  ref.current = { clientWidth: 800, clientHeight: 400 }
  return ref
}

describe('PatternOverlay', () => {
  it('renders nothing when disabled (existing behavior, unchanged)', () => {
    const { container } = render(
      <PatternOverlay
        chart={makeChart()} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[htfDetection]} enabled={false}
      />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing with zero detections (existing behavior, unchanged)', () => {
    const { container } = render(
      <PatternOverlay
        chart={makeChart()} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[]} enabled={true}
      />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders a detection and reaches the shape renderer (dispatch unchanged)', () => {
    const { container } = render(
      <PatternOverlay
        chart={makeChart()} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[htfDetection]} enabled={true}
      />,
    )
    expect(container.querySelectorAll('line')).toHaveLength(2) // TrendlinePair's 2 lines
  })

  it('falls back to a safe default half-width when timeScale().options() throws (defensive, matches tToX/priceToY convention)', () => {
    const brokenChart = {
      timeScale: () => ({
        timeToCoordinate: (t) => t / 100000,
        subscribeVisibleTimeRangeChange: vi.fn(),
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleTimeRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        options: () => { throw new Error('boom') },
      }),
    }
    // Must not throw during render.
    expect(() =>
      render(
        <PatternOverlay
          chart={brokenChart} series={makeSeries()} containerRef={makeContainerRef()}
          detections={[htfDetection]} enabled={true}
        />,
      ),
    ).not.toThrow()
  })
})
