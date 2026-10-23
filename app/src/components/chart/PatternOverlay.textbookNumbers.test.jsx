// Textbook numbers (extras.metrics_textbook, server-computed only under AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED)
// replace the base metrics' "Pivot ..." lines with IBD-style "Buy point ..." lines above the SAME drawn pivot
// line: "Buy point 51.30 · 10% deep · 1.8 wks · stage 2", "Buy zone to 53.87 · +1.4% from buy point" and,
// when the server read one, "Vol +62% vs 50d avg" (" · light volume" on a breakout under 40%). Asserted by the
// RENDERED text. A row without them (the flag off) renders exactly as before. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { baseMetricsLines, textbookMetricsLines } from './PatternOverlay'

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
  pivot: 50.0, asof_t: 20261016, depth_pct: 8.0, length_weeks: 1.8, stage: 1,
  buy_zone_top: 52.5, pct_from_pivot: 4.0,
}
const TEXTBOOK = {
  buy_point: 51.3, base_high: 51.2, asof_t: 20261016, depth_pct: 10.2, length_weeks: 1.8,
  buy_zone_top: 53.87, pct_from_buy_point: 1.4, extended: false, stage: 2,
}
const DRAW = {
  pivot: 50.0, start_t: 20261012, end_t: 20261016, low: 46.0, low_t: 20261014, bars: 4,
  label: 'pivot', low_label: 'base low',
}

function base(extra = {}) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 50.0 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 50.0 }, { t: 20261016, price: 46.0 }],
      extras: { draw_base: DRAW, draw_round: 2, metrics: METRICS, metrics_round: 1, ...extra },
    },
  }
}

const OLD = ['Pivot 50.00 · 8% deep · 1.8 wks · stage 1 (est.)', 'BZ to 52.50 · +4.0% vs pivot']

describe('textbookMetricsLines', () => {
  it('prints the buy point, its zone and the close against it, the stage with no "(est.)"', () => {
    expect(textbookMetricsLines(base({ metrics_textbook: TEXTBOOK }))).toEqual([
      'Buy point 51.30 · 10% deep · 1.8 wks · stage 2',
      'Buy zone to 53.87 · +1.4% from buy point',
    ])
  })

  it('omits a missing stage, signs a close under the buy point, and says extended past the zone', () => {
    const { stage, ...noStage } = TEXTBOOK
    expect(textbookMetricsLines(base({ metrics_textbook: { ...noStage, pct_from_buy_point: -2.45 } }))).toEqual([
      'Buy point 51.30 · 10% deep · 1.8 wks',
      'Buy zone to 53.87 · −2.5% from buy point',
    ])
    expect(textbookMetricsLines(base({ metrics_textbook: { ...TEXTBOOK, pct_from_buy_point: 7.2, extended: true } }))[1])
      .toBe('Buy zone to 53.87 · +7.2% from buy point · extended')
  })

  it('adds the volume line: breakout volume, a light breakout, and a notable day under the buy point', () => {
    const at = (volume) => textbookMetricsLines(base({ metrics_textbook: { ...TEXTBOOK, volume } }))[2]
    expect(at({ vol_pct: 62, breakout: true, light: false })).toBe('Vol +62% vs 50d avg')
    expect(at({ vol_pct: 22, breakout: true, light: true })).toBe('Vol +22% vs 50d avg · light volume')
    expect(at({ vol_pct: -45, breakout: false, light: false })).toBe('Vol −45% vs 50d avg')
    expect(textbookMetricsLines(base({ metrics_textbook: { ...TEXTBOOK, volume: { vol_pct: null } } }))).toHaveLength(2)
  })

  it('returns null without textbook numbers or with malformed ones', () => {
    expect(textbookMetricsLines(base())).toBeNull()
    expect(textbookMetricsLines(base({ metrics_textbook: { ...TEXTBOOK, buy_point: null } }))).toBeNull()
    expect(textbookMetricsLines(base({ metrics_textbook: { ...TEXTBOOK, pct_from_buy_point: 'x' } }))).toBeNull()
  })

  it('baseMetricsLines prefers the textbook lines and falls back to the confirmed metrics', () => {
    expect(baseMetricsLines(base({ metrics_textbook: TEXTBOOK }))[0]).toBe('Buy point 51.30 · 10% deep · 1.8 wks · stage 2')
    expect(baseMetricsLines(base())).toEqual(OLD)
    expect(baseMetricsLines(base({ metrics_textbook: { ...TEXTBOOK, depth_pct: null } }))).toEqual(OLD)
  })
})

describe('the textbook lines render above the same pivot line', () => {
  it('three lines, lifted one line, the drawn pivot untouched', () => {
    const tb = { ...TEXTBOOK, volume: { vol_pct: 22, breakout: true, light: true } }
    const { container } = draw([base({ metrics_textbook: tb })])
    const t = container.querySelector('[data-role="base-metrics"]')
    expect([...t.querySelectorAll('tspan')].map((s) => s.textContent)).toEqual([
      'Buy point 51.30 · 10% deep · 1.8 wks · stage 2',
      'Buy zone to 53.87 · +1.4% from buy point',
      'Vol +22% vs 50d avg · light volume',
    ])
    // the pivot line sits at y = 1000 - 500 = 500; two lines start at 500 - 18, a third lifts it by 12
    expect(Number(t.getAttribute('y'))).toBe(500 - 18 - 12)
    expect(container.querySelector('[data-role="base-pivot"] text').textContent).toBe('pivot')
  })

  it('the flag off (no textbook numbers) renders exactly what the confirmed metrics render', () => {
    const plain = draw([base()]).container
    const t = plain.querySelector('[data-role="base-metrics"]')
    expect([...t.querySelectorAll('tspan')].map((s) => [s.textContent, s.getAttribute('dy')])).toEqual([
      [OLD[0], '0'], [OLD[1], '12'],
    ])
    expect(Number(t.getAttribute('y'))).toBe(500 - 18)
    // malformed textbook numbers are ignored: the same markup as no textbook numbers at all
    expect(draw([base({ metrics_textbook: { buy_point: 'x' } })]).container.innerHTML).toBe(plain.innerHTML)
  })
})
