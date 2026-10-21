// Base warnings (api/services/pattern_engine/base_warnings.py, AUTO_STRUCTURES_WARNINGS_ENABLED): a base
// row carrying extras.warning = {code, text} draws a small caution tag on its drawing, with the
// warning's own text. A withheld (stale) base box draws ONLY when it carries a FAULT warning. A row
// without a warning draws nothing new. Asserted by what RENDERS. Synthetic prices only.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { baseWarning, warningView, warningAnchor, selectDrawable } from './PatternOverlay'

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

function makeDailyChart(barTimes) {
  const index = new Map(barTimes.map((t, i) => [t, 300 + i * 10]))
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
    enabled={true} tf="D" barTimes={DAILY} detections={detections} {...props} />,
)

function baseRow(extras = {}) {
  return {
    id: 'bd', pattern_id: 'bc:base', pattern_name: 'Base', direction: 'bullish',
    display_tier: 'trusted', display_layer: 'structures', confidence: null,
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 50 }, { t: 20261016, price: 44 }],
      extras: {
        draw_base: { pivot: 50, low: 44, start_t: 20261012, end_t: 20261016, label: 'pivot', low_label: 'base low' },
        draw_round: 1,
        ...extras,
      },
    },
  }
}

function boxRow(extras = {}) {
  return {
    id: 'fb', pattern_id: 'bc:flat-base', pattern_name: 'Flat base', direction: 'bullish',
    display_tier: 'trusted', display_layer: 'structures', confidence: null,
    geometry: {
      shape: 'base_box',
      anchors: [{ t: 20261012, price: 60 }, { t: 20261015, price: 45 }],
      extras: { top: 60, floor: 45, pivot: 60, ...extras },
    },
  }
}

const FAILED = { code: 'failed_breakout', text: 'failed breakout: closed back below pivot 50.00', round: 1 }
const LATE = { code: 'late_stage', text: 'late-stage base (est. stage 3)', round: 1 }
const DEEP = { code: 'too_deep', text: 'too deep: 25% (norm <= 15%)', round: 1 }

describe('the base warning tag', () => {
  it('draws the warning text on the drawing, at its top-right', () => {
    const { container } = draw([baseRow({ warning: LATE })])
    const tags = container.querySelectorAll('[data-role="base-warning"]')
    expect(tags).toHaveLength(1)
    expect(tags[0].getAttribute('data-warning')).toBe('late_stage')
    expect(tags[0].textContent).toContain('late-stage base (est. stage 3)')
    expect(tags[0].querySelector('title').textContent).toBe('late-stage base (est. stage 3)')
    // the base drawing itself still draws, unchanged
    expect(container.querySelector('[data-role="base-draw"]')).not.toBeNull()
    // anchored at the drawing's end (x = 340) and pivot (y = 500): the tag sits left of and above it
    const rect = tags[0].querySelector('rect')
    expect(Number(rect.getAttribute('x')) + Number(rect.getAttribute('width'))).toBeLessThanOrEqual(340)
    expect(Number(rect.getAttribute('y'))).toBe(500 - 22)
  })

  it('a row without a warning draws no tag', () => {
    const { container } = draw([baseRow(), boxRow()])
    expect(container.querySelector('[data-role="base-warning"]')).toBeNull()
  })

  it('an unknown code or an empty text draws nothing', () => {
    expect(baseWarning(baseRow({ warning: { code: 'mystery', text: 'x' } }))).toBeNull()
    expect(baseWarning(baseRow({ warning: { code: 'too_deep', text: '  ' } }))).toBeNull()
    expect(baseWarning(baseRow({ warning: 'too_deep' }))).toBeNull()
    const { container } = draw([baseRow({ warning: { code: 'mystery', text: 'x' } })])
    expect(container.querySelector('[data-role="base-warning"]')).toBeNull()
  })
})

describe('a withheld base box comes back only with a FAULT warning', () => {
  it('draws a stale box carrying a failed-breakout or too-deep warning, with its tag', () => {
    for (const w of [FAILED, DEEP]) {
      const { container, unmount } = draw([boxRow({ stale: true, stale_reason: 'failed_breakout', warning: w })])
      const tag = container.querySelector('[data-role="base-warning"]')
      expect(tag?.textContent).toContain(w.text)
      expect(container.querySelector('[data-detection="bc:flat-base"]')).not.toBeNull()
      unmount()
    }
  })

  it('a stale box with no warning, or only a late-stage one, still does not draw', () => {
    const rows = [boxRow({ stale: true, stale_reason: 'broke_down' }),
      { ...boxRow({ stale: true, warning: LATE }), id: 'fb2' }]
    expect(selectDrawable(rows, { tf: 'D' })).toEqual([])
    expect(warningView(rows[0])).toBeNull()
    expect(warningView(rows[1])).toBeNull()
    const { container } = draw(rows)
    expect(container.querySelector('[data-role="base-warning"]')).toBeNull()
  })

  it('the anchor is the box top-right (its pivot line when higher)', () => {
    expect(warningAnchor(boxRow())).toEqual({ t: 20261015, price: 60 })
    expect(warningAnchor(boxRow({ draw_pivot: { price: 62, start_t: 20261012, end_t: 20261016 } })))
      .toEqual({ t: 20261015, price: 62 })
    expect(warningAnchor(baseRow())).toEqual({ t: 20261016, price: 50 })
  })
})
