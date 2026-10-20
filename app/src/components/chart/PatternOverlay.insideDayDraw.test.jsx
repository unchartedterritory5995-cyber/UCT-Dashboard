// draw:inside-day's member drawing (lab id_draw_v2, two blind packets passed AS DRAWN): a light box over
// the inside day and the bar it sits inside, ONE solid "trigger" line at the inside day's high extended
// past the last bar, and ONE dashed "stop" line at its low -- and nothing else of that row. Asserted by
// what RENDERS. Synthetic prices.
//
// Every OTHER row is unchanged: a draw_inside_day stamp on any other pattern renders byte-for-byte as the
// same row without it.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { insideDayDrawing } from './PatternOverlay'

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
const containerRef = () => ({ current: { clientWidth: 800, clientHeight: 400 } })
const draw = (detections, props = {}) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} {...props} />,
)

// mother bar 2026-10-14 (44 .. 50), inside day 2026-10-15 (45 .. 48), as of 2026-10-16
const DRAW = {
  trigger: 48, stop: 45, mother_high: 50, mother_low: 44, start_t: 20261014, inside_t: 20261015,
  end_t: 20261016, age: 1, variant: 'inside', atr: 2, label: 'trigger', stop_label: 'stop',
}

function idd(extras = { draw_inside_day: DRAW, draw_round: 3 }, over = {}) {
  return {
    id: 'draw:inside-day:SYN:20261015:20261016', pattern_id: 'draw:inside-day', pattern_name: 'Inside day',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'uct', status: 'forming', levels: { entry: 48, stop: 45 },
    geometry: {
      shape: 'inside_day_draw',
      anchors: [{ t: 20261014, price: 50 }, { t: 20261015, price: 44 }],
      extras,
    },
    ...over,
  }
}

describe('draw:inside-day draws its box, trigger and stop', () => {
  it('draws the box over the mother bar through the inside day, mother low to mother high', () => {
    const { container } = draw([idd()])
    const r = container.querySelector('[data-role="inside-day-box"]')
    expect(r).not.toBeNull()
    // bars at x 20 (mother) and 30 (inside day), widened half a bar either side; y 500 (50) .. 560 (44)
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(r.getAttribute(k)))
    expect(y).toBe(500)
    expect(h).toBe(60)
    expect(x).toBeLessThan(20)
    expect(x + w).toBeGreaterThan(30)
    expect(x + w / 2).toBe(25)
    expect(r.getAttribute('stroke')).toBe('none')
  })

  it('draws ONE solid "trigger" line extended into the next slot and ONE dashed "stop" line', () => {
    const { container } = draw([idd()])
    const lines = [...container.querySelectorAll('[data-shape="level-segment"]')]
    expect(lines.map((g) => [g.getAttribute('data-role'), g.textContent])).toEqual([
      ['inside-day-trigger', 'trigger'], ['inside-day-stop', 'stop'],
    ])
    const [t, s] = lines.map((g) => g.querySelector('line'))
    // from the mother bar (x 20); the trigger runs past the last bar (x 40 + 40), the stop ends there
    expect([t.getAttribute('x1'), t.getAttribute('x2'), t.getAttribute('y1')]).toEqual(['20', '80', '520'])
    expect(t.getAttribute('stroke-dasharray')).toBeNull()
    expect([s.getAttribute('x1'), s.getAttribute('x2'), s.getAttribute('y1')]).toEqual(['20', '40', '550'])
    expect(s.getAttribute('stroke-dasharray')).toBe('4,3')
  })

  it('draws nothing else of that row', () => {
    const { container } = draw([idd()])
    const g = container.querySelector('[data-detection="draw:inside-day"]')
    expect([...g.children].map((c) => c.getAttribute('data-role'))).toEqual(['inside-day-draw'])
  })

  it('a member (trustedOnly) never draws a row the server tiered experimental', () => {
    const { container } = draw([idd(undefined, { display_tier: 'experimental' })])
    expect(container.querySelector('[data-detection="draw:inside-day"]')).toBeNull()
  })

  it('control: the same row without a valid draw_inside_day draws no inside day', () => {
    for (const ex of [{}, { draw_inside_day: { ...DRAW, trigger: 44 } }, { draw_inside_day: 'x' }]) {
      const { container } = draw([idd(ex)])
      expect(container.querySelector('[data-role="inside-day-draw"]')).toBeNull()
    }
  })

  it('a draw_inside_day stamp on any other pattern renders exactly as that row without it', () => {
    const plain = {
      id: 'fb', pattern_id: 'bc:flat-base', pattern_name: 'Flat base', direction: 'bullish',
      display_tier: 'trusted', display_layer: 'structures', confidence: null,
      geometry: { shape: 'base_box', anchors: [{ t: 20261012, price: 50 }, { t: 20261016, price: 44 }],
        extras: { top: 50, floor: 44, pivot: 50, label: 'Flat base' } },
    }
    const stamped = { ...plain, geometry: { ...plain.geometry, extras: { ...plain.geometry.extras, draw_inside_day: DRAW, draw_round: 3 } } }
    const a = draw([plain], { trustedOnly: false }).container.innerHTML
    const b = draw([stamped], { trustedOnly: false }).container.innerHTML
    expect(a.length).toBeGreaterThan(100)
    expect(b).toBe(a)
  })
})

describe('insideDayDrawing (pure)', () => {
  it('reads a well-formed stamp', () => {
    expect(insideDayDrawing(idd())).toEqual({
      trigger: 48, stop: 45, motherHigh: 50, motherLow: 44, start_t: 20261014, inside_t: 20261015,
      end_t: 20261016, label: 'trigger', stopLabel: 'stop',
    })
  })

  it('is null for another pattern carrying the stamp, and for malformed stamps', () => {
    expect(insideDayDrawing({ ...idd(), pattern_id: 'uct_inside_day_id4' })).toBeNull()
    for (const bad of [null, 'x', { ...DRAW, trigger: 'nope' }, { ...DRAW, stop: undefined },
      { ...DRAW, trigger: 45 }, { ...DRAW, mother_high: 47 }, { ...DRAW, mother_low: 46 },
      { ...DRAW, start_t: null }, { ...DRAW, inside_t: undefined }, { ...DRAW, end_t: undefined }]) {
      expect(insideDayDrawing(idd({ draw_inside_day: bad, draw_round: 3 }))).toBeNull()
    }
  })
})
