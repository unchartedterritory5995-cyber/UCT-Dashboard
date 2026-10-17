// Phase 8, Package 8D — PatternOverlay's own contract: the barHalfWidthPx
// prop it computes and passes to every shape renderer (CandleMark's
// candle-emphasis outline consumes it), and that it still fails safely when
// disabled/missing chart/no detections — matching its existing behavior,
// unchanged by this package.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import PatternOverlay, { selectDrawable, LEVELS_NEAREST } from './PatternOverlay'
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
    // TrendlinePair's pole_and_flag (HTF): the pole line + the flag box.
    expect(container.querySelectorAll('[data-role="pole"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-role="flag"]')).toHaveLength(1)
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

// ── Auto structures (2026-10-16) ───────────────────────────────────────────
// A chart whose timeToCoordinate answers ONLY for times its series holds — exactly the
// lightweight-charts contract that made every unconverted daily anchor resolve null.
function makeDailyChart(barTimes) {
  const index = new Map(barTimes.map((t, i) => [t, i * 10]))
  return {
    timeScale: () => ({
      timeToCoordinate: (t) => (index.has(t) ? index.get(t) : null),
      subscribeVisibleTimeRangeChange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      options: () => ({ barSpacing: 8 }),
    }),
  }
}

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
// The shape the daily scan stores: YYYYMMDD int anchors (bars_sqlite's daily `ts`).
const flagDet = (over = {}) => ({
  id: 'd1',
  pattern_id: 'bull_flag',
  pattern_name: 'Bull Flag',
  confidence: 70,
  display_tier: 'trusted',
  display_layer: 'structures',
  geometry: {
    shape: 'trendline_pair',
    anchors: [
      { t: 20261012, price: 12 }, { t: 20261016, price: 11.5 },
      { t: 20261012, price: 10 }, { t: 20261016, price: 9.5 },
    ],
    extras: {},
  },
  ...over,
})

describe('PatternOverlay — daily anchor time conversion (the bug)', () => {
  it('REPRODUCES: without conversion a YYYYMMDD anchor resolves null on a daily series and nothing draws', () => {
    const chart = makeDailyChart(DAILY)
    expect(chart.timeScale().timeToCoordinate(20261012)).toBeNull()
    const { container } = render(
      <PatternOverlay chart={chart} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[flagDet()]} enabled={true} />,
    )
    expect(container.querySelector('[data-role="upper"]')).toBeNull()
  })

  it('FIXED: with tf="D" the same detection draws at the converted bar positions', () => {
    const chart = makeDailyChart(DAILY)
    const { container } = render(
      <PatternOverlay chart={chart} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[flagDet()]} enabled={true} tf="D" barTimes={DAILY} />,
    )
    const d = container.querySelector('[data-role="upper"]').getAttribute('d')
    expect(d).toBe(`M0,${1000 - 120} L40,${1000 - 115}`)
  })
})

describe('PatternOverlay — what draws (server display policy)', () => {
  const lvl = (id, price) => ({
    id, pattern_id: 'support_resistance', display_tier: 'experimental', display_layer: 'levels',
    geometry: { shape: 'horizontal_line', anchors: [{ t: 20261012, price }, { t: 20261016, price }] },
  })

  it('hidden never draws; experimental only with showExperimental', () => {
    const rows = [flagDet({ id: 'a' }), flagDet({ id: 'b', display_tier: 'hidden' }),
      flagDet({ id: 'c', display_tier: 'experimental' })]
    expect(selectDrawable(rows, { tf: 'D' }).map((d) => d.id)).toEqual(['a', 'c'])
    expect(selectDrawable(rows, { tf: 'D', showExperimental: false }).map((d) => d.id)).toEqual(['a'])
  })

  it('intraday-only detectors never draw on D/W/M, and do on intraday', () => {
    const rows = [flagDet({ id: 'orb', intraday_only: true })]
    for (const tf of ['D', 'W', 'M']) expect(selectDrawable(rows, { tf })).toHaveLength(0)
    expect(selectDrawable(rows, { tf: '5' })).toHaveLength(1)
  })

  it('the levels layer is OFF by default; on, only the LEVELS_NEAREST levels nearest price draw', () => {
    const rows = [flagDet({ id: 's' }), lvl('l1', 50), lvl('l2', 101), lvl('l3', 98), lvl('l4', 140)]
    expect(selectDrawable(rows, { tf: 'D' }).map((d) => d.id)).toEqual(['s'])
    const on = selectDrawable(rows, { tf: 'D', showLevels: true, lastPrice: 100 }).map((d) => d.id)
    expect(LEVELS_NEAREST).toBe(2)
    expect(on).toEqual(['s', 'l2', 'l3'])
  })
})

describe('PatternOverlay — secondary geometry and the trusted entry pivot', () => {
  it('draws a uct secondary level as a bounded segment with its label', () => {
    const det = {
      id: 'u1', pattern_id: 'uct_gap_support', pattern_name: 'Gap Support', confidence: 80,
      display_tier: 'experimental',
      geometry: {
        shape: 'candle_mark', anchors: [{ t: 20261016, price: 10 }],
        secondary: [{ shape: 'horizontal_line', role: 'gap_edge', label: 'Gap edge 9.80',
          anchors: [{ t: 20261013, price: 9.8 }, { t: 20261016, price: 9.8 }] }],
      },
    }
    const { container } = render(
      <PatternOverlay chart={makeDailyChart(DAILY)} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[det]} enabled={true} tf="D" barTimes={DAILY} />,
    )
    const seg = container.querySelector('[data-shape="level-segment"]')
    expect(seg).not.toBeNull()
    const line = seg.querySelector('line')
    expect(Number(line.getAttribute('x1'))).toBe(10)
    expect(Number(line.getAttribute('x2'))).toBe(40)
    expect(seg.textContent).toContain('Gap edge 9.80')
  })

  it('a draw_entry detector also draws its levels.entry pivot, labelled', () => {
    const det = flagDet({ draw_entry: true, levels: { entry: 12.34 } })
    const { container } = render(
      <PatternOverlay chart={makeDailyChart(DAILY)} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[det]} enabled={true} tf="D" barTimes={DAILY} />,
    )
    const seg = container.querySelector('[data-shape="level-segment"]')
    expect(seg.textContent).toBe('Entry 12.34')
    expect(Number(seg.querySelector('line').getAttribute('y1'))).toBeCloseTo(1000 - 123.4)
  })

  it('a base box from `structures` reaches the BaseBox renderer with its label', () => {
    const det = {
      id: 'bc:range-10:X:1:2', pattern_id: 'bc:range-10', pattern_name: '10-day range',
      display_tier: 'experimental', confidence: null,
      geometry: { shape: 'base_box', anchors: [{ t: 20261012, price: 12 }, { t: 20261016, price: 10 }],
        extras: { top: 12, floor: 10, pivot: 12, label: '10-day range · high 12.00', sub_boxes: [] } },
    }
    const { container } = render(
      <PatternOverlay chart={makeDailyChart(DAILY)} series={makeSeries()} containerRef={makeContainerRef()}
        detections={[det]} enabled={true} tf="D" barTimes={DAILY} />,
    )
    expect(container.querySelector('[data-role="label"]').textContent).toBe('10-day range · high 12.00')
  })
})
