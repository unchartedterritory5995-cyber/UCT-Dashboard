// Base metrics (extras.metrics, server-computed under AUTO_STRUCTURES_METRICS_ENABLED) print as two short
// lines above a base drawing's pivot line: "Pivot 81.98 · 12% deep · 5.2 wks · stage 2 (est.)" and
// "BZ to 86.08 · +3.1% vs pivot". Asserted by the RENDERED text. A row without metrics renders exactly
// as before (the same markup), so the flag-off payload draws nothing new. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { baseMetricsLines } from './PatternOverlay'

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
const draw = (detections) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} />,
)

const METRICS = {
  pivot: 81.98, asof_t: 20261016, depth_pct: 12.0, length_weeks: 5.2, stage: 2,
  buy_zone_top: 86.08, pct_from_pivot: 3.1,
}
const DRAW = {
  pivot: 81.98, start_t: 20261012, end_t: 20261016, low: 72.14, low_t: 20261014, bars: 4,
  label: 'pivot', low_label: 'base low',
}

function base(extra = {}) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 81.98 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 81.98 }, { t: 20261016, price: 72.14 }],
      extras: { draw_base: DRAW, draw_round: 1, ...extra },
    },
  }
}

function flat(extra = {}) {
  return {
    id: 'bc:flat-base:SYN:20261012:20261016', pattern_id: 'bc:flat-base', pattern_name: 'Flat base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 81.98 },
    geometry: {
      shape: 'base_box',
      anchors: [{ t: 20261012, price: 84 }, { t: 20261016, price: 72.14 }],
      extras: {
        top: 84, floor: 72.14, pivot: 81.98, draw_box: false,
        draw_pivot: { start_t: 20261012, end_t: 20261016, price: 81.98 }, ...extra,
      },
    },
  }
}

describe('baseMetricsLines', () => {
  it('formats the compact two lines, stage labelled an estimate', () => {
    expect(baseMetricsLines(base({ metrics: METRICS }))).toEqual([
      'Pivot 81.98 · 12% deep · 5.2 wks · stage 2 (est.)',
      'BZ to 86.08 · +3.1% vs pivot',
    ])
  })

  it('omits a missing stage and signs a price under the pivot', () => {
    const { stage, ...noStage } = METRICS
    expect(baseMetricsLines(base({ metrics: { ...noStage, pct_from_pivot: -2.45 } }))).toEqual([
      'Pivot 81.98 · 12% deep · 5.2 wks',
      'BZ to 86.08 · −2.5% vs pivot',
    ])
  })

  it('returns null without metrics or with a malformed one', () => {
    expect(baseMetricsLines(base())).toBeNull()
    expect(baseMetricsLines(base({ metrics: { ...METRICS, depth_pct: null } }))).toBeNull()
    expect(baseMetricsLines(base({ metrics: { ...METRICS, buy_zone_top: 'x' } }))).toBeNull()
  })
})

describe('the metrics render beside the pivot line', () => {
  it('a bc:base prints both lines above its pivot, right-aligned to the line tip', () => {
    const { container } = draw([base({ metrics: METRICS })])
    const t = container.querySelector('[data-role="base-metrics"]')
    expect(t).not.toBeNull()
    expect([...t.querySelectorAll('tspan')].map((s) => s.textContent)).toEqual([
      'Pivot 81.98 · 12% deep · 5.2 wks · stage 2 (est.)',
      'BZ to 86.08 · +3.1% vs pivot',
    ])
    // the pivot line runs x 0..80 at y = 1000 - 819.8 = 180.2; the text ends at the tip, above the line
    expect(t.getAttribute('x')).toBe('80')
    expect(t.getAttribute('text-anchor')).toBe('end')
    expect(Number(t.getAttribute('y'))).toBeLessThan(180.2 - 12)
    // the pivot label is untouched and still starts to the right of the tip
    const pivot = container.querySelector('[data-role="base-pivot"] text')
    expect(pivot.textContent).toBe('pivot')
    expect(Number(pivot.getAttribute('x'))).toBeGreaterThan(80)
  })

  it('a team-set flat base prints them above its draw_pivot', () => {
    const { container } = draw([flat({ metrics: METRICS })])
    const t = container.querySelector('[data-detection="bc:flat-base"] [data-role="base-metrics"]')
    expect(t?.textContent).toContain('Pivot 81.98 · 12% deep')
    expect(container.querySelector('[data-role="pivot"] text').textContent).toBe('Pivot 81.98')
  })

  it('without metrics a row renders exactly as before', () => {
    for (const make of [base, flat]) {
      const plain = draw([make()]).container.innerHTML
      expect(plain).not.toContain('base-metrics')
      // metrics are additive: removing the metrics node gives back the plain markup
      const { container } = draw([make({ metrics: METRICS })])
      container.querySelector('[data-role="base-metrics"]').remove()
      expect(container.innerHTML).toBe(plain)
    }
  })

  it('no drawn pivot, no metrics text', () => {
    const { draw_pivot, ...noPivot } = flat({ metrics: METRICS }).geometry.extras
    const row = { ...flat(), geometry: { ...flat().geometry, extras: noPivot } }
    expect(draw([row]).container.querySelector('[data-role="base-metrics"]')).toBeNull()
  })
})
