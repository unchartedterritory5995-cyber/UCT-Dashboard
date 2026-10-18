// uct_trendline_break (internal, experimental) carries its tested falling line in
// `geometry.extras.trendline`; the overlay draws it as a sloped line from the first anchor to
// the break bar, with a dot on each anchor high. Asserted by rendered SVG through the real overlay.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import PatternOverlay, { trendlineBreakLine } from './PatternOverlay'

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

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
const series = { priceToCoordinate: (p) => 1000 - p * 10 }
function containerRef() {
  const ref = createRef()
  ref.current = { clientWidth: 800, clientHeight: 400 }
  return ref
}
const draw = (detections, props = {}) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    detections={detections} enabled={true} tf="D" barTimes={DAILY} {...props} />,
)

const TRENDLINE = { t1: 20261012, p1: 20, t2: 20261014, p2: 18, t_end: 20261016, p_end: 16, drawn_asof_t: 20261015 }

const MISSING = Symbol('missing')

function tlBreak(trendline = TRENDLINE) {
  return {
    id: 'tlb', pattern_id: 'uct_trendline_break', pattern_name: 'UCT Trendline Break',
    direction: 'bullish', display_tier: 'experimental', confidence: 72, status: 'triggered',
    geometry: {
      shape: 'candle_mark',
      anchors: [{ t: 20261016, price: 16 }, { t: 20261016, price: 14 }],
      anchor_roles: ['trendline', 'session_low'],
      extras: trendline === MISSING ? {} : { trendline },
    },
  }
}

describe('uct_trendline_break draws its sloped line', () => {
  it('draws one sloped line from the first anchor to the break bar', () => {
    const { container } = draw([tlBreak()])
    const g = container.querySelector('[data-role="trendline-break"]')
    expect(g).not.toBeNull()
    const path = g.querySelector('path[data-role="line"]')
    expect(path).not.toBeNull()
    // x: 2026-10-12 -> 0, 2026-10-16 -> 40; y = 1000 - 10*price: 20 -> 800, 16 -> 840
    expect(path.getAttribute('d')).toBe('M0,800 L40,840')
    // Experimental styling: the dotted tier stroke.
    expect(path.getAttribute('stroke-dasharray')).toBe('2,3')
    expect(g.textContent).toContain('Trendline')
    expect(g.textContent).toContain('exp')
  })

  it('marks both anchor highs', () => {
    const { container } = draw([tlBreak()])
    const dots = [...container.querySelectorAll('[data-role="anchor-high"]')]
      .map((c) => [c.getAttribute('cx'), c.getAttribute('cy')])
    expect(dots).toEqual([['0', '800'], ['20', '820']])
  })

  it('is hidden with the experimental tier (members / showExperimental off)', () => {
    const { container } = draw([tlBreak()], { showExperimental: false })
    expect(container.querySelector('[data-role="trendline-break"]')).toBeNull()
  })

  it('another detector with an extras.trendline is not drawn as one', () => {
    const other = { ...tlBreak(), id: 'x', pattern_id: 'uct_launch_pad_v4' }
    expect(trendlineBreakLine(other)).toBeNull()
    const { container } = draw([other])
    expect(container.querySelector('[data-role="trendline-break"]')).toBeNull()
  })
})

describe('a missing or malformed extras.trendline draws nothing and does not throw', () => {
  const BAD = {
    missing: MISSING,
    'missing t1': { ...TRENDLINE, t1: undefined },
    null: null,
    string: 'oops',
    array: [1, 2, 3],
    'missing p_end': { ...TRENDLINE, p_end: undefined },
    'string price': { ...TRENDLINE, p1: '20' },
    'NaN time': { ...TRENDLINE, t2: NaN },
    'zero price': { ...TRENDLINE, p2: 0 },
    'anchors out of order': { ...TRENDLINE, t1: 20261015, t2: 20261013 },
    'break before second anchor': { ...TRENDLINE, t_end: 20261013 },
  }
  for (const [name, tl] of Object.entries(BAD)) {
    it(name, () => {
      expect(trendlineBreakLine(tlBreak(tl))).toBeNull()
      let container
      expect(() => { ({ container } = draw([tlBreak(tl)])) }).not.toThrow()
      expect(container.querySelector('[data-role="trendline-break"]')).toBeNull()
      expect(container.querySelector('[data-role="anchor-high"]')).toBeNull()
      // The detection's own candle mark still draws.
      expect(container.querySelector('[data-detection="uct_trendline_break"]')).not.toBeNull()
    })
  }

  it('anchors off the loaded bars draw no line and no dots', () => {
    const off = { ...TRENDLINE, t1: 20250101, t2: 20250105 }
    const { container } = draw([tlBreak(off)])
    expect(container.querySelector('path[data-role="line"]')).toBeNull()
    expect(container.querySelector('[data-role="anchor-high"]')).toBeNull()
  })
})
